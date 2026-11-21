import type { Metadata } from "next";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FormAlert } from "@/components/ui/alert";
import { getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms of service — Collate",
  description: "Draft terms of service and academic-integrity positioning for Collate.",
};

export default async function TermsPage() {
  const user = await getCurrentUser();

  return (
    <>
      <SiteHeader user={user} />
      <main className="flex-1 mx-auto w-full max-w-[740px] px-4 sm:px-6 py-12 space-y-8">
        <div className="space-y-2 border-b border-[var(--neutral-200)] pb-6">
          <h1 className="text-[2rem] font-medium">Terms of service</h1>
          <p className="text-sm text-[var(--neutral-600)]">
            Pre-launch draft — must undergo legal review before public release.
          </p>
        </div>

        <FormAlert tone="warning">
          [CONFIRM: Legal entity name, governing jurisdiction, refund policy, and support email must
          be reviewed and finalized by a lawyer in Phase 12 before accepting paid users.]
        </FormAlert>

        <section className="space-y-4 text-[var(--neutral-700)] leading-relaxed">
          <h2 className="text-xl font-medium">1. Purpose of Collate</h2>
          <p>
            Collate is a research and drafting assistant designed to help you locate credible
            sources, organize chapters, verify citations, and export structured documents. You are
            responsible for reviewing every draft and following your institution&apos;s academic
            integrity and AI-disclosure rules.
          </p>

          <h2 className="text-xl font-medium">2. Honest limits</h2>
          <p>
            Collate runs internal overlap and citation checks and provides a similarity report and
            writing-process log. No software can guarantee the outcome of a third-party university
            similarity or AI-writing detector.
          </p>

          <h2 className="text-xl font-medium">3. Acceptable use</h2>
          <p>
            You may not use Collate to fabricate empirical research data, impersonate others, or
            generate harmful or unlawful content.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
