import { desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { findCreditPack } from "@/config/pricing";
import { creditLedger, jobsLog, payments, users } from "@/db/schema";
import { isAllowedOrigin, jsonNoStore, readSessionTokenFromRequest } from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { getSessionFromToken } from "@/lib/auth/service";
import { buildPaymentReceiptEmail, dispatchUserNotification } from "@/lib/email/notifications";
import {
  BillingError,
  checkSpendCircuitBreaker,
  grantPaymentCreditsIdempotent,
  issueAdminBatchCredits,
  issueAdminManualRefund,
  setGlobalCircuitBreaker,
} from "./ledger";
import { verifyPaystackWebhook, verifyStripeWebhook } from "./webhooks";

export interface BillingHttpDeps extends HttpAuthDeps {
  paystackSecretKey?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  adminEmails?: string;
}

export function isAdminEmail(email: string, adminEmailsEnv?: string): boolean {
  const raw = adminEmailsEnv?.trim();
  if (!raw) return false;
  const allowlist = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  return allowlist.has(email.trim().toLowerCase());
}

const CheckoutBodySchema = z.object({
  provider: z.enum(["paystack", "stripe"]),
  packId: z.string().trim().min(1),
});

export async function handleCreateCheckout(
  request: Request,
  deps: BillingHttpDeps
): Promise<Response> {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }

  const isProd = deps.appEnv === "prod";
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, isProd),
    deps.nowFn
  );
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const parsed = CheckoutBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore(
      { ok: false, error: "Select a valid payment provider and credit pack." },
      400
    );
  }

  const pack = findCreditPack(parsed.data.packId);
  if (!pack) {
    return jsonNoStore({ ok: false, error: "Selected credit pack was not found." }, 400);
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = (deps.nowFn ?? (() => new Date()))();
  let appUrl = deps.appUrl.trim();
  while (appUrl.endsWith("/")) appUrl = appUrl.slice(0, -1);

  if (parsed.data.provider === "paystack") {
    const secret = deps.paystackSecretKey?.trim();
    if (!secret) {
      return jsonNoStore({ ok: false, error: "Paystack checkout is not configured yet." }, 503);
    }

    const reference = `psk_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const initRes = await fetchFn("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: session.user.email,
        amount: pack.amountNgnKobo,
        currency: "NGN",
        reference,
        callback_url: `${appUrl}/billing?payment=paystack_pending`,
        metadata: {
          userId: session.user.id,
          credits: pack.credits,
          packId: pack.id,
        },
      }),
    });

    if (!initRes.ok) {
      return jsonNoStore({ ok: false, error: "Could not initialize Paystack checkout." }, 502);
    }

    const initJson = (await initRes.json()) as {
      status?: boolean;
      data?: { authorization_url?: string; reference?: string };
    };
    const checkoutUrl = initJson.data?.authorization_url;
    if (!initJson.status || !checkoutUrl) {
      return jsonNoStore(
        { ok: false, error: "Paystack returned an invalid checkout response." },
        502
      );
    }

    await deps.db.insert(payments).values({
      id: `pay_${crypto.randomUUID()}`,
      userId: session.user.id,
      provider: "paystack",
      providerReference: reference,
      currency: "NGN",
      amountMinor: pack.amountNgnKobo,
      creditsGranted: pack.credits,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return jsonNoStore({ ok: true, provider: "paystack", reference, checkoutUrl }, 201);
  }

  const stripeSecret = deps.stripeSecretKey?.trim();
  if (!stripeSecret) {
    return jsonNoStore({ ok: false, error: "Stripe checkout is not configured yet." }, 503);
  }

  const form = new URLSearchParams({
    mode: "payment",
    success_url: `${appUrl}/billing?payment=stripe_success`,
    cancel_url: `${appUrl}/billing?payment=stripe_cancelled`,
    customer_email: session.user.email,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(pack.amountUsdCents),
    "line_items[0][price_data][product_data][name]": `Collate: ${pack.label}`,
    "line_items[0][quantity]": "1",
    "metadata[userId]": session.user.id,
    "metadata[credits]": String(pack.credits),
    "metadata[packId]": pack.id,
  });

  const stripeRes = await fetchFn("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${stripeSecret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!stripeRes.ok) {
    return jsonNoStore({ ok: false, error: "Could not initialize Stripe checkout." }, 502);
  }

  const stripeJson = (await stripeRes.json()) as { id?: string; url?: string };
  if (!stripeJson.id || !stripeJson.url) {
    return jsonNoStore({ ok: false, error: "Stripe returned an invalid checkout session." }, 502);
  }

  await deps.db.insert(payments).values({
    id: `pay_${crypto.randomUUID()}`,
    userId: session.user.id,
    provider: "stripe",
    providerReference: stripeJson.id,
    currency: "USD",
    amountMinor: pack.amountUsdCents,
    creditsGranted: pack.credits,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  return jsonNoStore(
    { ok: true, provider: "stripe", reference: stripeJson.id, checkoutUrl: stripeJson.url },
    201
  );
}

function formatMinorAmount(currency: string, amountMinor: number): string {
  const major = (amountMinor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency.toUpperCase()} ${major}`;
}

export async function handlePaystackWebhook(
  request: Request,
  deps: BillingHttpDeps
): Promise<Response> {
  const secret = deps.paystackSecretKey?.trim();
  if (!secret) {
    return jsonNoStore({ ok: false, error: "Paystack webhook secret is not configured." }, 503);
  }

  const rawBody = await request.text();
  const verified = await verifyPaystackWebhook({
    rawBody,
    signatureHeader: request.headers.get("x-paystack-signature"),
    secretKey: secret,
  });

  if (!verified.valid) {
    return jsonNoStore({ ok: false, error: verified.reason }, 401);
  }
  if (verified.ignored || !verified.payment) {
    return jsonNoStore({ ok: true, ignored: true }, 200);
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  try {
    const granted = await grantPaymentCreditsIdempotent(deps.db, verified.payment, rawBody, now);

    if (!granted.alreadyProcessed) {
      const [usr] = await deps.db
        .select()
        .from(users)
        .where(eq(users.id, verified.payment.userId))
        .limit(1);

      if (usr) {
        let appUrl = deps.appUrl.trim();
        while (appUrl.endsWith("/")) appUrl = appUrl.slice(0, -1);
        await dispatchUserNotification(deps.db, deps.mailer, {
          userId: usr.id,
          kind: "receipt",
          message: buildPaymentReceiptEmail({
            name: usr.name,
            amountFormatted: formatMinorAmount(
              verified.payment.currency,
              verified.payment.amountMinor
            ),
            creditsAdded: verified.payment.creditsGranted,
            reference: verified.payment.providerReference,
            accountUrl: `${appUrl}/account`,
          }),
        });
      }
    }

    return jsonNoStore({ ok: true, ...granted }, 200);
  } catch (err) {
    if (err instanceof BillingError) {
      return jsonNoStore({ ok: false, error: err.message }, err.status);
    }
    return jsonNoStore({ ok: false, error: "Failed to process Paystack webhook." }, 500);
  }
}

export async function handleStripeWebhook(
  request: Request,
  deps: BillingHttpDeps
): Promise<Response> {
  const secret = deps.stripeWebhookSecret?.trim();
  if (!secret) {
    return jsonNoStore({ ok: false, error: "Stripe webhook secret is not configured." }, 503);
  }

  const rawBody = await request.text();
  const now = (deps.nowFn ?? (() => new Date()))();
  const verified = await verifyStripeWebhook({
    rawBody,
    signatureHeader: request.headers.get("stripe-signature"),
    webhookSecret: secret,
    nowMs: now.getTime(),
  });

  if (!verified.valid) {
    return jsonNoStore({ ok: false, error: verified.reason }, 401);
  }
  if (verified.ignored || !verified.payment) {
    return jsonNoStore({ ok: true, ignored: true }, 200);
  }

  try {
    const granted = await grantPaymentCreditsIdempotent(deps.db, verified.payment, rawBody, now);

    if (!granted.alreadyProcessed) {
      const [usr] = await deps.db
        .select()
        .from(users)
        .where(eq(users.id, verified.payment.userId))
        .limit(1);

      if (usr) {
        let appUrl = deps.appUrl.trim();
        while (appUrl.endsWith("/")) appUrl = appUrl.slice(0, -1);
        await dispatchUserNotification(deps.db, deps.mailer, {
          userId: usr.id,
          kind: "receipt",
          message: buildPaymentReceiptEmail({
            name: usr.name,
            amountFormatted: formatMinorAmount(
              verified.payment.currency,
              verified.payment.amountMinor
            ),
            creditsAdded: verified.payment.creditsGranted,
            reference: verified.payment.providerReference,
            accountUrl: `${appUrl}/account`,
          }),
        });
      }
    }

    return jsonNoStore({ ok: true, ...granted }, 200);
  } catch (err) {
    if (err instanceof BillingError) {
      return jsonNoStore({ ok: false, error: err.message }, err.status);
    }
    return jsonNoStore({ ok: false, error: "Failed to process Stripe webhook." }, 500);
  }
}

async function requireAdminSession(
  request: Request,
  deps: BillingHttpDeps,
  requireCsrf: boolean
): Promise<
  | { ok: false; error: Response }
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof getSessionFromToken>>> }
> {
  if (requireCsrf && !isAllowedOrigin(request, deps.appUrl)) {
    return {
      ok: false,
      error: jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403),
    };
  }
  const isProd = deps.appEnv === "prod";
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, isProd),
    deps.nowFn
  );
  if (!session) {
    return { ok: false, error: jsonNoStore({ ok: false, error: "Authentication required." }, 401) };
  }
  if (!isAdminEmail(session.user.email, deps.adminEmails)) {
    return { ok: false, error: jsonNoStore({ ok: false, error: "Admin access required." }, 403) };
  }
  return { ok: true, session };
}

