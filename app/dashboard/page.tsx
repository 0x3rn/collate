import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import Link from "next/link";
import { OverviewLedgerClient } from "@/components/dashboard/overview-ledger-client";
import { QuickStartWorkbench } from "@/components/dashboard/quick-start-workbench";
import { ArrowRightIcon, DownloadIcon } from "@/components/layout/workspace-icons";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { BILLING_POLICY } from "@/config/pricing";
import { createDb } from "@/db/client";
import { getDashboardOverviewForUser, resolveExportSigningSecret } from "@/db/queries/dashboard";
import { requireUser } from "@/lib/auth/server";
import {
  formatCredits,
  formatExportFormat,
  formatExportScope,
  formatShortDate,
} from "@/lib/ui/formatters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Overview | Collate",
  description: "Start a topic check, continue active drafts, and access recent exports.",
};

export default async function DashboardOverviewPage() {
  const user = await requireUser("/dashboard");
  const db = createDb(env.DB);
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  const signingSecret = resolveExportSigningSecret({
    configuredSecret: runtimeEnv.EXPORT_SIGNING_SECRET,
    appEnv: runtimeEnv.APP_ENV,
  });

  const overview = await getDashboardOverviewForUser(db, user.id, { signingSecret });
  const { stats, attentionItems, recentProjects, recentExports } = overview;
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;
  const freeSweepsTotal = BILLING_POLICY.freeFeasibilitySweepsPerUser;
  const sweepPct = Math.min(
    100,
    Math.max(0, Math.round((stats.freeSweepsRemaining / Math.max(1, freeSweepsTotal)) * 100))
  );

  return (
    <WorkspaceShell user={user}>
      <div className="space-y-6">
        {/* Slim editorial header with inline metadata ribbon (zero KPI boxes) */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-[var(--neutral-200)]">
          <div className="space-y-1">
            <h1 className="text-[1.75rem] sm:text-[2rem] font-medium leading-tight">
              Welcome back, {firstName}
            </h1>
            <p className="text-sm text-[var(--neutral-600)]">
              Check new topics against credible sources or pick up an active draft.
            </p>
          </div>

          <dl className="flex items-center gap-x-3.5 text-xs text-[var(--neutral-600)] tabular-nums whitespace-nowrap shrink-0">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Ongoing projects</dt>
              <dd>
                <strong className="font-semibold text-[var(--neutral-900)]">
                  {stats.activeProjects}
                </strong>{" "}
                ongoing
              </dd>
            </div>
            <span aria-hidden="true" className="text-[var(--neutral-300)]">
              |
            </span>
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Ready for review</dt>
              <dd>
                <strong
                  className={
                    stats.chaptersReadyForReview > 0
                      ? "font-semibold text-[var(--accent-600)]"
                      : "font-semibold text-[var(--neutral-900)]"
                  }
                >
                  {stats.chaptersReadyForReview}
                </strong>{" "}
                to review
              </dd>
            </div>
          </dl>
        </header>

        {/* Signature Hunter-inspired action-first Quick-Start Workbench */}
        <QuickStartWorkbench />

        {/* Editorial 8 / 4 asymmetric ledger + allowance/files rail */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8">
            <OverviewLedgerClient
              recentProjects={recentProjects}
              totalProjects={stats.totalProjects}
              attentionItems={attentionItems}
              freeSweepsRemaining={stats.freeSweepsRemaining}
            />
          </div>

          <aside className="lg:col-span-4 space-y-5">
            {/* Clean horizontal allowance & credits meter (Hunter.io style) */}
            <section
              aria-label="Account allowance"
              className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] divide-y divide-[var(--neutral-200)]"
            >
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[var(--neutral-900)]">Free topic checks</span>
                  <span className="tabular-nums text-[var(--neutral-600)]">
                    {stats.freeSweepsRemaining} / {freeSweepsTotal} left
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[var(--neutral-100)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent-600)] transition-all duration-300"
                    style={{ width: `${sweepPct}%` }}
                  />
                </div>
                <p className="text-xs text-[var(--neutral-500)] leading-relaxed">
                  Extra topic checks cost {BILLING_POLICY.paidFeasibilitySweepCredits} credits each
                  after your free checks.
                </p>
              </div>

              <div className="p-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-[var(--neutral-500)]">Writing credits</p>
                  <p className="text-lg font-semibold text-[var(--neutral-900)] tabular-nums mt-0.5">
                    {formatCredits(user.creditsBalance)}
                  </p>
                </div>
                <Link
                  href="/billing"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-600)] hover:text-[var(--accent-700)] group"
                >
                  <span>Top up</span>
                  <ArrowRightIcon className="w-3.5 h-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
                </Link>
              </div>
            </section>

            {/* Recent exports hairline panel */}
            <section
              aria-label="Recent exports"
              className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden"
            >
              <div className="px-5 py-3.5 border-b border-[var(--neutral-200)] flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--neutral-900)]">Recent exports</h2>
                <Link
                  href="/exports"
                  className="text-xs font-medium text-[var(--accent-600)] hover:underline underline-offset-4"
                >
                  All files
                </Link>
              </div>

              {recentExports.length === 0 ? (
                <div className="p-5 space-y-1">
                  <p className="text-xs font-medium text-[var(--neutral-800)]">No exports yet</p>
                  <p className="text-xs text-[var(--neutral-500)] leading-relaxed">
                    Finished PDF and Word documents from your projects will appear here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-[var(--neutral-200)] list-none p-0">
                  {recentExports.map((exp) => (
                    <li
                      key={exp.id}
                      className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-[var(--neutral-50)] transition-colors"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <Link
                          href={`/projects/${exp.projectId}`}
                          className="text-xs font-semibold text-[var(--neutral-900)] hover:text-[var(--accent-600)] block truncate"
                        >
                          {exp.projectTitle}
                        </Link>
                        <p className="text-[11px] text-[var(--neutral-500)] tabular-nums">
                          {formatExportFormat(exp.format)} ·{" "}
                          {formatExportScope(exp.scope, exp.chapterNumber)} ·{" "}
                          {formatShortDate(exp.createdAt)}
                        </p>
                      </div>

                      {exp.downloadUrl ? (
                        <a
                          href={exp.downloadUrl}
                          aria-label={`Download ${exp.projectTitle}`}
                          className="w-8 h-8 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-white hover:bg-[var(--neutral-100)] text-[var(--accent-600)] grid place-items-center shrink-0 transition-colors"
                        >
                          <DownloadIcon className="w-3.5 h-3.5" />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>
    </WorkspaceShell>
  );
}
