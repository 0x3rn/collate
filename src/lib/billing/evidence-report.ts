import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  auditLog,
  chapters,
  chapterVersions,
  creditLedger,
  emailThreads,
  exportsTable,
  paymentReversals,
  payments,
  projects,
  sessions,
  users,
} from "@/db/schema";
import { describeDevice, describeLocation } from "@/lib/account/device";
import { LEGAL_CONFIG } from "@/lib/legal/config";

/**
 * Everything the app knows about one payment and how its credits were used, gathered for a
 * dispute response (Polar's counter form, Paystack's evidence form, or a bank). Read-only.
 */

export interface EvidenceEvent {
  at: Date;
  what: string;
  ip: string | null;
  device: string | null;
  location: string | null;
}

export interface DisputeEvidence {
  payment: typeof payments.$inferSelect;
  customer: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    createdAt: Date;
    holdReason: string | null;
  };
  reversals: Array<typeof paymentReversals.$inferSelect>;
  /** The customer's other paid purchases, oldest first, and whether each was disputed. */
  otherPayments: Array<{
    id: string;
    at: Date;
    provider: string;
    reference: string;
    currency: string;
    amountMinor: number;
    credits: number;
    status: string;
    disputed: boolean;
    when: "before" | "after";
  }>;
  /** termsAccepted: the required tick box was ticked (checkout cannot start without it). */
  checkout: EvidenceEvent & {
    termsVersion: string | null;
    termsAccepted: boolean;
    packId: string | null;
  };
  /** termsAccepted: the required tick box was ticked (no account is created without it). */
  accountCreated: (EvidenceEvent & { termsVersion: string | null; termsAccepted: boolean }) | null;
  emailVerifiedAt: Date | null;
  signIns: EvidenceEvent[];
  activeSessions: EvidenceEvent[];
  creditsUsedSincePayment: number;
  chaptersDelivered: Array<{
    project: string;
    number: number;
    title: string;
    words: number | null;
    finishedAt: Date | null;
  }>;
  downloads: EvidenceEvent[];
  exportsCreated: number;
  supportThreads: Array<{ subject: string; at: Date; mailbox: string }>;
  ipAddressesSeen: string[];
  summary: string;
}

type Meta = {
  ip?: string | null;
  userAgent?: string | null;
  country?: string | null;
  city?: string | null;
  termsVersion?: string;
  termsAccepted?: boolean;
  packId?: string;
  format?: string;
  scope?: string;
};

function parseMeta(json: string | null): Meta {
  if (!json) return {};
  try {
    return JSON.parse(json) as Meta;
  } catch {
    return {};
  }
}

function toEvent(at: Date, what: string, m: Meta): EvidenceEvent {
  return {
    at,
    what,
    ip: m.ip ?? null,
    device: m.userAgent ? describeDevice(m.userAgent).label : null,
    location: m.country || m.city ? describeLocation(m.city ?? null, m.country ?? null) : null,
  };
}