export async function handleAdminOverview(
  request: Request,
  deps: BillingHttpDeps
): Promise<Response> {
  const auth = await requireAdminSession(request, deps, false);
  if (!auth.ok) return auth.error;

  const now = (deps.nowFn ?? (() => new Date()))();
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const breaker = await checkSpendCircuitBreaker(deps.db, now);

  const [totalCostRow] = await deps.db
    .select({ total: sql<number>`coalesce(sum(${jobsLog.costEstimateUsd}), 0)` })
    .from(jobsLog);

  const [dayFailedRow] = await deps.db
    .select({ count: sql<number>`count(*)` })
    .from(jobsLog)
    .where(gte(jobsLog.createdAt, dayStart));

  const recentUsers = await deps.db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      creditsBalance: users.creditsBalance,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(25);

  const recentJobs = await deps.db
    .select()
    .from(jobsLog)
    .orderBy(desc(jobsLog.createdAt))
    .limit(25);

  const recentPayments = await deps.db
    .select()
    .from(payments)
    .orderBy(desc(payments.createdAt))
    .limit(25);

  const recentLedger = await deps.db
    .select()
    .from(creditLedger)
    .orderBy(desc(creditLedger.createdAt))
    .limit(25);

  return jsonNoStore(
    {
      ok: true,
      circuitBreaker: breaker,
      metrics: {
        allTimeLlmCostUsd: Number(totalCostRow?.total ?? 0),
        jobsLast24h: Number(dayFailedRow?.count ?? 0),
      },
      users: recentUsers.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      })),
      jobs: recentJobs.map((j) => ({
        id: j.id,
        workflowId: j.workflowId,
        step: j.step,
        model: j.model,
        status: j.status,
        costEstimateUsd: j.costEstimateUsd,
        error: j.error,
        createdAt: j.createdAt.toISOString(),
      })),
      payments: recentPayments.map((p) => ({
        id: p.id,
        userId: p.userId,
        provider: p.provider,
        providerReference: p.providerReference,
        currency: p.currency,
        amountMinor: p.amountMinor,
        creditsGranted: p.creditsGranted,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
      ledger: recentLedger.map((l) => ({
        id: l.id,
        userId: l.userId,
        entryType: l.entryType,
        creditsDelta: l.creditsDelta,
        balanceAfter: l.balanceAfter,
        note: l.note,
        createdAt: l.createdAt.toISOString(),
      })),
    },
    200
  );
}

