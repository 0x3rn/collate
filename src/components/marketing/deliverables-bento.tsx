"use client";

import { useState } from "react";
import { CITATION_SPECIMENS } from "@/lib/marketing/landing-content";

type DeliverableKey = "citations" | "claims" | "results" | "exports" | "integrity";

const FEATURES: Array<{
  id: DeliverableKey;
  title: string;
  summary: string;
}> = [
  {
    id: "citations",
    title: "Verified citations in six official styles",
    summary:
      "References are formatted from checked publisher records, never guessed or typed from memory.",
  },
  {
    id: "claims",
    title: "Claim-by-claim source checking",
    summary:
      "A second pass checks every factual claim against its saved source passage before delivery.",
  },
  {
    id: "results",
    title: "Honest Results for empirical work",
    summary:
      "Calculate real tables from your uploaded data or ground benchmark tables in verified studies, never invented figures.",
  },
  {
    id: "exports",
    title: "Print-ready PDF and Word (.docx)",
    summary:
      "Roman front matter, Arabic body pages, and an exact table of contents ready for submission or Word edits.",
  },
  {
    id: "integrity",
    title: "Similarity report, logs & chapter memory",
    summary:
      "Every chapter keeps prior terms consistent and includes overlap scores, a writing log, and a disclosure template.",
  },
];

