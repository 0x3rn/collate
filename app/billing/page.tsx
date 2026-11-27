import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { CreditsPanel } from "@/components/account/credits-panel";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { PaymentStatusToast } from "@/components/account/payment-status-toast";
import { BILLING_POLICY } from "@/config/pricing";
import { createDb } from "@/db/client";
import { creditLedger, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/server";
import { verifyAndSettlePaystackCallback } from "@/lib/billing/http-handlers";
import { countUserNonFailedSweeps } from "@/lib/billing/ledger";
import { type CloudflareEmailBinding, createEmailSender } from "@/lib/email/mailer";
import { createTelegramNotifier } from "@/lib/notify/admin-alerts";
import { formatCredits } from "@/lib/ui/formatters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Credits & Billing | Collate",
  description: "Check your credit balance, buy credit packs, and review your credit history.",
  robots: { index: false, follow: false },
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string; reference?: string; trxref?: string }>;
}) {
  const user = await requireUser("/billing");
  const { payment, reference, trxref } = await searchParams;
  const db = createDb(env.DB);
  const runtimeEnv = env as unknown as Record<string, string | undefined>;

  let effectivePaymentParam = payment;
  const paystackRef = (reference ?? trxref)?.trim();
  if ((payment === "pending" || payment === "paystack_pending") && paystackRef) {
    const verification = await verifyAndSettlePaystackCallback(
      { reference: paystackRef, userId: user.id },
      {
        db,
        mailer: createEmailSender({
          EMAIL_PROVIDER: runtimeEnv.EMAIL_PROVIDER,
          EMAIL_FROM: runtimeEnv.EMAIL_FROM,
          EMAIL_REPLY_TO: runtimeEnv.EMAIL_REPLY_TO,
          APP_URL: runtimeEnv.APP_URL,
          binding: (env as unknown as { EMAIL?: CloudflareEmailBinding }).EMAIL ?? null,
        }),
        appUrl: runtimeEnv.APP_URL?.trim() || "https://collateresearch.app",
        adminNotifier: createTelegramNotifier(runtimeEnv),
        paystackSecretKey: runtimeEnv.PAYSTACK_SECRET_KEY,
      }
    );
    if (verification.status === "succeeded") {
      effectivePaymentParam = "success";
    } else if (verification.status === "failed") {
      effectivePaymentParam = "failed";
    } else if (verification.status === "cancelled") {
      effectivePaymentParam = "cancelled";
    }
  }

  const [freshUserRows, ledgerRows, sweepsUsed] = await Promise.all([
    db
      .select({ creditsBalance: users.creditsBalance })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1),
    db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, user.id))
      .orderBy(desc(creditLedger.createdAt))
      .limit(20),
    countUserNonFailedSweeps(db, user.id),
  ]);

  const currentUser = {
    ...user,
    creditsBalance: freshUserRows[0]?.creditsBalance ?? user.creditsBalance,
  };

  const freeSweepsTotal = BILLING_POLICY.freeFeasibilitySweepsPerUser;
  const freeSweepsRemaining = Math.max(0, freeSweepsTotal - sweepsUsed);
  const sweepPct = Math.min(
    100,
    Math.max(0, Math.round((freeSweepsRemaining / Math.max(1, freeSweepsTotal)) * 100))
  );

  return (
    <WorkspaceShell user={currentUser} maxWidthClassName="max-w-[980px]">
      <div className="space-y-6">
        <header className="space-y-1 pb-5 border-b border-[var(--neutral-200)]">
          <h1 className="text-[1.75rem] sm:text-[2rem] font-medium leading-tight">
            Credits &amp; Billing
          </h1>
          <p className="text-sm text-[var(--neutral-600)]">
            Pay as you write: one credit per target page, with automatic refunds if any draft fails.
          </p>
        </header>

        <PaymentStatusToast payment={effectivePaymentParam} />

        {/* Unified horizontal allowance bar (no separate KPI boxes) */}
        <section
          aria-label="Current balance and free topic checks"
          className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--neutral-200)]"
        >
          <div className="p-5 sm:p-6 flex items-baseline justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--neutral-500)]">Writing credits</p>
              <p className="text-2xl font-semibold text-[var(--neutral-900)] tabular-nums">
                {formatCredits(currentUser.creditsBalance)}
              </p>
              <p className="text-xs text-[var(--neutral-500)]">Credits never expire</p>
            </div>
          </div>

          <div className="p-5 sm:p-6 space-y-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-[var(--neutral-500)]">
                Free topic source checks
              </p>
              <p className="text-sm font-semibold text-[var(--neutral-900)] tabular-nums">
                {freeSweepsRemaining} of {freeSweepsTotal} left
              </p>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--neutral-100)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent-600)] transition-all duration-300"
                style={{ width: `${sweepPct}%` }}
              />
            </div>
            <p className="text-xs text-[var(--neutral-500)]">
              Additional topic checks use {BILLING_POLICY.paidFeasibilitySweepCredits} credits each.
            </p>
          </div>
        </section>

        <CreditsPanel
          recentLedger={ledgerRows.map((row) => ({
            id: row.id,
            entryType: row.entryType,
            creditsDelta: row.creditsDelta,
            balanceAfter: row.balanceAfter,
            note: row.note,
            createdAt: row.createdAt.toISOString(),
          }))}
        />
      </div>
    </WorkspaceShell>
  );
}
