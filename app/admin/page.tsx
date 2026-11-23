import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import { desc, sql } from "drizzle-orm";
import { AdminDashboardClient } from "@/components/admin/admin-dashboard-client";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FormAlert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { createDb } from "@/db/client";
import { jobsLog, payments, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/server";
import { isAdminEmail } from "@/lib/billing/http-handlers";
import { checkSpendCircuitBreaker } from "@/lib/billing/ledger";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin operations — Collate",
  description: "Monitor users, AI job costs, failures, circuit breakers, and manual refunds.",
};

export default async function AdminPage() {
  const user = await requireUser("/admin");
  const runtimeEnv = env as unknown as Record<string, string | undefined>;

  if (!isAdminEmail(user.email, runtimeEnv.ADMIN_EMAILS)) {
    return (
      <>
        <SiteHeader user={user} />
        <main className="flex-1 mx-auto w-full max-w-[600px] px-4 sm:px-6 py-16 space-y-5">
          <FormAlert tone="error">
            Admin authorization required. Your account does not have operator access.
          </FormAlert>
          <LinkButton href="/dashboard" variant="secondary">
            Back to projects
          </LinkButton>
        </main>
        <SiteFooter />
      </>
    );
  }

  const db = createDb(env.DB);
  const breaker = await checkSpendCircuitBreaker(db);
  const [totalCostRow] = await db
    .select({ total: sql<number>`coalesce(sum(${jobsLog.costEstimateUsd}), 0)` })
    .from(jobsLog);

  const recentUsers = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      creditsBalance: users.creditsBalance,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(30);

  const recentJobs = await db.select().from(jobsLog).orderBy(desc(jobsLog.createdAt)).limit(25);
  const recentPayments = await db
    .select()
    .from(payments)
    .orderBy(desc(payments.createdAt))
    .limit(25);

  return (
    <>
      <SiteHeader user={user} />
      <main className="flex-1 mx-auto w-full max-w-[1040px] px-4 sm:px-6 py-10 sm:py-12 space-y-8">
        <div className="border-b border-[var(--neutral-200)] pb-5">
          <h1 className="text-[2rem] font-medium">Admin operations</h1>
          <p className="text-sm text-[var(--neutral-600)] mt-1">
            Monitor users, AI job costs, failures, spend circuit breakers, and manual refunds.
          </p>
        </div>

        <AdminDashboardClient
          initial={{
            circuitBreaker: breaker,
            allTimeLlmCostUsd: Number(totalCostRow?.total ?? 0),
            users: recentUsers,
            recentJobs: recentJobs.map((j) => ({
              id: j.id,
              step: j.step,
              model: j.model,
              status: j.status,
              costEstimateUsd: j.costEstimateUsd,
              error: j.error,
              createdAt: j.createdAt.toISOString(),
            })),
            recentPayments: recentPayments.map((p) => ({
              id: p.id,
              userId: p.userId,
              provider: p.provider,
              providerReference: p.providerReference,
              currency: p.currency,
              amountMinor: p.amountMinor,
              creditsGranted: p.creditsGranted,
              status: p.status,
            })),
          }}
        />
      </main>
      <SiteFooter />
    </>
  );
}
