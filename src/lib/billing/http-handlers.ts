import { desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { findCreditPack } from "@/config/pricing";
import { auditLog, creditLedger, jobsLog, payments, users } from "@/db/schema";
import { isAllowedOrigin, jsonNoStore, readSessionTokenFromRequest } from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { getSessionFromToken } from "@/lib/auth/service";
import { buildPaymentReceiptEmail, dispatchUserNotification } from "@/lib/email/notifications";
import { buildPaymentAlert } from "@/lib/notify/admin-alerts";
import { logEvent } from "@/lib/observability/logger";
import {
  BillingError,
  checkSpendCircuitBreaker,
  grantPaymentCreditsIdempotent,
  issueAdminBatchCredits,
  issueAdminCreditDeduction,
  issueAdminManualRefund,
  setGlobalCircuitBreaker,
} from "./ledger";
import { evidenceFromRequest, TERMS_VERSION } from "./evidence";
import { loadAdminPayments } from "./admin-payments";
import { renderEvidenceHtml } from "./evidence-pdf";
import { buildDisputeEvidence } from "./evidence-report";
import { brandFooter } from "@/lib/pdf/brand-document";
import { type BrowserRunPdfBinding, renderHtmlToPdfBytes } from "@/lib/pdf/render-pdf";
import {
  applyPaymentReversal,
  BILLING_HOLD_MESSAGE,
  getBillingHold,
  liftBillingHold,
  resolveDispute,
} from "./reversals";
import {
  type ParsedReversal,
  parsePaystackReversal,
  parsePolarReversal,
  verifyPaystackWebhook,
  verifyPolarWebhook,
  verifyStripeWebhook,
} from "./webhooks";

export interface PolarProductIdMap {
  pack_starter_25?: string;
  pack_project_60?: string;
  pack_thesis_150?: string;
  [packId: string]: string | undefined;
}

export interface BillingHttpDeps extends HttpAuthDeps {
  paystackSecretKey?: string;
  polarAccessToken?: string;
  polarWebhookSecret?: string;
  polarEnvironment?: string;
  polarProductIds?: PolarProductIdMap;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  adminEmails?: string;
}

export function resolvePolarApiBaseUrl(environment?: string): string {
  return environment?.trim().toLowerCase() === "sandbox"
    ? "https://sandbox-api.polar.sh"
    : "https://api.polar.sh";
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
  provider: z.enum(["paystack", "polar", "stripe"]),
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

  // The billing page's required tick box: no checkout starts without agreeing to the Terms.
  if ((rawBody as { acceptTerms?: unknown } | null)?.acceptTerms !== true) {
    return jsonNoStore(
      {
        ok: false,
        code: "TERMS_NOT_ACCEPTED",
        error: "Tick the box to agree to the Terms of Service and Refund Policy before buying.",
      },
      400
    );
  }

  const parsed = CheckoutBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore({ ok: false, error: "Select a valid credit pack and try again." }, 400);
  }

  const pack = findCreditPack(parsed.data.packId);
  if (!pack) {
    return jsonNoStore({ ok: false, error: "Selected credit pack was not found." }, 400);
  }
  if (await getBillingHold(deps.db, session.user.id)) {
    return jsonNoStore({ ok: false, code: "ACCOUNT_ON_HOLD", error: BILLING_HOLD_MESSAGE }, 403);
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = (deps.nowFn ?? (() => new Date()))();
  // Evidence for disputes: the buyer agreed to the Terms (shown next to the buy buttons) when
  // starting this payment, from this device and network.
  const recordCheckout = (
    provider: string,
    reference: string,
    currency: string,
    amountMinor: number
  ) =>
    deps.db.insert(auditLog).values({
      id: `aud_${crypto.randomUUID()}`,
      actorUserId: session.user.id,
      action: "billing.checkout_started",
      entityType: "payment_reference",
      entityId: reference,
      metadataJson: JSON.stringify({
        provider,
        packId: pack.id,
        credits: pack.credits,
        currency,
        amountMinor,
        termsVersion: TERMS_VERSION,
        termsAccepted: true,
        ...evidenceFromRequest(request),
      }),
      createdAt: now,
    });
  let appUrl = deps.appUrl.trim();
  while (appUrl.endsWith("/")) appUrl = appUrl.slice(0, -1);

  const CHECKOUT_UNAVAILABLE_MSG =
    "Checkout for this currency is temporarily unavailable. Please try again shortly or switch currency.";
  const CHECKOUT_START_FAILED_MSG =
    "We couldn't start checkout right now. Please try again in a moment.";

  if (parsed.data.provider === "paystack") {
    const secret = deps.paystackSecretKey?.trim();
    if (!secret) {
      logEvent("error", "billing.checkout_unavailable", {
        data: { provider: "paystack", reason: "missing_secret_key", packId: pack.id },
      });
      return jsonNoStore({ ok: false, error: CHECKOUT_UNAVAILABLE_MSG }, 503);
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
        callback_url: `${appUrl}/billing?payment=pending`,
        metadata: {
          userId: session.user.id,
          credits: pack.credits,
          packId: pack.id,
        },
      }),
    });

    if (!initRes.ok) {
      logEvent("error", "billing.checkout_init_failed", {
        data: { provider: "paystack", status: initRes.status, packId: pack.id },
      });
      return jsonNoStore({ ok: false, error: CHECKOUT_START_FAILED_MSG }, 502);
    }

    const initJson = (await initRes.json()) as {
      status?: boolean;
      data?: { authorization_url?: string; reference?: string };
    };
    const checkoutUrl = initJson.data?.authorization_url;
    if (!initJson.status || !checkoutUrl) {
      logEvent("error", "billing.checkout_invalid_response", {
        data: { provider: "paystack", packId: pack.id },
      });
      return jsonNoStore({ ok: false, error: CHECKOUT_START_FAILED_MSG }, 502);
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

    await recordCheckout("paystack", reference, "NGN", pack.amountNgnKobo);
    return jsonNoStore({ ok: true, provider: "paystack", reference, checkoutUrl }, 201);
  }

  if (parsed.data.provider === "polar") {
    const polarToken = deps.polarAccessToken?.trim();
    if (!polarToken) {
      logEvent("error", "billing.checkout_unavailable", {
        data: { provider: "polar", reason: "missing_access_token", packId: pack.id },
      });
      return jsonNoStore({ ok: false, error: CHECKOUT_UNAVAILABLE_MSG }, 503);
    }

    const productId = deps.polarProductIds?.[pack.id]?.trim();
    if (!productId) {
      logEvent("error", "billing.checkout_unavailable", {
        data: { provider: "polar", reason: "missing_product_id", packId: pack.id },
      });
      return jsonNoStore({ ok: false, error: CHECKOUT_UNAVAILABLE_MSG }, 503);
    }

    const polarApiBase = resolvePolarApiBaseUrl(deps.polarEnvironment);
    const polarRes = await fetchFn(`${polarApiBase}/v1/checkouts/`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${polarToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        products: [productId],
        customer_email: session.user.email,
        customer_name: session.user.name,
        external_customer_id: session.user.id,
        success_url: `${appUrl}/billing?payment=success&checkout_id={CHECKOUT_ID}`,
        return_url: `${appUrl}/billing?payment=cancelled`,
        metadata: {
          userId: session.user.id,
          credits: pack.credits,
          packId: pack.id,
        },
      }),
    });

    if (!polarRes.ok) {
      logEvent("error", "billing.checkout_init_failed", {
        data: { provider: "polar", status: polarRes.status, packId: pack.id },
      });
      return jsonNoStore({ ok: false, error: CHECKOUT_START_FAILED_MSG }, 502);
    }

    const polarJson = (await polarRes.json()) as { id?: string; url?: string };
    if (!polarJson.id || !polarJson.url) {
      logEvent("error", "billing.checkout_invalid_response", {
        data: { provider: "polar", packId: pack.id },
      });
      return jsonNoStore({ ok: false, error: CHECKOUT_START_FAILED_MSG }, 502);
    }

    await deps.db.insert(payments).values({
      id: `pay_${crypto.randomUUID()}`,
      userId: session.user.id,
      provider: "polar",
      providerReference: polarJson.id,
      currency: "USD",
      amountMinor: pack.amountUsdCents,
      creditsGranted: pack.credits,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    await recordCheckout("polar", polarJson.id, "USD", pack.amountUsdCents);
    return jsonNoStore(
      { ok: true, provider: "polar", reference: polarJson.id, checkoutUrl: polarJson.url },
      201
    );
  }

  const stripeSecret = deps.stripeSecretKey?.trim();
  if (!stripeSecret) {
    logEvent("error", "billing.checkout_unavailable", {
      data: { provider: "stripe", reason: "missing_secret_key", packId: pack.id },
    });
    return jsonNoStore({ ok: false, error: CHECKOUT_UNAVAILABLE_MSG }, 503);
  }

  const form = new URLSearchParams({
    mode: "payment",
    success_url: `${appUrl}/billing?payment=success`,
    cancel_url: `${appUrl}/billing?payment=cancelled`,
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
    logEvent("error", "billing.checkout_init_failed", {
      data: { provider: "stripe", status: stripeRes.status, packId: pack.id },
    });
    return jsonNoStore({ ok: false, error: CHECKOUT_START_FAILED_MSG }, 502);
  }

  const stripeJson = (await stripeRes.json()) as { id?: string; url?: string };
  if (!stripeJson.id || !stripeJson.url) {
    logEvent("error", "billing.checkout_invalid_response", {
      data: { provider: "stripe", packId: pack.id },
    });
    return jsonNoStore({ ok: false, error: CHECKOUT_START_FAILED_MSG }, 502);
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

/** Refund and dispute events from a payment provider (signature already checked). */
async function handleReversalWebhook(
  parsed: ParsedReversal | null,
  deps: BillingHttpDeps
): Promise<Response> {
  if (!parsed) return jsonNoStore({ ok: true, ignored: true }, 200);
  const now = (deps.nowFn ?? (() => new Date()))();
  const ctx = { now, notifier: deps.adminNotifier };
  try {
    if (parsed.type === "reversal") {
      const res = await applyPaymentReversal(deps.db, parsed.event, ctx);
      return jsonNoStore({ ok: true, ...res }, 200);
    }
    // A dispute result. If we never saw it open, record it first so a loss still takes credits.
    if (parsed.result === "lost") await applyPaymentReversal(deps.db, parsed.event, ctx);
    const res = await resolveDispute(
      deps.db,
      {
        provider: parsed.provider,
        providerDisputeId: parsed.disputeId,
        result: parsed.result,
        status: parsed.status,
      },
      ctx
    );
    return jsonNoStore({ ok: true, ...res }, 200);
  } catch (err) {
    logEvent("error", "billing.reversal_failed", {
      data: { reason: err instanceof Error ? err.message : String(err) },
    });
    // 500 so the provider retries later.
    return jsonNoStore({ ok: false, error: "Failed to process refund or dispute." }, 500);
  }
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
    return handleReversalWebhook(parsePaystackReversal(verified.rawEvent), deps);
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

      await deps.adminNotifier?.send(
        buildPaymentAlert({
          amountFormatted: formatMinorAmount(
            verified.payment.currency,
            verified.payment.amountMinor
          ),
          creditsAdded: verified.payment.creditsGranted,
          provider: verified.payment.provider,
          customerName: usr?.name,
          customerEmail: usr?.email,
        })
      );

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

      await deps.adminNotifier?.send(
        buildPaymentAlert({
          amountFormatted: formatMinorAmount(
            verified.payment.currency,
            verified.payment.amountMinor
          ),
          creditsAdded: verified.payment.creditsGranted,
          provider: verified.payment.provider,
          customerName: usr?.name,
          customerEmail: usr?.email,
        })
      );

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

export async function handlePolarWebhook(
  request: Request,
  deps: BillingHttpDeps
): Promise<Response> {
  const secret = deps.polarWebhookSecret?.trim();
  if (!secret) {
    return jsonNoStore({ ok: false, error: "Polar webhook secret is not configured." }, 503);
  }

  const rawBody = await request.text();
  const now = (deps.nowFn ?? (() => new Date()))();
  const verified = await verifyPolarWebhook({
    rawBody,
    webhookId: request.headers.get("webhook-id"),
    webhookTimestamp: request.headers.get("webhook-timestamp"),
    webhookSignature: request.headers.get("webhook-signature"),
    webhookSecret: secret,
    polarProductIds: deps.polarProductIds,
    nowMs: now.getTime(),
  });

  if (!verified.valid) {
    return jsonNoStore({ ok: false, error: verified.reason }, 401);
  }
  if (verified.ignored || !verified.payment) {
    return handleReversalWebhook(parsePolarReversal(verified.rawEvent), deps);
  }

  try {
    const granted = await grantPaymentCreditsIdempotent(deps.db, verified.payment, rawBody, now);

    if (!granted.alreadyProcessed) {
      const [usr] = await deps.db
        .select()
        .from(users)
        .where(eq(users.id, verified.payment.userId))
        .limit(1);

      await deps.adminNotifier?.send(
        buildPaymentAlert({
          amountFormatted: formatMinorAmount(
            verified.payment.currency,
            verified.payment.amountMinor
          ),
          creditsAdded: verified.payment.creditsGranted,
          provider: verified.payment.provider,
          customerName: usr?.name,
          customerEmail: usr?.email,
        })
      );

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
    return jsonNoStore({ ok: false, error: "Failed to process Polar webhook." }, 500);
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
  if (!session.user.emailVerified || !isAdminEmail(session.user.email, deps.adminEmails)) {
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

const AdminRefundSchema = z
  .object({
    targetUserId: z.string().trim().min(1),
    /** "grant" adds credits (default); "deduct" takes them back, never below zero. */
    mode: z.enum(["grant", "deduct"]).default("grant"),
    credits: z.number().int().min(1).max(10000),
    reason: z.string().trim().min(5).max(300),
    idempotencyKey: z.string().trim().min(4).max(120).optional(),
  })
  .refine((v) => v.mode === "deduct" || v.credits <= 1000, {
    message: "Grant at most 1,000 credits at a time.",
    path: ["credits"],
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
    if (parsed.data.mode === "deduct") {
      const res = await issueAdminCreditDeduction(deps.db, {
        adminUserId: auth.session.user.id,
        targetUserId: parsed.data.targetUserId,
        credits: parsed.data.credits,
        reason: parsed.data.reason,
        idempotencyKey: parsed.data.idempotencyKey ?? `adm_ded_${crypto.randomUUID()}`,
        now,
      });
      return jsonNoStore({ ok: true, ...res }, 200);
    }
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

const LiftHoldSchema = z.object({
  userId: z.string().trim().min(1),
  note: z.string().trim().min(5, "Add a short note for the audit log.").max(300),
});

/** Admin: lift a billing hold (after a dispute is settled, or the customer paid again). */
export async function handleAdminLiftHold(
  request: Request,
  deps: BillingHttpDeps
): Promise<Response> {
  const auth = await requireAdminSession(request, deps, true);
  if (!auth.ok) return auth.error;
  const parsed = LiftHoldSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonNoStore(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." },
      400
    );
  }
  const lifted = await liftBillingHold(deps.db, {
    adminUserId: auth.session.user.id,
    userId: parsed.data.userId,
    note: parsed.data.note,
    now: (deps.nowFn ?? (() => new Date()))(),
  });
  if (!lifted) return jsonNoStore({ ok: false, error: "User not found." }, 404);
  return jsonNoStore({ ok: true }, 200);
}

const EVIDENCE_FOOTER = brandFooter("Transaction record · Confidential");

/** Admin: the dispute evidence for one payment as a PDF download. */
export async function handleAdminEvidencePdf(
  request: Request,
  paymentId: string,
  deps: BillingHttpDeps & { browser?: BrowserRunPdfBinding }
): Promise<Response> {
  const auth = await requireAdminSession(request, deps, false);
  if (!auth.ok) return auth.error;
  if (!deps.browser) {
    return jsonNoStore({ ok: false, error: "PDF rendering is not available right now." }, 503);
  }
  const now = (deps.nowFn ?? (() => new Date()))();
  const ev = await buildDisputeEvidence(deps.db, paymentId);
  if (!ev) return jsonNoStore({ ok: false, error: "Payment not found." }, 404);

  let bytes: Uint8Array;
  try {
    bytes = await renderHtmlToPdfBytes(renderEvidenceHtml(ev, now), deps.browser, {
      footerTemplate: EVIDENCE_FOOTER,
    });
  } catch (err) {
    logEvent("error", "billing.evidence_pdf_failed", {
      data: { paymentId, reason: err instanceof Error ? err.message : String(err) },
    });
    return jsonNoStore({ ok: false, error: "The PDF could not be made. Try again." }, 502);
  }

  await deps.db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: auth.session.user.id,
    action: "admin.evidence_downloaded",
    entityType: "payment",
    entityId: ev.payment.id,
    metadataJson: null,
    createdAt: now,
  });

  const safeRef = ev.payment.providerReference
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 24)
    .replace(/[-_]+$/, "");
  const filename = `collate-transaction-record-${safeRef || "payment"}-${now.toISOString().slice(0, 10)}.pdf`;
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Admin: search every payment (any age) by customer email or name, or payment reference. */
export async function handleAdminSearchPayments(
  request: Request,
  deps: BillingHttpDeps
): Promise<Response> {
  const auth = await requireAdminSession(request, deps, false);
  if (!auth.ok) return auth.error;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 2) return jsonNoStore({ ok: false, error: "Type at least 2 characters." }, 400);
  const rows = await loadAdminPayments(deps.db, { query: q, limit: 100 });
  return jsonNoStore({ ok: true, payments: rows }, 200);
}
