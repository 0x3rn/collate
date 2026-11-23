import Link from "next/link";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { DeliverablesBento } from "@/components/marketing/deliverables-bento";
import { HeroWorkspacePreview } from "@/components/marketing/hero-workspace-preview";
import { PricingShowcase } from "@/components/marketing/pricing-showcase";
import { LinkButton } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { getCurrentUser } from "@/lib/auth/server";
import {
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
        {/* 1. Hero: Asymmetric editorial intro + layered stacked-page project preview */}
        <section className="relative overflow-hidden">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-14 sm:py-20 lg:py-24">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
              <div className="lg:col-span-6 space-y-6">
                <p className="text-sm font-medium text-[var(--accent-600)] m-0">
                  For university students and academic researchers
                </p>
                <h1 className="text-[2.25rem] sm:text-[2.875rem] font-medium leading-[1.13] text-[var(--neutral-900)] m-0">
                  Check your topic against real sources, then write one verified chapter at a time
                </h1>
                <p className="text-lg text-[var(--neutral-600)] max-w-[54ch] leading-relaxed m-0">
                  Collate searches scholarly databases and credible publications before any writing
                  starts. If evidence is missing, it tells you why instead of guessing. When a topic
                  passes, it drafts chapter by chapter and exports print-ready PDF and Word files.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {user ? (
                    <LinkButton href="/dashboard" variant="primary">
                      Open your projects
                    </LinkButton>
                  ) : (
                    <>
                      <LinkButton href="/sign-up" variant="primary">
                        Create free account
                      </LinkButton>
                      <LinkButton href="/sign-in" variant="secondary">
                        Sign in
                      </LinkButton>
                    </>
                  )}
                </div>

                <p className="text-sm text-[var(--neutral-600)] m-0">
                  Includes {pricing.freeSweeps} free topic source checks when you join.
                </p>
              </div>

              <div className="lg:col-span-6 relative">
                <div
                  aria-hidden="true"
                  className="hidden sm:block absolute inset-0 translate-x-2.5 translate-y-2.5 rounded-[var(--radius-md)] bg-[var(--neutral-100)] border border-[var(--neutral-200)]"
                />
                <div className="relative">
                  <HeroWorkspacePreview />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Work Types: 2x2 architectural ledger with bracketed page ranges aligned right of each title */}
        <section
          id="work-types"
          className="border-t border-[var(--neutral-200)] bg-white py-16 md:py-24"
        >
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 space-y-10">
            <Reveal>
              <div className="max-w-[64ch] space-y-3">
                <h2 className="text-[1.75rem] sm:text-[2.125rem] font-medium m-0">
                  Built for four types of academic work
                </h2>
                <p className="text-[var(--neutral-600)] leading-relaxed m-0">
                  Collate adapts source thresholds, chapter templates, and recommended lengths to
                  what you are writing—and lets you adjust the final page count.
                </p>
              </div>
            </Reveal>

            <Reveal delayMs={60}>
              <div className="grid grid-cols-1 md:grid-cols-2 border border-[var(--neutral-200)] rounded-[var(--radius-md)] bg-[var(--neutral-50)] overflow-hidden">
                {WORK_TYPE_OVERVIEWS.map((item, idx) => (
                  <article
                    key={item.title}
                    className={`p-6 sm:p-7 space-y-2.5 ${
                      idx % 2 === 1 ? "md:border-l border-[var(--neutral-200)]" : ""
                    } ${idx >= 2 ? "border-t border-[var(--neutral-200)]" : idx === 1 ? "border-t md:border-t-0 border-[var(--neutral-200)]" : ""}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h3 className="text-xl font-medium text-[var(--neutral-900)] m-0">
                        {item.title}
                      </h3>
                      <span className="text-sm font-medium text-[var(--accent-600)] tabular-nums">
                        ({item.pageRange})
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
            </Reveal>
          </div>
        </section>

        {/* 3. How Collate Works: Sticky left narrative + vertical timeline */}
        <section id="how-it-works" className="border-t border-[var(--neutral-200)] py-16 md:py-24">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
              <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-4">
                <Reveal>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent-600)] m-0">
                    Step-by-step process
                  </p>
                  <h2 className="text-[1.75rem] sm:text-[2.125rem] font-medium mt-2 m-0">
                    How Collate works
                  </h2>
                  <p className="text-[var(--neutral-600)] leading-relaxed mt-3 m-0">
                    Serious academic projects take time. Every stage saves automatically so you can
                    verify sources, review each chapter, and control when the next chapter starts.
                  </p>
                  <div className="pt-4">
                    <LinkButton href={user ? "/projects/new" : "/sign-up"} variant="secondary">
                      {user ? "Start a project" : "Try with your topic"}
                    </LinkButton>
                  </div>
                </Reveal>
              </div>

              <ol className="lg:col-span-7 space-y-5 list-none p-0 m-0">
                {WORKFLOW_STEPS.map((item, idx) => (
                  <li key={item.step}>
                    <Reveal delayMs={idx * 50}>
                      <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 sm:p-7 flex items-start gap-5 transition-colors duration-150 hover:border-[var(--neutral-300)]">
                        <span
                          className="shrink-0 w-9 h-9 rounded-[var(--radius-sm)] bg-[var(--accent-100)] text-[var(--accent-600)] font-semibold text-sm tabular-nums grid place-items-center"
                          aria-hidden="true"
                        >
                          {item.step}
                        </span>
                        <div className="space-y-1.5">
                          <h3 className="text-lg font-medium text-[var(--neutral-900)] m-0">
                            {item.title}
                          </h3>
                          <p className="text-sm sm:text-base text-[var(--neutral-600)] leading-relaxed m-0">
                            {item.body}
                          </p>
                        </div>
                      </div>
                    </Reveal>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* 4. What You Get (Interactive Showcase) + Strict Rules */}
        <section
          id="what-you-get"
          className="border-t border-[var(--neutral-200)] bg-white py-16 md:py-24"
        >
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 space-y-16">
            <div className="space-y-10">
              <Reveal>
                <div className="max-w-[64ch] space-y-3">
                  <h2 className="text-[1.75rem] sm:text-[2.125rem] font-medium m-0">
                    What you get in every finished project
                  </h2>
                  <p className="text-[var(--neutral-600)] leading-relaxed m-0">
                    Select any capability below to inspect how Collate verifies citations, checks
                    claims, handles research data, and formats final files.
                  </p>
                </div>
              </Reveal>

              <Reveal delayMs={60}>
                <DeliverablesBento />
              </Reveal>
            </div>

            <Reveal delayMs={80}>
              <div className="border-t border-[var(--neutral-200)] pt-14 space-y-6">
                <div className="max-w-[64ch] space-y-2">
                  <h2 className="text-[1.625rem] font-medium m-0">
                    Strict rules built into every step
                  </h2>
                  <p className="text-sm text-[var(--neutral-600)] m-0">
                    Collate refuses shortcuts that create fake citations, made-up statistics, or
                    unverified filler.
                  </p>
                </div>

                <div className="border border-[var(--neutral-200)] rounded-[var(--radius-md)] divide-y divide-[var(--neutral-200)] overflow-hidden">
                  <div className="hidden md:grid md:grid-cols-2 bg-[var(--neutral-100)] text-xs font-semibold uppercase tracking-wider text-[var(--neutral-600)]">
                    <div className="px-6 py-3">What Collate does</div>
                    <div className="px-6 py-3 border-l border-[var(--neutral-200)]">
                      What Collate refuses to do
                    </div>
                  </div>
                  {REFUSAL_RULES.map((row) => (
                    <div
                      key={row.willDo}
                      className="grid grid-cols-1 md:grid-cols-2 bg-white text-sm"
                    >
                      <div className="px-6 py-4 text-[var(--neutral-900)] flex items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className="text-[var(--success-text)] font-bold mt-0.5"
                        >
                          ✓
                        </span>
                        <span>{row.willDo}</span>
                      </div>
                      <div className="px-6 py-4 text-[var(--neutral-600)] border-t md:border-t-0 md:border-l border-[var(--neutral-200)] flex items-start gap-2.5 bg-[var(--neutral-50)] md:bg-white">
                        <span
                          aria-hidden="true"
                          className="text-[var(--error-text)] font-bold mt-0.5"
                        >
                          ✕
                        </span>
                        <span>{row.wontDo}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* 5. Transparent Pricing & Credit Calculator */}
        <section id="pricing" className="border-t border-[var(--neutral-200)] py-16 md:py-24">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 space-y-8">
            <Reveal>
              <div className="max-w-[64ch] space-y-3">
                <h2 className="text-[1.75rem] sm:text-[2.125rem] font-medium m-0">
                  Simple credit packs, pay as you write
                </h2>
                <p className="text-[var(--neutral-600)] leading-relaxed m-0">
                  Start with {pricing.freeSweeps} free topic checks. Credits are deducted one
                  chapter at a time and refunded automatically if any chapter fails. Pay in Naira or
                  US dollars.
                </p>
              </div>
            </Reveal>

            <Reveal delayMs={60}>
              <PricingShowcase packs={pricing.packs} signedIn={Boolean(user)} />
            </Reveal>
          </div>
        </section>

        {/* 6. Split FAQ */}
        <section id="faq" className="border-t border-[var(--neutral-200)] bg-white py-16 md:py-24">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
              <div className="lg:col-span-4 lg:sticky lg:top-24 space-y-3">
                <Reveal>
                  <h2 className="text-[1.75rem] sm:text-[2.125rem] font-medium m-0">
                    Frequently asked questions
                  </h2>
                  <p className="text-sm sm:text-base text-[var(--neutral-600)] leading-relaxed m-0">
                    Plain answers on source checking, citations, empirical data, timing, and
                    university rules.
                  </p>
                  <p className="text-sm m-0 pt-2">
                    <Link
                      href="/terms"
                      className="text-[var(--accent-600)] font-medium underline underline-offset-4"
                    >
                      Read terms and integrity limits
                    </Link>
                  </p>
                </Reveal>
              </div>

              <div className="lg:col-span-8 divide-y divide-[var(--neutral-200)] border border-[var(--neutral-200)] rounded-[var(--radius-md)] bg-[var(--neutral-50)]">
                {LANDING_FAQS.map((faq) => (
                  <details key={faq.question} className="group p-5 sm:p-6">
                    <summary className="list-none cursor-pointer flex items-center justify-between gap-4 text-base font-semibold text-[var(--neutral-900)]">
                      <span>{faq.question}</span>
                      <span
                        aria-hidden="true"
                        className="text-lg leading-none font-medium text-[var(--neutral-500)] shrink-0 transition-transform duration-150 group-open:rotate-45"
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
          </div>
        </section>

        {/* 7. Final CTA */}
        <section className="border-t border-[var(--neutral-200)] bg-[var(--neutral-100)] py-16">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
            <Reveal>
              <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-8 sm:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="space-y-2 max-w-[54ch]">
                  <h2 className="text-[1.75rem] font-medium m-0">
                    Test your topic against real sources first
                  </h2>
                  <p className="text-[var(--neutral-600)] m-0">
                    Create a free account to see whether your topic has enough credible evidence
                    before you spend time writing.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <LinkButton href={user ? "/projects/new" : "/sign-up"} variant="primary">
                    {user ? "Start a new project" : "Create free account"}
                  </LinkButton>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
