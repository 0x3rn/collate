import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SetupWizardClient } from "@/components/wizard/setup-wizard-client";
import { getCurrentUserWizardState } from "@/lib/auth/server";
import { formatProjectType } from "@/lib/ui/formatters";
import { serializeWizardState } from "@/lib/wizard/http-handlers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Project setup — Collate",
  description: "Configure your topic, length, chapters, citations, and formatting.",
};

export default async function ProjectSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, state } = await getCurrentUserWizardState(id, `/projects/${id}/setup`);

  if (!state) {
    notFound();
  }

  const serialized = serializeWizardState(state);

  return (
    <>
      <SiteHeader user={user} />
      <main className="flex-1 mx-auto w-full max-w-[860px] px-4 sm:px-6 py-10 sm:py-12 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div className="space-y-1">
            <Link
              href="/dashboard"
              className="text-sm text-[var(--neutral-600)] hover:text-[var(--neutral-900)] underline underline-offset-4"
            >
              Back to projects
            </Link>
            <h1 className="text-[1.875rem] font-medium">
              {formatProjectType(serialized.project.type)} setup
            </h1>
          </div>
          <p className="text-xs text-[var(--neutral-500)] m-0">
            Saved automatically to your account after each step
          </p>
        </div>

        <SetupWizardClient initialWizard={serialized} />
      </main>
      <SiteFooter />
    </>
  );
}