const AdminRefundSchema = z.object({
  targetUserId: z.string().trim().min(1),
  credits: z.number().int().min(1).max(1000),
  reason: z.string().trim().min(5).max(300),
  idempotencyKey: z.string().trim().min(4).max(120).optional(),
});

export async function handleAdminManualRefund(
  request: Request,
  deps: BillingHttpDeps
): Promise<Response> {
  const auth = await requireAdminSession(request, deps, true);
  if (!auth.ok) return auth.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const parsed = AdminRefundSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid refund payload." },
      400
    );
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  try {
    const res = await issueAdminManualRefund(deps.db, {
      adminUserId: auth.session.user.id,
      targetUserId: parsed.data.targetUserId,
      credits: parsed.data.credits,
      reason: parsed.data.reason,
      idempotencyKey: parsed.data.idempotencyKey ?? `adm_ref_${crypto.randomUUID()}`,
      now,
    });
    return jsonNoStore({ ok: true, ...res }, 200);
  } catch (err) {
    if (err instanceof BillingError) {
      return jsonNoStore({ ok: false, error: err.message }, err.status);
    }
    return jsonNoStore({ ok: false, error: "Failed to issue manual refund." }, 500);
  }
}

const AdminCircuitSchema = z.object({
  paused: z.boolean(),
  reason: z.string().trim().min(3).max(300),
});

