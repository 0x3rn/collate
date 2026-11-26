import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import { ProjectsDirectoryClient } from "@/components/dashboard/projects-directory-client";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { LinkButton } from "@/components/ui/button";
import { createDb } from "@/db/client";
import { listEnrichedProjectsForUser } from "@/db/queries/dashboard";
import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Projects | Collate",
  description: "Browse and filter your ongoing, completed, and archived projects.",
  robots: { index: false, follow: false },
};

export default async function ProjectsPage() {
  const user = await requireUser("/projects");
  const db = createDb(env.DB);
  const { projects } = await listEnrichedProjectsForUser(db, user.id);

  return (
    <WorkspaceShell user={user}>
      <div className="space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-[1.875rem] sm:text-[2.125rem] font-medium">Projects</h1>
            <p className="text-sm sm:text-base text-[var(--neutral-600)]">
              View your ongoing drafts, finished manuscripts, and past work in one place.
            </p>
          </div>
          <LinkButton href="/projects/new" variant="primary" className="shrink-0 w-fit">
            Start a new project
          </LinkButton>
        </header>

        <ProjectsDirectoryClient projects={projects} />
      </div>
    </WorkspaceShell>
  );
}
