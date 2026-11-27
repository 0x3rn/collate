import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "@/components/layout/workspace-icons";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { NewProjectSelector } from "@/components/wizard/new-project-selector";
import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start a new project | Collate",
  description: "Choose whether you are writing a project, research paper, thesis, or assignment.",
};

export default async function NewProjectPage() {
  const user = await requireUser("/projects/new");

  return (
    <WorkspaceShell user={user} maxWidthClassName="max-w-[1120px]">
      <div className="space-y-6">
        <div className="space-y-4">
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--neutral-600)] hover:text-[var(--neutral-900)] transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4 shrink-0" />
            <span>Back to projects</span>
          </Link>
          <div className="space-y-1.5">
            <h1 className="text-[1.875rem] sm:text-[2rem] font-medium">What are you working on?</h1>
            <p className="text-sm sm:text-base text-[var(--neutral-600)]">
              Your progress is saved after every step so you can leave and resume at any time.
            </p>
          </div>
        </div>

        <NewProjectSelector />
      </div>
    </WorkspaceShell>
  );
}