export async function handleAdminCircuitBreaker(
  request: Request,
  deps: BillingHttpDeps
): Promise<Response> {
  const auth = await requireAdminSession(request, deps, true);
  if (!auth.ok) return auth.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const parsed = AdminCircuitSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore({ ok: false, error: "Provide paused (boolean) and reason." }, 400);
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  await setGlobalCircuitBreaker(deps.db, parsed.data.paused, parsed.data.reason, now);
  return jsonNoStore({ ok: true, paused: parsed.data.paused, reason: parsed.data.reason }, 200);
}

const AdminBatchCreditSchema = z.object({
  campaignId: z
    .string()
    .trim()
    .min(4, "Campaign ID is required.")
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/, "Campaign ID must be alphanumeric with dashes or underscores."),
  credits: z
    .number()
    .int()
    .min(1, "Grant at least 1 credit.")
    .max(500, "Max 500 credits per grant."),
  reason: z.string().trim().min(5, "Provide a reason of at least 5 characters.").max(240),
  mode: z.enum(["all", "random_sample"]).default("all"),
  cursorUserId: z.string().trim().min(1).max(120).nullable().optional(),
  batchSize: z.number().int().min(1).max(80).default(50),
  remainingTargetCount: z.number().int().min(1).max(100_000).optional(),
});

export async function handleAdminBatchCredit(
  request: Request,
  deps: BillingHttpDeps
): Promise<Response> {
  const auth = await requireAdminSession(request, deps, true);
  if (!auth.ok) return auth.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const parsed = AdminBatchCreditSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid batch credit payload." },
      400
    );
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  try {
    const result = await issueAdminBatchCredits(deps.db, {
      adminUserId: auth.session.user.id,
      campaignId: parsed.data.campaignId,
      credits: parsed.data.credits,
      reason: parsed.data.reason,
      mode: parsed.data.mode,
      cursorUserId: parsed.data.cursorUserId ?? null,
      batchSize: parsed.data.batchSize,
      remainingTargetCount: parsed.data.remainingTargetCount,
      now,
    });
    return jsonNoStore({ ok: true, ...result }, 200);
  } catch {
    return jsonNoStore({ ok: false, error: "Failed to process batch credit grant." }, 500);
  }
}
