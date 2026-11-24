import Link from "next/link";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import type { PublicUser } from "@/lib/auth/service";
import { LEGAL_NAV_ITEMS } from "@/lib/legal/config";
import type { LegalBlock, LegalDocumentData, LegalInlineRun } from "@/lib/legal/types";

function renderRuns(runs: LegalInlineRun[]) {
  return runs.map((run, index) => {
    if (run.type === "text") {
      return <span key={index}>{run.text}</span>;
    }
    if (run.type === "strong") {
      return (
        <strong key={index} className="font-semibold text-[var(--neutral-900)]">
          {run.text}
        </strong>
      );
    }
    if (run.type === "code") {
      return (
        <code
          key={index}
          className="px-1.5 py-0.5 rounded-[4px] bg-[var(--neutral-100)] border border-[var(--neutral-200)] text-[0.85em] text-[var(--neutral-900)]"
        >
          {run.text}
        </code>
      );
    }
    const isInternal = run.href.startsWith("/");
    if (isInternal) {
      return (
        <Link
          key={index}
          href={run.href}
          className="text-[var(--accent-600)] hover:text-[var(--accent-700)] underline underline-offset-4"
        >
          {run.label}
        </Link>
      );
    }
    return (
      <a
        key={index}
        href={run.href}
        rel={run.href.startsWith("http") ? "noopener noreferrer" : undefined}
        target={run.href.startsWith("http") ? "_blank" : undefined}
        className="text-[var(--accent-600)] hover:text-[var(--accent-700)] underline underline-offset-4 break-words"
      >
        {run.label}
      </a>
    );
  });
}

