import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { CreditsPanel } from "@/components/account/credits-panel";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { FormAlert } from "@/components/ui/alert";
import { BILLING_POLICY } from "@/config/pricing";
import { createDb } from "@/db/client";
import { creditLedger } from "@/db/schema";
import { requireUser } from "@/lib/auth/server";
import { countUserNonFailedSweeps } from "@/lib/billing/ledger";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Credits & Billing — Collate",
  description: "Check your credit balance, buy credit packs, and review your credit history.",
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const user = await requireUser("/billing");
  const { payment } = await searchParams;
  const db = createDb(env.DB);

  const [ledgerRows, sweepsUsed] = await Promise.all([
    db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, user.id))
      .orderBy(desc(creditLedger.createdAt))
      .limit(20),
    countUserNonFailedSweeps(db, user.id),
  ]);

  const freeSweepsRemaining = Math.max(0, BILLING_POLICY.freeFeasibilitySweepsPerUser - sweepsUsed);

  return (
    <WorkspaceShell user={user} maxWidthClassName="max-w-[960px]">
      <div className="space-y-6">
        <header className="space-y-1 pb-5 border-b border-[var(--neutral-200)]">
          <h1 className="text-[1.875rem] sm:text-[2.125rem] font-medium m-0">
            Credits &amp; Billing
          </h1>
          <p className="text-sm sm:text-base text-[var(--neutral-600)] m-0">
            Pay as you write — one credit per target page, with automatic refunds if any draft
            fails.
          </p>
        </header>

        {payment === "stripe_success" ? (
          <FormAlert tone="success">
            Payment received. Your new credits will appear in your balance within a few seconds —
            refresh if they have not updated yet.
          </FormAlert>
        ) : payment === "paystack_pending" ? (
          <FormAlert tone="info">
            Payment submitted. Your credits are added automatically as soon as Paystack confirms the
            charge.
          </FormAlert>
        ) : payment === "stripe_cancelled" ? (
          <FormAlert tone="warning">
            Checkout was cancelled. No charge was made to your card.
          </FormAlert>
        ) : null}

        {/* Balance & free checks summary */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-1">
            <p className="text-xs font-medium text-[var(--neutral-500)] m-0">Available credits</p>
            <p className="text-3xl font-semibold text-[var(--neutral-900)] tabular-nums m-0">
              {user.creditsBalance}
            </p>
            <p className="text-xs text-[var(--neutral-600)] m-0">
              Minimum {BILLING_POLICY.minCreditsPerChapter} credits per chapter · Unused credits
              never expire.
            </p>
          </div>

          <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-1">
            <p className="text-xs font-medium text-[var(--neutral-500)] m-0">
              Free topic source checks
            </p>
            <p className="text-3xl font-semibold text-[var(--neutral-900)] tabular-nums m-0">
              {freeSweepsRemaining}{" "}
              <span className="text-base font-normal text-[var(--neutral-500)]">
                of {BILLING_POLICY.freeFeasibilitySweepsPerUser} left
              </span>
            </p>
            <p className="text-xs text-[var(--neutral-600)] m-0">
              After your free checks, each extra topic check uses{" "}
              {BILLING_POLICY.paidFeasibilitySweepCredits} credits.
            </p>
          </div>
        </section>

        <CreditsPanel
          balance={user.creditsBalance}
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
