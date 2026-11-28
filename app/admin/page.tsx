import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import { desc, eq, sql } from "drizzle-orm";
import { AdminDashboardClient } from "@/components/admin/admin-dashboard-client";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { FormAlert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { createDb } from "@/db/client";
import { jobsLog, projects, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/server";
import { isAdminEmail } from "@/lib/billing/http-handlers";
import { checkSpendCircuitBreaker } from "@/lib/billing/ledger";
import { describeJobStep, shortTopic } from "@/lib/admin/job-labels";
import { loadAdminPayments } from "@/lib/billing/admin-payments";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin operations | Collate",
  description: "Users, what each draft cost, failures, drafting pauses, and credit grants.",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const user = await requireUser("/admin");
  const runtimeEnv = env as unknown as Record<string, string | undefined>;

  if (!isAdminEmail(user.email, runtimeEnv.ADMIN_EMAILS)) {
    return (
      <WorkspaceShell user={user} maxWidthClassName="max-w-[600px]">
        <div className="py-8 space-y-5">
          <FormAlert tone="error">
            Admin authorization required. Your account does not have operator access.
          </FormAlert>
          <LinkButton href="/dashboard" variant="secondary">
            Back to overview
          </LinkButton>
        </div>
      </WorkspaceShell>
    );
  }

  const db = createDb(env.DB);
  const breaker = await checkSpendCircuitBreaker(db);
  const [totalCostRow] = await db
    .select({ total: sql<number>`coalesce(sum(${jobsLog.costEstimateUsd}), 0)` })
    .from(jobsLog);

  const [totalUsersRow] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const totalUsersCount = Number(totalUsersRow?.count ?? 0);

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

  const recentJobs = await db
    .select({
      job: jobsLog,
      projectTitle: projects.title,
      userId: users.id,
      userEmail: users.email,
    })
    .from(jobsLog)
    .leftJoin(projects, eq(projects.id, jobsLog.projectId))
    .leftJoin(users, eq(users.id, projects.userId))
    .orderBy(desc(jobsLog.createdAt))
    .limit(200);
  const recentPayments = await loadAdminPayments(db);

  return (
    <WorkspaceShell user={user} maxWidthClassName="max-w-[1440px]">
      <div className="space-y-8">
        <div className="border-b border-[var(--neutral-200)] pb-5 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-[2rem] font-medium">Admin operations</h1>
          <LinkButton href="/admin/inbox" variant="secondary">
            Email
          </LinkButton>
        </div>

        <AdminDashboardClient
          initial={{
            circuitBreaker: breaker,
            allTimeLlmCostUsd: Number(totalCostRow?.total ?? 0),
            totalUsersCount,
            users: recentUsers,
            recentJobs: recentJobs.map(({ job: j, projectTitle, userId, userEmail }) => ({
              id: j.id,
              step: describeJobStep(j.step),
              model: j.model,
              status: j.status,
              costEstimateUsd: j.costEstimateUsd,
              error: j.error,
              createdAt: j.createdAt.toISOString(),
              projectId: j.projectId,
              projectTopic: shortTopic(projectTitle),
              userId,
              userEmail,
            })),
            recentPayments,
          }}
        />
      </div>
    </WorkspaceShell>
  );
}
