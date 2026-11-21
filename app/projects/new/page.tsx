import type { Metadata } from "next";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { LinkButton } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New project — Collate",
  description: "Start a new project, thesis, research paper, or assignment.",
};

export default async function NewProjectPlaceholderPage() {
  const user = await requireUser("/projects/new");

  return (
    <>
      <SiteHeader user={user} />
      <main className="flex-1 mx-auto w-full max-w-[720px] px-4 sm:px-6 py-12">
        <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-8 space-y-5">
          <p className="text-xs font-medium text-[var(--accent-600)]">Next up · Phase 2</p>
          <h1 className="text-[1.875rem] font-medium">Project setup wizard</h1>
          <p className="text-[var(--neutral-600)] leading-relaxed">
            Your account is active and isolated to your session. The guided setup wizard—where you
            choose Project, Research paper, Thesis, or Assignment, define chapters, and configure
            citations and formatting—is built next in Phase 2.
          </p>
          <LinkButton href="/dashboard" variant="secondary">
            Back to projects
          </LinkButton>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