const fmtDate = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
const money = (currency: string, minor: number) =>
  `${currency.toUpperCase()} ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** Only settled payments that actually completed have an enforceable transaction record. */
export function isSettledPaymentStatus(status: string): boolean {
  return status === "succeeded" || status === "refunded";
}

export async function buildDisputeEvidence(
  db: AppDb,
  paymentId: string
): Promise<DisputeEvidence | null> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment || !isSettledPaymentStatus(payment.status)) return null;
  const [user] = await db.select().from(users).where(eq(users.id, payment.userId)).limit(1);
  if (!user) return null;

  const reversals = await db
    .select()
    .from(paymentReversals)
    .where(eq(paymentReversals.paymentId, payment.id))
    .orderBy(desc(paymentReversals.createdAt));

  const allPayments = await db
    .select()
    .from(payments)
    .where(and(eq(payments.userId, user.id), inArray(payments.status, ["succeeded", "refunded"])))
    .orderBy(payments.createdAt);
  const others = allPayments.filter((x) => x.id !== payment.id);
  const disputedIds = new Set(
    others.length
      ? (
          await db
            .select({ paymentId: paymentReversals.paymentId })
            .from(paymentReversals)
            .where(
              and(
                inArray(
                  paymentReversals.paymentId,
                  others.map((x) => x.id)
                ),
                eq(paymentReversals.kind, "dispute")
              )
            )
        ).map((r) => r.paymentId)
      : []
  );
  const otherPayments = others.map((x) => ({
    id: x.id,
    at: x.createdAt,
    provider: x.provider,
    reference: x.providerReference,
    currency: x.currency,
    amountMinor: x.amountMinor,
    credits: x.creditsGranted,
    status: x.status,
    disputed: disputedIds.has(x.id),
    when: (x.createdAt < payment.createdAt ? "before" : "after") as "before" | "after",
  }));

  const userAudit = await db
    .select()
    .from(auditLog)
    .where(
      or(
        eq(auditLog.actorUserId, user.id),
        and(eq(auditLog.entityType, "user"), eq(auditLog.entityId, user.id))
      )
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(500);

  const checkoutRow = userAudit.find(
    (a) => a.action === "billing.checkout_started" && a.entityId === payment.providerReference
  );
  const checkoutMeta = parseMeta(checkoutRow?.metadataJson ?? null);
  const checkout = {
    ...toEvent(checkoutRow?.createdAt ?? payment.createdAt, "Started checkout", checkoutMeta),
    termsVersion: checkoutMeta.termsVersion ?? null,
    termsAccepted: checkoutRow ? checkoutMeta.termsAccepted === true : false,
    packId: checkoutMeta.packId ?? null,
  };

  const signupRow = userAudit.find(
    (a) => a.action === "auth.signup" || a.action === "auth.signup_google"
  );
  const signupMeta = parseMeta(signupRow?.metadataJson ?? null);
  const accountCreated = signupRow
    ? {
        ...toEvent(
          signupRow.createdAt,
          signupRow.action === "auth.signup_google" ? "Signed up with Google" : "Signed up",
          signupMeta
        ),
        termsVersion: signupMeta.termsVersion ?? null,
        termsAccepted: signupMeta.termsAccepted === true,
      }
    : null;
  const verifiedRow = userAudit.find((a) => a.action === "auth.email_verified");

  const signIns = userAudit
    .filter((a) => a.action === "auth.signin" || a.action === "auth.signin_google")
    .slice(0, 50)
    .map((a) =>
      toEvent(
        a.createdAt,
        a.action === "auth.signin_google" ? "Signed in with Google" : "Signed in",
        parseMeta(a.metadataJson)
      )
    );
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, user.id))
    .orderBy(desc(sessions.createdAt))
    .limit(20);
  const activeSessions = sessionRows.map((s) =>
    toEvent(s.createdAt, "Session (still signed in)", {
      ip: s.ipAddress,
      userAgent: s.userAgent,
      city: s.city,
      country: s.country,
    })
  );

  const ledger = await db
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, user.id), gte(creditLedger.createdAt, payment.createdAt)));
  const creditsUsedSincePayment = ledger
    .filter((l) => l.entryType === "reserve" || l.entryType === "capture")
    .reduce((n, l) => n + Math.max(0, -l.creditsDelta), 0);

  const userProjects = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(eq(projects.userId, user.id));
  const projectIds = userProjects.map((p) => p.id);
  const projectTitle = new Map(userProjects.map((p) => [p.id, p.title]));

  const chapterRows = projectIds.length
    ? await db
        .select()
        .from(chapters)
        .where(
          and(inArray(chapters.projectId, projectIds), gte(chapters.updatedAt, payment.createdAt))
        )
    : [];
  const delivered = chapterRows.filter(
    (c) => c.finishedAt && (c.status === "ready" || c.status === "approved")
  );
  const versions = delivered.length
    ? await db
        .select()
        .from(chapterVersions)
        .where(
          inArray(
            chapterVersions.chapterId,
            delivered.map((c) => c.id)
          )
        )
    : [];
  const latestWords = new Map<string, number | null>();
  for (const v of versions.sort((a, b) => a.version - b.version)) {
    latestWords.set(v.chapterId, v.wordCount ?? null);
  }
  const chaptersDelivered = delivered
    .sort((a, b) => (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0))
    .map((c) => ({
      project: projectTitle.get(c.projectId) ?? "",
      number: c.number,
      title: c.title,
      words: latestWords.get(c.id) ?? null,
      finishedAt: c.finishedAt,
    }));

  const downloads = userAudit
    .filter((a) => a.action === "export.downloaded" && a.createdAt >= payment.createdAt)
    .map((a) => {
      const m = parseMeta(a.metadataJson);
      return toEvent(
        a.createdAt,
        `Downloaded ${m.scope === "full" ? "full document" : "chapter"} (${(m.format ?? "").toUpperCase()})`,
        m
      );
    });
  const exportsCreated = projectIds.length
    ? (
        await db
          .select({ id: exportsTable.id })
          .from(exportsTable)
          .where(
            and(
              inArray(exportsTable.projectId, projectIds),
              gte(exportsTable.createdAt, payment.createdAt)
            )
          )
      ).length
    : 0;

  const threads = await db
    .select()
    .from(emailThreads)
    .where(or(eq(emailThreads.userId, user.id), eq(emailThreads.contactEmail, user.email)))
    .orderBy(desc(emailThreads.createdAt))
    .limit(20);
  const supportThreads = threads.map((t) => ({
    subject: t.subject,
    at: t.createdAt,
    mailbox: t.mailbox,
  }));

  const ipAddressesSeen = [
    ...new Set(
      [checkout, accountCreated, ...signIns, ...activeSessions, ...downloads]
        .map((e) => e?.ip)
        .filter((ip): ip is string => Boolean(ip))
    ),
  ];

  const summary = buildSummary({
    payment,
    user,
    checkout,
    accountCreated,
    emailVerifiedAt: verifiedRow?.createdAt ?? null,
    creditsUsedSincePayment,
    chaptersDelivered,
    downloads,
    signInCount: signIns.length,
    supportThreadCount: supportThreads.length,
    otherPayments,
  });

  return {
    payment,
    customer: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      holdReason: user.billingHoldReason,
    },
    reversals,
    otherPayments,
    checkout,
    accountCreated,
    emailVerifiedAt: verifiedRow?.createdAt ?? null,
    signIns,
    activeSessions,
    creditsUsedSincePayment,
    chaptersDelivered,
    downloads,
    exportsCreated,
    supportThreads,
    ipAddressesSeen,
    summary,
  };
}

/** A plain statement to paste into Polar's or Paystack's dispute form. */
function buildSummary(p: {
  payment: typeof payments.$inferSelect;
  user: typeof users.$inferSelect;
  checkout: DisputeEvidence["checkout"];
  accountCreated: DisputeEvidence["accountCreated"];
  emailVerifiedAt: Date | null;
  creditsUsedSincePayment: number;
  chaptersDelivered: DisputeEvidence["chaptersDelivered"];
  downloads: EvidenceEvent[];
  signInCount: number;
  supportThreadCount: number;
  otherPayments: DisputeEvidence["otherPayments"];
}): string {
  const parts: string[] = [];
  parts.push(
    `${LEGAL_CONFIG.serviceName} (${LEGAL_CONFIG.siteUrl}) sells prepaid credits that are spent to generate academic chapter drafts. ` +
      `On ${fmtDate(p.payment.createdAt)}, ${p.user.name} (${p.user.email}) paid ${money(p.payment.currency, p.payment.amountMinor)} via ${p.payment.provider === "polar" ? "Polar" : "Paystack"} (reference ${p.payment.providerReference}) for ${p.payment.creditsGranted} credits.`
  );
  if (p.checkout.termsAccepted) {
    parts.push(
      `Before paying, the customer ticked a box agreeing to our Terms of Service and Refund Policy${p.checkout.termsVersion ? ` (version ${p.checkout.termsVersion})` : ""}` +
        (p.checkout.ip
          ? `, from IP address ${p.checkout.ip}${p.checkout.location ? ` (${p.checkout.location})` : ""}${p.checkout.device ? ` on ${p.checkout.device}` : ""}`
          : "") +
        ". Checkout cannot start without ticking this box."
    );
  }
  if (p.accountCreated) {
    parts.push(
      `The account was created on ${fmtDate(p.accountCreated.at)}` +
        (p.accountCreated.ip ? ` from IP address ${p.accountCreated.ip}` : "") +
        (p.accountCreated.termsAccepted
          ? `, after the customer ticked a box agreeing to our Terms of Service (an account cannot be created without it)`
          : "") +
        (p.emailVerifiedAt
          ? `, and the customer confirmed they own ${p.user.email} on ${fmtDate(p.emailVerifiedAt)}`
          : "") +
        "."
    );
  }
  if (p.creditsUsedSincePayment > 0 || p.chaptersDelivered.length > 0) {
    const titles = p.chaptersDelivered
      .slice(0, 8)
      .map(
        (c) =>
          `Chapter ${c.number}: ${c.title}${c.words ? ` (${c.words.toLocaleString("en-US")} words)` : ""}`
      )
      .join("; ");
    parts.push(
      `After the payment, the customer spent ${p.creditsUsedSincePayment} credits and received ${p.chaptersDelivered.length} completed chapter${p.chaptersDelivered.length === 1 ? "" : "s"}${titles ? `: ${titles}` : ""}.`
    );
  }
  if (p.downloads.length > 0) {
    const ips = [...new Set(p.downloads.map((d) => d.ip).filter(Boolean))];
    parts.push(
      `The customer downloaded the finished documents ${p.downloads.length} time${p.downloads.length === 1 ? "" : "s"} between ${fmtDate(p.downloads[p.downloads.length - 1]!.at)} and ${fmtDate(p.downloads[0]!.at)}` +
        (ips.length ? ` from IP address${ips.length === 1 ? "" : "es"} ${ips.join(", ")}` : "") +
        "."
    );
  }
  const earlierClean = p.otherPayments.filter(
    (x) => x.when === "before" && !x.disputed && x.status === "succeeded"
  );
  if (earlierClean.length > 0) {
    parts.push(
      `Before this payment, the same account made ${earlierClean.length} other payment${earlierClean.length === 1 ? "" : "s"} that ${earlierClean.length === 1 ? "was" : "were"} not disputed (${earlierClean
        .map((x) => `${fmtDate(x.at)}, ${money(x.currency, x.amountMinor)}`)
        .join("; ")}).`
    );
  }
  const later = p.otherPayments.filter((x) => x.when === "after" && x.status === "succeeded");
  if (later.length > 0) {
    parts.push(
      `After this payment, the customer chose to buy more credits ${later.length} more time${later.length === 1 ? "" : "s"} (${later
        .map((x) => `${fmtDate(x.at)}, ${money(x.currency, x.amountMinor)}`)
        .join("; ")}).`
    );
  }
  if (p.signInCount > 0) {
    parts.push(
      `The account signed in ${p.signInCount} time${p.signInCount === 1 ? "" : "s"} using its password or Google account.`
    );
  }
  // Only claim delivery when the records show the customer used the service.
  if (p.creditsUsedSincePayment > 0 || p.chaptersDelivered.length > 0) {
    parts.push(
      "The service was delivered as described. Section 5.5 of our Refund Policy states that credits already spent on completed chapters are not refundable."
    );
  }
  parts.push(
    "Section 5.7 of our Refund Policy asks customers to contact support before filing a chargeback."
  );
  if (p.supportThreadCount === 0) {
    parts.push(
      "We have no record of this customer contacting our support, billing or general addresses."
    );
  }
  return parts.join(" ");
}

const shortDate = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";

function fromWhere(e: EvidenceEvent): string {
  return [e.ip, e.location, e.device].filter(Boolean).join(", ");
}

/** "At checkout" line for the record (page and PDF). */
export const CHECKOUT_TERMS_RULE = "(users can't check out without agreeing to these terms)";
export const SIGNUP_TERMS_RULE = "(users can't sign up without agreeing to these terms)";

export function describeCheckoutAgreement(ev: DisputeEvidence): string {
  const c = ev.checkout;
  if (!c.termsAccepted) return `Not recorded ${CHECKOUT_TERMS_RULE}`;
  const where = fromWhere(c);
  return `Agreed to the Terms of Service and Refund Policy${c.termsVersion ? ` (version ${c.termsVersion})` : ""} on ${shortDate(c.at)}${where ? `, from ${where}` : ""} ${CHECKOUT_TERMS_RULE}`;
}

/** "At sign-up" line for the record (page and PDF). */
export function describeSignupAgreement(ev: DisputeEvidence): string {
  const a = ev.accountCreated;
  if (!a) return `Account created ${shortDate(ev.customer.createdAt)} ${SIGNUP_TERMS_RULE}`;
  const where = fromWhere(a);
  return `${a.what} on ${shortDate(a.at)}${a.termsVersion ? `, agreeing to the Terms of Service (version ${a.termsVersion})` : ""}${where ? `, from ${where}` : ""} ${SIGNUP_TERMS_RULE}`;
}