function renderBlock(block: LegalBlock, index: number) {
  switch (block.type) {
    case "paragraph":
      return (
        <p key={index} className="text-[15px] text-[var(--neutral-700)] leading-relaxed">
          {renderRuns(block.runs)}
        </p>
      );

    case "subheading":
      return (
        <h3
          key={index}
          id={block.id}
          className="text-base font-semibold text-[var(--neutral-900)] pt-2 scroll-mt-24"
        >
          {block.title}
        </h3>
      );

    case "list":
      if (block.ordered) {
        return (
          <ol
            key={index}
            className="list-decimal pl-5 space-y-2.5 text-[15px] text-[var(--neutral-700)] leading-relaxed marker:text-[var(--neutral-500)] marker:font-medium"
          >
            {block.items.map((item, i) => (
              <li key={i} className="pl-1">
                {renderRuns(item)}
              </li>
            ))}
          </ol>
        );
      }
      return (
        <ul
          key={index}
          className="list-disc pl-5 space-y-2.5 text-[15px] text-[var(--neutral-700)] leading-relaxed marker:text-[var(--neutral-400)]"
        >
          {block.items.map((item, i) => (
            <li key={i} className="pl-1">
              {renderRuns(item)}
            </li>
          ))}
        </ul>
      );

    case "callout":
      return (
        <aside
          key={index}
          className={`rounded-[var(--radius-sm)] border p-4 sm:p-5 space-y-1.5 ${
            block.tone === "accent"
              ? "bg-[var(--accent-100)]/45 border-[var(--accent-600)]/25"
              : "bg-[var(--neutral-50)] border-[var(--neutral-200)]"
          }`}
        >
          <p className="text-sm font-semibold text-[var(--neutral-900)]">{block.title}</p>
          <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
            {renderRuns(block.runs)}
          </p>
        </aside>
      );

    case "table": {
      const compact = block.headers.length >= 5;
      return (
        <div
          key={index}
          className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--neutral-200)]"
        >
          <table className={`w-full border-collapse text-left ${compact ? "text-xs" : "text-sm"}`}>
            {block.caption ? <caption className="sr-only">{block.caption}</caption> : null}
            <thead>
              <tr className="bg-[var(--neutral-50)] border-b border-[var(--neutral-200)]">
                {block.headers.map((header, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={`${
                      compact ? "px-3 py-2.5" : "px-4 py-3 whitespace-nowrap"
                    } text-[11px] font-semibold uppercase tracking-wider text-[var(--neutral-600)]`}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--neutral-200)] bg-white">
              {block.rows.map((row, rIdx) => (
                <tr key={rIdx} className="align-top hover:bg-[var(--neutral-50)]/60">
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className={`${compact ? "px-3 py-2.5 break-words" : "px-4 py-3"} leading-relaxed ${
                        cIdx === 0
                          ? `font-medium text-[var(--neutral-900)] ${compact ? "min-w-[110px]" : "min-w-[150px]"}`
                          : "text-[var(--neutral-700)]"
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
}

export function LegalDocumentView({
  document,
  user,
}: {
  document: LegalDocumentData;
  user: PublicUser | null;
}) {
  return (
    <>
      <SiteHeader user={user} />
      <main className="flex-1 bg-[var(--neutral-50)]">
        <div className="mx-auto w-full max-w-[1080px] px-4 sm:px-6 py-10 sm:py-14 space-y-8">
          {/* Policy Switcher Bar */}
          <nav
            aria-label="Legal policies"
            className="flex flex-wrap items-center gap-2 border-b border-[var(--neutral-200)] pb-4"
          >
            {LEGAL_NAV_ITEMS.map((item) => {
              const active = item.href === document.slug;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`px-3.5 py-2 rounded-[var(--radius-sm)] text-xs sm:text-sm font-medium transition-colors ${
                    active
                      ? "bg-[var(--accent-100)] text-[var(--accent-600)] font-semibold"
                      : "text-[var(--neutral-700)] hover:bg-white hover:text-[var(--neutral-900)] border border-transparent hover:border-[var(--neutral-200)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Editorial Title Header */}
          <header className="space-y-3 max-w-[760px]">
            <h1
              className="text-[2rem] sm:text-[2.4rem] font-medium leading-tight tracking-tight text-[var(--neutral-900)]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {document.title}
            </h1>
            <p className="text-base text-[var(--neutral-600)] leading-relaxed">
              {document.subtitle}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--neutral-500)] pt-1">
              <span>Effective date: {document.effectiveDate}</span>
              <span aria-hidden="true">·</span>
              <span>Last updated: {document.lastUpdated}</span>
            </div>
          </header>

          {/* Mobile Table of Contents */}
          <nav
            aria-label="Sections in this policy"
            className="lg:hidden bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-4 space-y-2.5"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)]">
              On this page
            </p>
            <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 list-none p-0 m-0 text-sm">
              {document.sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="text-[var(--neutral-700)] hover:text-[var(--accent-600)] hover:underline underline-offset-4"
                  >
                    {section.number}. {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* Desktop 2-Column Layout: Sticky TOC + Editorial Document Card */}
          <div className="grid grid-cols-1 lg:grid-cols-[232px_minmax(0,1fr)] gap-8 lg:gap-10 items-start">
            <aside className="hidden lg:block sticky top-24 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)] px-2">
                On this page
              </p>
              <nav aria-label="Table of contents">
                <ol className="space-y-1 list-none p-0 m-0 text-xs">
                  {document.sections.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="block px-2 py-1.5 rounded-[var(--radius-sm)] text-[var(--neutral-600)] hover:text-[var(--neutral-900)] hover:bg-white leading-snug transition-colors"
                      >
                        <span className="text-[var(--neutral-400)] tabular-nums mr-1.5">
                          {section.number}.
                        </span>
                        {section.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </aside>

            <article className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 sm:p-8 lg:p-10 space-y-10 min-w-0">
              {document.intro.length > 0 ? (
                <div className="space-y-3 pb-6 border-b border-[var(--neutral-200)]">
                  {document.intro.map((runs, idx) => (
                    <p key={idx} className="text-[15px] text-[var(--neutral-700)] leading-relaxed">
                      {renderRuns(runs)}
                    </p>
                  ))}
                </div>
              ) : null}

              {document.sections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  className="space-y-4 scroll-mt-24 pt-2 first:pt-0"
                >
                  <h2
                    className="text-xl sm:text-[1.35rem] font-medium text-[var(--neutral-900)] leading-snug"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    <span className="text-[var(--neutral-400)] mr-2 tabular-nums">
                      {section.number}.
                    </span>
                    {section.title}
                  </h2>
                  <div className="space-y-3.5">
                    {section.blocks.map((block, idx) => renderBlock(block, idx))}
                  </div>
                </section>
              ))}
            </article>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
