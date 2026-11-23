import type { Metadata } from "next";
import Link from "next/link";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { NewProjectSelector } from "@/components/wizard/new-project-selector";
import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start a new project — Collate",
  description: "Choose whether you are writing a project, research paper, thesis, or assignment.",
};

export default async function NewProjectPage() {
  const user = await requireUser("/projects/new");

  return (
    <WorkspaceShell user={user} maxWidthClassName="max-w-[820px]">
      <div className="space-y-6">
        <div className="space-y-2">
          <Link
            href="/projects"
            className="text-sm text-[var(--neutral-600)] hover:text-[var(--neutral-900)] underline underline-offset-4"
          >
            Back to projects
          </Link>
          <h1 className="text-[2rem] font-medium m-0">What are you working on?</h1>
          <p className="text-[var(--neutral-600)] m-0">
            Your progress is saved after every step so you can leave and resume at any time.
          </p>
        </div>

        <NewProjectSelector />
      </div>
    </WorkspaceShell>
  );
}
