import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "cloudflare:workers";
import { ArrowLeftIcon } from "@/components/layout/workspace-icons";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { SetupWizardClient } from "@/components/wizard/setup-wizard-client";
import { getCurrentUserWizardState } from "@/lib/auth/server";
import { formatProjectType } from "@/lib/ui/formatters";
import { serializeWizardState } from "@/lib/wizard/http-handlers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Project setup | Collate",
  description: "Configure your topic, length, chapters, citations, and formatting.",
};

export default async function ProjectSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, state } = await getCurrentUserWizardState(id, `/projects/${id}/setup`);

  if (!state) {
    notFound();
  }

  const serialized = serializeWizardState(state);
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  const allowDevPreview = runtimeEnv.APP_ENV?.trim() === "dev";

  return (
    <WorkspaceShell user={user} maxWidthClassName="max-w-[860px]">
      <div className="space-y-6">
        <div className="space-y-3">
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--neutral-600)] hover:text-[var(--neutral-900)] transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4 shrink-0" />
            <span>Back to projects</span>
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <h1 className="text-[1.875rem] font-medium">
              {formatProjectType(serialized.project.type)} setup
            </h1>
            <p className="text-xs text-[var(--neutral-500)]">Saved automatically after each step</p>
          </div>
        </div>

        <SetupWizardClient initialWizard={serialized} allowDevPreview={allowDevPreview} />
      </div>
    </WorkspaceShell>
  );
}
