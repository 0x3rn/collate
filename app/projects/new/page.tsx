import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
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
    <>
      <SiteHeader user={user} />
      <main className="flex-1 mx-auto w-full max-w-[820px] px-4 sm:px-6 py-10 sm:py-12 space-y-6">
        <div className="space-y-2">
          <Link
            href="/dashboard"
            className="text-sm text-[var(--neutral-600)] hover:text-[var(--neutral-900)] underline underline-offset-4"
          >
            Back to projects
          </Link>
          <h1 className="text-[2rem] font-medium">What are you working on?</h1>
          <p className="text-[var(--neutral-600)]">
            Your progress is saved after every step so you can leave and resume at any time.
          </p>
        </div>

        <NewProjectSelector />
      </main>
      <SiteFooter />
    </>
  );
}