export function DeliverablesBento() {
  const [selected, setSelected] = useState<DeliverableKey>("citations");
  const [activeStyle, setActiveStyle] = useState<string>(CITATION_SPECIMENS[0]!.id);
  const specimen = CITATION_SPECIMENS.find((c) => c.id === activeStyle) ?? CITATION_SPECIMENS[0]!;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-stretch">
      {/* Left interactive list */}
      <div
        role="tablist"
        aria-label="Project deliverables"
        className="lg:col-span-5 flex flex-col gap-3"
      >
        {FEATURES.map((feat) => {
          const active = selected === feat.id;
          return (
            <button
              key={feat.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelected(feat.id)}
              className={`text-left p-4 sm:p-5 rounded-[var(--radius-md)] border transition-all duration-150 cursor-pointer ${
                active
                  ? "bg-white border-[var(--accent-600)] shadow-[var(--shadow-subtle)]"
                  : "bg-[var(--neutral-50)] border-[var(--neutral-200)] hover:bg-white hover:border-[var(--neutral-300)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-semibold text-[var(--neutral-900)]">
                  {feat.title}
                </span>
                <span
                  aria-hidden="true"
                  className={`text-xs font-semibold ${
                    active ? "text-[var(--accent-600)]" : "text-[var(--neutral-400)]"
                  }`}
                >
                  →
                </span>
              </div>
              <p className="text-sm text-[var(--neutral-600)] leading-relaxed mt-1.5">
                {feat.summary}
              </p>
            </button>
          );
        })}
      </div>

      {/* Right specimen viewer (grid-locked height so switching features stays rock steady) */}
      <div className="lg:col-span-7 bg-[var(--neutral-50)] border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 sm:p-8 flex flex-col justify-between">
        <div className="grid flex-1">
          {/* 1. Citations */}
          <div
            aria-hidden={selected !== "citations"}
            className={`col-start-1 row-start-1 space-y-5 transition-opacity duration-200 ${
              selected === "citations"
                ? "opacity-100 visible"
                : "opacity-0 invisible pointer-events-none select-none"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)] m-0">
                Live citation formatter
              </p>
              <span className="text-xs font-medium text-[var(--success-text)]">
                Verified journal record
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {CITATION_SPECIMENS.map((item) => {
                const isCurrent = item.id === activeStyle;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveStyle(item.id)}
                    className={`min-h-[36px] px-3 py-1 text-xs font-medium rounded-[var(--radius-sm)] border cursor-pointer transition-colors ${
                      isCurrent
                        ? "bg-[var(--accent-600)] text-white border-[var(--accent-600)]"
                        : "bg-white text-[var(--neutral-700)] border-[var(--neutral-200)] hover:border-[var(--neutral-400)]"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-5 space-y-4">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--neutral-500)] m-0">
                  In-text sentence
                </p>
                <p className="text-sm text-[var(--neutral-900)] leading-relaxed m-0">
                  Off-grid battery storage lowered vaccine spoilage rates by more than half across
                  monitored clinics{" "}
                  <strong className="text-[var(--accent-600)]">{specimen.inText}</strong>.
                </p>
              </div>

              <div className="border-t border-[var(--neutral-200)] pt-4 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--neutral-500)] m-0">
                  Generated reference list entry
                </p>
                <p className="text-xs text-[var(--neutral-800)] leading-relaxed pl-4 -indent-4 m-0">
                  {specimen.reference}
                </p>
              </div>
            </div>

            <p className="text-xs text-[var(--neutral-600)] m-0">
              Choose in-text citations with a reference list, or a reference list only. Uncited
              sources are never included in the final bibliography.
            </p>
          </div>

          {/* 2. Claims */}
          <div
            aria-hidden={selected !== "claims"}
            className={`col-start-1 row-start-1 space-y-4 transition-opacity duration-200 ${
              selected === "claims"
                ? "opacity-100 visible"
                : "opacity-0 invisible pointer-events-none select-none"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)] m-0">
              Sentence-to-source verification trace
            </p>

            <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-5 space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--neutral-700)]">
                    Drafted claim
                  </span>
                  <span className="px-2 py-0.5 text-[11px] font-medium rounded-[var(--radius-sm)] bg-[var(--success-bg)] text-[var(--success-text)]">
                    Supported
                  </span>
                </div>
                <p className="text-sm text-[var(--neutral-900)] m-0">
                  Solar microgrids increased vaccine refrigerator uptime from 61% to 97% across 18
                  monitored rural clinics.
                </p>
              </div>

              <div className="border-l-2 border-[var(--accent-600)] pl-4 space-y-1 bg-[var(--neutral-50)] py-2.5 pr-3 rounded-r-[var(--radius-sm)]">
                <p className="text-[11px] font-semibold text-[var(--accent-600)] m-0">
                  Matched source passage · Okonkwo &amp; Mensah (2024), Section 3
                </p>
                <p className="text-xs text-[var(--neutral-700)] m-0">
                  &ldquo;Across the 18 primary clinics monitored for 12 months, mean cold-chain
                  uptime rose from 61% under diesel generators to 97% following solar
                  installation.&rdquo;
                </p>
              </div>

              <div className="pt-2 border-t border-[var(--neutral-200)] flex items-center justify-between gap-2 text-xs">
                <span className="text-[var(--neutral-600)]">
                  Unsupported or overstated sentence detected?
                </span>
                <span className="font-medium text-[var(--warning-text)]">
                  Automatically rewritten or removed
                </span>
              </div>
            </div>
          </div>

          {/* 3. Results */}
          <div
            aria-hidden={selected !== "results"}
            className={`col-start-1 row-start-1 space-y-4 transition-opacity duration-200 ${
              selected === "results"
                ? "opacity-100 visible"
                : "opacity-0 invisible pointer-events-none select-none"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)] m-0">
              Real tables calculated from your data
            </p>

            <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--neutral-900)]">
                  Table 4.1 · Descriptive summary (uploaded survey data)
                </span>
                <span className="text-[11px] font-medium text-[var(--success-text)]">
                  Zero invented figures
                </span>
              </div>

              <div className="overflow-x-auto border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
                <table className="w-full text-left border-collapse text-xs tabular-nums">
                  <thead>
                    <tr className="bg-[var(--neutral-100)] border-b border-[var(--neutral-200)] text-[var(--neutral-700)]">
                      <th className="py-2 px-3">Metric</th>
                      <th className="py-2 px-3">N</th>
                      <th className="py-2 px-3">Mean</th>
                      <th className="py-2 px-3">Median</th>
                      <th className="py-2 px-3">Range</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--neutral-200)] text-[var(--neutral-800)]">
                    <tr>
                      <td className="py-2 px-3 font-medium">Clinic uptime (%)</td>
                      <td className="py-2 px-3">42</td>
                      <td className="py-2 px-3">95.0</td>
                      <td className="py-2 px-3">95.5</td>
                      <td className="py-2 px-3">91–99</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium">Battery life (yrs)</td>
                      <td className="py-2 px-3">42</td>
                      <td className="py-2 px-3">5.2</td>
                      <td className="py-2 px-3">5.0</td>
                      <td className="py-2 px-3">4–6</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-[var(--neutral-600)] m-0">
                No spreadsheet ready? Collate can cite public datasets or output a clearly labelled{" "}
                <span className="font-mono text-[11px] bg-[var(--neutral-100)] px-1 py-0.5 rounded">
                  [ADD: value]
                </span>{" "}
                framework for your own results.
              </p>
            </div>
          </div>

          {/* 4. Exports */}
          <div
            aria-hidden={selected !== "exports"}
            className={`col-start-1 row-start-1 space-y-4 transition-opacity duration-200 ${
              selected === "exports"
                ? "opacity-100 visible"
                : "opacity-0 invisible pointer-events-none select-none"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)] m-0">
              Publication layout preview
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-4 flex flex-col justify-between min-h-[190px] text-xs">
                <div className="text-center space-y-2 pt-2">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--neutral-500)] m-0">
                    Front matter
                  </p>
                  <p
                    className="text-sm font-semibold text-[var(--neutral-900)] m-0"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    Table of Contents
                  </p>
                  <div className="text-left space-y-1 pt-2 text-[11px] text-[var(--neutral-600)] tabular-nums">
                    <div className="flex justify-between">
                      <span>Abstract</span>
                      <span>ii</span>
                    </div>
                    <div className="flex justify-between">
                      <span>1. Introduction</span>
                      <span>1</span>
                    </div>
                    <div className="flex justify-between">
                      <span>2. Literature Review</span>
                      <span>11</span>
                    </div>
                  </div>
                </div>
                <p className="text-center text-[10px] text-[var(--neutral-500)] m-0 tabular-nums">
                  Roman numerals (i, ii, iii)
                </p>
              </div>

              <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-4 flex flex-col justify-between min-h-[190px] text-xs">
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--neutral-500)] m-0">
                    Body &amp; References
                  </p>
                  <p
                    className="text-sm font-semibold text-[var(--neutral-900)] m-0"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    Chapter 1: Introduction
                  </p>
                  <p className="text-[11px] text-[var(--neutral-600)] leading-relaxed m-0">
                    Formatted in your exact font, size, line spacing, and margins, available as both
                    print-ready PDF and editable Word (.docx).
                  </p>
                </div>
                <p className="text-center text-[10px] text-[var(--neutral-500)] m-0 tabular-nums">
                  Arabic numerals (1, 2, 3…)
                </p>
              </div>
            </div>
          </div>

          {/* 5. Integrity & Memory */}
          <div
            aria-hidden={selected !== "integrity"}
            className={`col-start-1 row-start-1 space-y-4 transition-opacity duration-200 ${
              selected === "integrity"
                ? "opacity-100 visible"
                : "opacity-0 invisible pointer-events-none select-none"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)] m-0">
              Integrity report &amp; cross-chapter memory
            </p>

            <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3 text-xs tabular-nums">
                <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
                  <p className="text-[var(--neutral-600)] m-0">Source overlap</p>
                  <p className="text-base font-semibold text-[var(--success-text)] m-0">2.8%</p>
                </div>
                <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
                  <p className="text-[var(--neutral-600)] m-0">Direct quotes</p>
                  <p className="text-base font-semibold text-[var(--neutral-900)] m-0">0.4%</p>
                </div>
                <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
                  <p className="text-[var(--neutral-600)] m-0">Uniqueness</p>
                  <p className="text-base font-semibold text-[var(--success-text)] m-0">Passed</p>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-[var(--neutral-700)] border-t border-[var(--neutral-200)] pt-3">
                <p className="font-semibold text-[var(--neutral-900)] m-0">
                  Included with every project:
                </p>
                <p className="m-0">
                  • Downloadable writing-process log showing sources, drafts, and edits
                </p>
                <p className="m-0">
                  • Editable AI-use disclosure statement tailored to your institution
                </p>
                <p className="m-0">
                  • Shared chapter memory carrying terms and edits into later chapters
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
