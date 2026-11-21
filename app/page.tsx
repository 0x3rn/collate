import Link from "next/link";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { LinkButton } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const PROCESS_STEPS = [
  {
    step: "01",
    title: "Choose your work type and topic",
    body: "Select Project, Research paper, Thesis, or Assignment. Enter one topic or a list of assignment questions.",
  },
  {
    step: "02",
    title: "Deep source sweep before writing",
    body: "Collate checks scholarly databases and web sources first. If credible evidence is missing, it tells you why and stops instead of guessing.",
  },
  {
    step: "03",
    title: "Approve length, chapters, and citations",
    body: "Review the recommended page count, define your chapter titles, pick your citation style, and confirm the full outline.",
  },
  {
    step: "04",
    title: "Write one verified chapter at a time",
    body: "Each chapter is checked against stored passages and originality gates, emailed when ready, and exported as PDF or Word.",
  },
];

const GROUND_RULES = [
  {
    title: "Refuses weak topics instead of guessing",
    body: "When real evidence is too thin or a topic is too vague, Collate gives clear reasons and refinement ideas rather than filling pages.",
  },
  {
    title: "Citations come only from verified records",
    body: "Reference lists are formatted by a citation engine from real DOI and publisher metadata, never invented in free text.",
  },
  {
    title: "Never fabricates research data",
    body: "Results chapters use your uploaded data, cited public datasets, or a clearly labelled framework—never invented survey numbers.",
  },
  {
    title: "Measured page counts and real exports",
    body: "PDFs are rendered server-side with headers, numbering, and table of contents—so reported page counts match the downloaded file.",
  },
];

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <>
      <SiteHeader user={user} />

      <main className="flex-1">
        <section className="mx-auto max-w-[1120px] px-4 sm:px-6 py-16 md:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
            <div className="lg:col-span-7 space-y-6">
              <p className="text-sm font-medium text-[var(--accent-600)]">
                Research and drafting assistant for university work
              </p>
              <h1 className="text-[2.25rem] sm:text-[2.75rem] font-medium leading-[1.15] text-[var(--neutral-900)]">
                Write projects, theses, and assignments backed by real sources
              </h1>
              <p className="text-lg text-[var(--neutral-600)] max-w-[54ch] leading-relaxed">
                Collate sweeps scholarly and web sources first to confirm your topic can be written
                without guessing, then drafts one verified chapter at a time and exports formatted
                PDF and Word files.
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
            </div>

            <aside
              aria-label="How Collate checks a project"
              className="lg:col-span-5 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 shadow-[var(--shadow-subtle)] space-y-5"
            >
              <div className="flex items-center justify-between border-b border-[var(--neutral-200)] pb-4">
                <div>
                  <p className="text-xs font-medium text-[var(--neutral-500)]">Workflow sequence</p>
                  <p className="text-base font-semibold text-[var(--neutral-900)] mt-0.5">
                    From topic check to typeset PDF
                  </p>
                </div>
                <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--accent-100)] text-[var(--accent-600)]">
                  Chapter by chapter
                </span>
              </div>

              <ol className="space-y-4 list-none p-0 m-0">
                <li className="flex items-start gap-3">
                  <span className="tabular-nums text-xs font-semibold text-[var(--neutral-500)] pt-1">
                    01
                  </span>
                  <div>
                    <p className="text-sm font-medium text-[var(--neutral-900)]">
                      Feasibility gate
                    </p>
                    <p className="text-sm text-[var(--neutral-600)]">
                      Verifies source depth before any writing begins.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="tabular-nums text-xs font-semibold text-[var(--neutral-500)] pt-1">
                    02
                  </span>
                  <div>
                    <p className="text-sm font-medium text-[var(--neutral-900)]">
                      Evidence-bound drafting
                    </p>
                    <p className="text-sm text-[var(--neutral-600)]">
                      Every factual claim links to a stored source passage.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="tabular-nums text-xs font-semibold text-[var(--neutral-500)] pt-1">
                    03
                  </span>
                  <div>
                    <p className="text-sm font-medium text-[var(--neutral-900)]">
                      Originality and length check
                    </p>
                    <p className="text-sm text-[var(--neutral-600)]">
                      Runs overlap checks and measures real rendered PDF pages.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="tabular-nums text-xs font-semibold text-[var(--neutral-500)] pt-1">
                    04
                  </span>
                  <div>
                    <p className="text-sm font-medium text-[var(--neutral-900)]">
                      Your approval before the next chapter
                    </p>
                    <p className="text-sm text-[var(--neutral-600)]">
                      Review, download PDF or Word, and start Chapter N+1 when ready.
                    </p>
                  </div>
                </li>
              </ol>
            </aside>
          </div>
        </section>

        <section
          id="how-it-works"
          className="border-t border-[var(--neutral-200)] bg-white py-16 md:py-24"
        >
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
            <div className="max-w-[60ch] mb-12 space-y-3">
              <h2 className="text-[1.75rem] sm:text-[2rem] font-medium">How Collate works</h2>
              <p className="text-[var(--neutral-600)]">
                Long academic work should not be rushed into one prompt. Collate breaks the job into
                clear, inspectable stages.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {PROCESS_STEPS.map((item) => (
                <div
                  key={item.step}
                  className="bg-[var(--neutral-50)] border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-3"
                >
                  <p className="tabular-nums text-sm font-semibold text-[var(--accent-600)]">
                    Step {item.step}
                  </p>
                  <h3 className="text-lg font-medium text-[var(--neutral-900)]">{item.title}</h3>
                  <p className="text-sm text-[var(--neutral-600)] leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="rules" className="border-t border-[var(--neutral-200)] py-16 md:py-24">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
            <div className="max-w-[60ch] mb-12 space-y-3">
              <h2 className="text-[1.75rem] sm:text-[2rem] font-medium">
                Built around strict academic ground rules
              </h2>
              <p className="text-[var(--neutral-600)]">
                Collate is a research and drafting assistant. It is designed to show its sources and
                limits honestly—never to fake evidence or promise evasion of university checks.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {GROUND_RULES.map((rule) => (
                <div
                  key={rule.title}
                  className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-2"
                >
                  <h3 className="text-xl font-medium text-[var(--neutral-900)]">{rule.title}</h3>
                  <p className="text-sm sm:text-base text-[var(--neutral-600)] leading-relaxed">
                    {rule.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--neutral-200)] bg-[var(--neutral-100)] py-16">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-[54ch]">
              <h2 className="text-[1.75rem] font-medium">Start with your topic</h2>
              <p className="text-[var(--neutral-600)]">
                Create an account to set up your first project, thesis, research paper, or
                assignment.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <LinkButton href={user ? "/dashboard" : "/sign-up"} variant="primary">
                {user ? "Go to projects" : "Create account"}
              </LinkButton>
              {!user ? (
                <Link
                  href="/terms"
                  className="min-h-[44px] px-3 inline-flex items-center text-sm font-medium text-[var(--neutral-700)] hover:text-[var(--neutral-900)] underline underline-offset-4"
                >
                  Read terms of service
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
