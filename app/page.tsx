import Link from "next/link";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { LinkButton } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/server";
import {
  DELIVERABLES_LIST,
  getPublicPricingSummary,
  LANDING_FAQS,
  REFUSAL_RULES,
  WORKFLOW_STEPS,
  WORK_TYPE_OVERVIEWS,
} from "@/lib/marketing/landing-content";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  const pricing = getPublicPricingSummary();

  return (
    <>
      <SiteHeader user={user} />

      <main className="flex-1">
        {/* 1. Hero: Clear value line, audience, primary CTA, and structured product preview */}
        <section className="mx-auto max-w-[1120px] px-4 sm:px-6 py-16 md:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
            <div className="lg:col-span-6 space-y-6">
              <p className="text-sm font-medium text-[var(--accent-600)] m-0">
                For university students and academic researchers
              </p>
              <h1 className="text-[2.25rem] sm:text-[2.875rem] font-medium leading-[1.14] text-[var(--neutral-900)] m-0">
                Check your topic against real sources, then write one verified chapter at a time
              </h1>
              <p className="text-lg text-[var(--neutral-600)] max-w-[54ch] leading-relaxed m-0">
                Collate sweeps scholarly databases and web sources before any writing starts. If
                credible evidence is missing, it tells you why and stops instead of guessing. When a
                topic passes, it plans your outline, verifies every claim and citation, and exports
                server-typeset PDF and Word files.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                {user ? (
                  <LinkButton href="/dashboard" variant="primary">
                    Open your projects
                  </LinkButton>
                ) : (
                  <>
                    <LinkButton href="/sign-up" variant="primary">
                      Create account
                    </LinkButton>
                    <LinkButton href="/sign-in" variant="secondary">
                      Sign in
                    </LinkButton>
                  </>
                )}
              </div>

              <p className="text-sm text-[var(--neutral-600)] m-0">
                Includes {pricing.freeSweeps} free topic feasibility checks when you sign up.
              </p>
            </div>

            {/* Concrete product frame showing actual Collate screens/states */}
            <aside
              aria-label="Sample project inspection view"
              className="lg:col-span-6 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] shadow-[var(--shadow-subtle)] overflow-hidden"
            >
              <div className="px-5 py-3.5 bg-[var(--neutral-100)] border-b border-[var(--neutral-200)] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--neutral-500)] m-0">
                    Example project workspace
                  </p>
                  <p className="text-sm font-semibold text-[var(--neutral-900)] truncate m-0">
                    Solar Microgrid Reliability in Rural Clinics
                  </p>
                </div>
                <span className="shrink-0 inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] border bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]">
                  Feasible · 86/100
                </span>
              </div>

              <div className="p-5 sm:p-6 space-y-5">
                <div className="grid grid-cols-3 gap-3 text-left">
                  <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
                    <p className="text-xs text-[var(--neutral-600)] m-0">Verified sources</p>
                    <p className="text-base font-semibold text-[var(--neutral-900)] tabular-nums m-0">
                      38 DOIs &amp; reports
                    </p>
                  </div>
                  <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
                    <p className="text-xs text-[var(--neutral-600)] m-0">Recommended</p>
                    <p className="text-base font-semibold text-[var(--neutral-900)] tabular-nums m-0">
                      80 pages
                    </p>
                  </div>
                  <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
                    <p className="text-xs text-[var(--neutral-600)] m-0">Citation style</p>
                    <p className="text-base font-semibold text-[var(--neutral-900)] m-0">
                      APA 7th ed.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)] m-0">
                    Chapter progress
                  </p>
                  <ul className="divide-y divide-[var(--neutral-200)] border border-[var(--neutral-200)] rounded-[var(--radius-sm)] list-none p-0 m-0 text-sm">
                    <li className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-[var(--neutral-900)]">
                        <strong className="tabular-nums mr-1.5">Ch. 1</strong> Introduction
                      </span>
                      <span className="text-xs font-medium text-[var(--success-text)]">
                        Approved · Overlap 3.1%
                      </span>
                    </li>
                    <li className="px-3.5 py-2.5 flex items-center justify-between gap-2 bg-[var(--neutral-50)]">
                      <span className="text-[var(--neutral-900)]">
                        <strong className="tabular-nums mr-1.5">Ch. 2</strong> Literature Review
                      </span>
                      <span className="text-xs font-medium text-[var(--accent-600)]">
                        Ready · Email sent
                      </span>
                    </li>
                    <li className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-[var(--neutral-600)]">
                        <strong className="tabular-nums mr-1.5">Ch. 3</strong> Methodology
                      </span>
                      <span className="text-xs text-[var(--neutral-500)]">
                        Waiting for your click
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--neutral-600)]">
                  <span>PDF &amp; Word (.docx) export with Roman + Arabic pages</span>
                  <span className="font-medium text-[var(--neutral-800)]">
                    Illustrative preview
                  </span>
                </div>
              </div>
            </aside>
          </div>
        </section>

        {/* 2. Work types & realistic university length ranges */}
        <section
          id="work-types"
          className="border-t border-[var(--neutral-200)] bg-white py-16 md:py-24"
        >
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 space-y-10">
            <div className="max-w-[64ch] space-y-3">
              <h2 className="text-[1.75rem] sm:text-[2.125rem] font-medium m-0">
                Built for four types of academic work
              </h2>
              <p className="text-[var(--neutral-600)] leading-relaxed m-0">
                Each work type uses different source thresholds, section templates, and ideal page
                recommendations—and you can always override the target page count.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {WORK_TYPE_OVERVIEWS.map((item) => (
                <article
                  key={item.title}
                  className="p-6 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xl font-medium m-0">{item.title}</h3>
                    <span className="text-xs font-medium tabular-nums px-2.5 py-1 rounded-[var(--radius-sm)] bg-white border border-[var(--neutral-200)] text-[var(--neutral-700)]">
                      {item.pageRange}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-[var(--neutral-800)] m-0">
                    {item.bestFor}
                  </p>
                  <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
                    {item.structureNote}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 3. How Collate works (4 steps) */}
        <section id="how-it-works" className="border-t border-[var(--neutral-200)] py-16 md:py-24">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 space-y-10">
            <div className="max-w-[64ch] space-y-3">
              <h2 className="text-[1.75rem] sm:text-[2.125rem] font-medium m-0">
                How Collate works
              </h2>
              <p className="text-[var(--neutral-600)] leading-relaxed m-0">
                Long projects need inspectable checkpoints rather than a single rushed output. Your
                progress is saved after every step so you can pause and resume at any time.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {WORKFLOW_STEPS.map((item) => (
                <div
                  key={item.step}
                  className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-3"
                >
                  <p className="tabular-nums text-sm font-semibold text-[var(--accent-600)] m-0">
                    Step {item.step}
                  </p>
                  <h3 className="text-lg font-medium text-[var(--neutral-900)] m-0">
                    {item.title}
                  </h3>
                  <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 4. What you get + Hard ground rules */}
        <section
          id="what-you-get"
          className="border-t border-[var(--neutral-200)] bg-white py-16 md:py-24"
        >
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 space-y-16">
            <div className="space-y-10">
              <div className="max-w-[64ch] space-y-3">
                <h2 className="text-[1.75rem] sm:text-[2.125rem] font-medium m-0">
                  What you get in every finished project
                </h2>
                <p className="text-[var(--neutral-600)] leading-relaxed m-0">
                  Every chapter goes through evidence retrieval, fact checking, similarity checks,
                  and server-side typesetting before it reaches your inbox.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {DELIVERABLES_LIST.map((item) => (
                  <div
                    key={item.title}
                    className="p-6 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-2"
                  >
                    <h3 className="text-lg font-medium text-[var(--neutral-900)] m-0">
                      {item.title}
                    </h3>
                    <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
                      {item.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-[var(--neutral-200)] pt-12 space-y-6">
              <div className="max-w-[64ch] space-y-2">
                <h2 className="text-[1.625rem] font-medium m-0">
                  What Collate enforces—and what it refuses to do
                </h2>
                <p className="text-sm text-[var(--neutral-600)] m-0">
                  These non-negotiable engineering rules are built into the backend, not just
                  written in marketing copy.
                </p>
              </div>

              <div className="overflow-x-auto border border-[var(--neutral-200)] rounded-[var(--radius-md)]">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-[var(--neutral-100)] border-b border-[var(--neutral-200)]">
                      <th className="py-3.5 px-5 font-semibold text-[var(--neutral-900)]">
                        What Collate does
                      </th>
                      <th className="py-3.5 px-5 font-semibold text-[var(--neutral-900)]">
                        What Collate refuses to do
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--neutral-200)] bg-white">
                    {REFUSAL_RULES.map((row) => (
                      <tr key={row.willDo}>
                        <td className="py-3.5 px-5 text-[var(--neutral-800)]">{row.willDo}</td>
                        <td className="py-3.5 px-5 text-[var(--neutral-600)]">{row.wontDo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Transparent pricing & refund policy */}
        <section id="pricing" className="border-t border-[var(--neutral-200)] py-16 md:py-24">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 space-y-10">
            <div className="max-w-[64ch] space-y-3">
              <h2 className="text-[1.75rem] sm:text-[2.125rem] font-medium m-0">
                Simple credit packs with Paystack and Stripe
              </h2>
              <p className="text-[var(--neutral-600)] leading-relaxed m-0">
                Start with {pricing.freeSweeps} free topic source checks. When you are ready to
                write chapters, credits are reserved at {pricing.creditsPerPage} credit per target
                page and refunded automatically if a chapter run fails.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {pricing.packs.map((pack) => (
                <div
                  key={pack.id}
                  className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 flex flex-col justify-between gap-6"
                >
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-[var(--accent-600)] m-0">
                      {pack.label}
                    </p>
                    <p
                      className="text-2xl font-medium text-[var(--neutral-900)] tabular-nums m-0"
                      style={{ fontFamily: "var(--font-serif)" }}
                    >
                      {pack.ngnFormatted}
                    </p>
                    <p className="text-sm text-[var(--neutral-600)] tabular-nums m-0">
                      International: {pack.usdFormatted}
                    </p>
                    <p className="text-sm text-[var(--neutral-700)] pt-2 leading-relaxed m-0">
                      {pack.description}
                    </p>
                  </div>

                  <LinkButton href={user ? "/account" : "/sign-up"} variant="secondary" fullWidth>
                    {user ? "Top up in account" : "Create account"}
                  </LinkButton>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 6. Accessible FAQ */}
        <section id="faq" className="border-t border-[var(--neutral-200)] bg-white py-16 md:py-24">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 space-y-10">
            <div className="max-w-[64ch] space-y-3">
              <h2 className="text-[1.75rem] sm:text-[2.125rem] font-medium m-0">
                Frequently asked questions
              </h2>
              <p className="text-[var(--neutral-600)] m-0">
                Clear answers on source verification, data integrity, timing, and university checks.
              </p>
            </div>

            <div className="max-w-[78ch] divide-y divide-[var(--neutral-200)] border border-[var(--neutral-200)] rounded-[var(--radius-md)] bg-[var(--neutral-50)]">
              {LANDING_FAQS.map((faq) => (
                <details key={faq.question} className="group p-5 sm:p-6">
                  <summary className="list-none cursor-pointer flex items-center justify-between gap-4 text-base font-semibold text-[var(--neutral-900)]">
                    <span>{faq.question}</span>
                    <span
                      aria-hidden="true"
                      className="text-sm font-medium text-[var(--neutral-500)] shrink-0"
                    >
                      +
                    </span>
                  </summary>
                  <p className="text-sm sm:text-base text-[var(--neutral-700)] leading-relaxed pt-3 m-0">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 7. Final CTA */}
        <section className="border-t border-[var(--neutral-200)] bg-[var(--neutral-100)] py-16">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-[54ch]">
              <h2 className="text-[1.75rem] font-medium m-0">
                Check your topic against real sources first
              </h2>
              <p className="text-[var(--neutral-600)] m-0">
                Create a free account to test your project, research paper, thesis, or assignment
                questions before writing a single paragraph.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <LinkButton href={user ? "/projects/new" : "/sign-up"} variant="primary">
                {user ? "Start a new project" : "Create account"}
              </LinkButton>
              <Link
                href="/terms"
                className="min-h-[44px] px-3 inline-flex items-center text-sm font-medium text-[var(--neutral-700)] hover:text-[var(--neutral-900)] underline underline-offset-4"
              >
                Terms &amp; integrity limits
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
