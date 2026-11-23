import type { Metadata } from "next";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FormAlert } from "@/components/ui/alert";
import { getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms of service — Collate",
  description: "Terms of service, acceptable use, refund policy, and AI-disclosure guidance.",
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
            Pre-launch draft — legal counsel review required before public launch.
          </p>
        </div>

        <FormAlert tone="warning">
          [CONFIRM: Legal entity name, governing law, support email, and commercial refund terms
          must be reviewed and approved by a lawyer before accepting paid public users.]
        </FormAlert>

        <section className="space-y-4 text-[var(--neutral-700)] leading-relaxed">
          <h2 className="text-xl font-medium">1. Research and drafting assistant positioning</h2>
          <p>
            Collate assists with scholarly literature discovery, feasibility screening, outline
            planning, citation formatting, and chapter drafting. You are responsible for reviewing
            every draft, supplying genuine empirical data where required, and complying with your
            institution&apos;s academic integrity and AI-disclosure policies.
          </p>

          <h2 className="text-xl font-medium">2. Honest limits</h2>
          <p>
            Collate provides an internal similarity report, verified citation records, a
            writing-process log, and an editable AI-use disclosure statement. No tool can guarantee
            the outcome of an external university similarity or AI-writing detector.
          </p>

          <h2 className="text-xl font-medium">3. Credits and refund policy</h2>
          <p>
            Credits reserved for a chapter are automatically refunded in full if the chapter fails
            to complete due to a system or provider error. Unused credit pack refunds are subject to
            [CONFIRM: final refund window and payment processor terms].
          </p>

          <h2 className="text-xl font-medium">4. Acceptable use</h2>
          <p>
            You may not use Collate to fabricate survey/experimental data, generate harmful,
            violent, or unlawful instructional content, bypass paywalls, or abuse platform rate
            limits.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
