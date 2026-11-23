"use client";

import { useState } from "react";
import { CITATION_SPECIMENS } from "@/lib/marketing/landing-content";

export function DeliverablesBento() {
  const [activeStyle, setActiveStyle] = useState<string>(CITATION_SPECIMENS[0]!.id);
  const specimen = CITATION_SPECIMENS.find((c) => c.id === activeStyle) ?? CITATION_SPECIMENS[0]!;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Wide Card 1: Interactive Citation Switcher */}
      <div className="lg:col-span-7 p-6 sm:p-7 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] flex flex-col justify-between gap-5">
        <div className="space-y-2">
          <h3 className="text-xl font-medium text-[var(--neutral-900)] m-0">
            Verified citations in six official styles
          </h3>
          <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0 max-w-[56ch]">
            Every reference is built directly from checked publisher and journal records—available
            as in-text citations with a reference list, or a reference list only.
          </p>
        </div>

        <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-4 space-y-3">
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="tablist"
            aria-label="Citation styles preview"
          >
            {CITATION_SPECIMENS.map((item) => {
              const active = item.id === activeStyle;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveStyle(item.id)}
                  className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
                    active
                      ? "bg-[var(--accent-600)] text-white border-[var(--accent-600)]"
                      : "bg-[var(--neutral-50)] text-[var(--neutral-700)] border-[var(--neutral-200)] hover:border-[var(--neutral-400)]"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5 text-xs">
            <p className="text-[var(--neutral-600)] m-0">
              In-text: <strong className="text-[var(--neutral-900)]">{specimen.inText}</strong>
            </p>
            <p className="text-[var(--neutral-700)] leading-relaxed m-0 font-mono text-[11px] bg-[var(--neutral-50)] p-2.5 rounded-[var(--radius-sm)] border border-[var(--neutral-200)]">
              {specimen.reference}
            </p>
          </div>
        </div>
      </div>

      {/* Side Card 2: Claim-by-claim Verification */}
      <div className="lg:col-span-5 p-6 sm:p-7 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] flex flex-col justify-between gap-5">
        <div className="space-y-2">
          <h3 className="text-xl font-medium text-[var(--neutral-900)] m-0">
            Claim-by-claim source checking
          </h3>
          <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
            A separate verification pass checks every factual sentence against its stored passage.
            Unsupported claims are rewritten or removed automatically.
          </p>
        </div>

        <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[var(--neutral-800)]">Claim check</span>
            <span className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--success-bg)] text-[var(--success-text)] font-medium">
              Supported
            </span>
          </div>
          <p className="text-[var(--neutral-600)] m-0">
            Linked to stored source passage #14 · Verified before delivery.
          </p>
        </div>
      </div>

      {/* Side Card 3: Honest Results Handling */}
      <div className="lg:col-span-5 p-6 sm:p-7 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] flex flex-col justify-between gap-5">
        <div className="space-y-2">
          <h3 className="text-xl font-medium text-[var(--neutral-900)] m-0">
            Honest Results for empirical work
          </h3>
          <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
            Collate never invents survey numbers or lab outcomes. Choose from three real paths for
            Results chapters:
          </p>
        </div>

        <ul className="space-y-2 list-none p-0 m-0 text-xs text-[var(--neutral-800)]">
          <li className="px-3 py-2 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
            1. Upload your spreadsheet data to compute real tables
          </li>
          <li className="px-3 py-2 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
            2. Cite verified public datasets where applicable
          </li>
          <li className="px-3 py-2 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
            3. Export a clearly marked template for your own figures
          </li>
        </ul>
      </div>

      {/* Wide Card 4: Print-ready PDF & Word */}
      <div className="lg:col-span-7 p-6 sm:p-7 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] flex flex-col justify-between gap-5">
        <div className="space-y-2">
          <h3 className="text-xl font-medium text-[var(--neutral-900)] m-0">
            Print-ready PDF and editable Word (.docx)
          </h3>
          <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0 max-w-[56ch]">
            Generates a real table of contents with exact page numbers, Roman-numeral front matter,
            and numbered body chapters—never browser print-to-PDF.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
            <p className="font-semibold text-[var(--neutral-900)] m-0">Per chapter</p>
            <p className="text-[var(--neutral-600)] mt-0.5 m-0">
              Download each chapter as it finishes
            </p>
          </div>
          <div className="p-3 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
            <p className="font-semibold text-[var(--neutral-900)] m-0">Combined PDF</p>
            <p className="text-[var(--neutral-600)] mt-0.5 m-0">
              Merge completed chapters any time
            </p>
          </div>
          <div className="p-3 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
            <p className="font-semibold text-[var(--neutral-900)] m-0">Full project + Word</p>
            <p className="text-[var(--neutral-600)] mt-0.5 m-0">
              Match your department template easily
            </p>
          </div>
        </div>
      </div>

      {/* Bottom Card 5: Similarity & Integrity */}
      <div className="lg:col-span-6 p-6 sm:p-7 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-2">
        <h3 className="text-xl font-medium text-[var(--neutral-900)] m-0">
          Similarity checks and writing logs
        </h3>
        <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
          Checks every chapter against your sources for close copying, limits direct quotes, checks
          uniqueness across users on the same topic, and includes a downloadable process log and
          disclosure statement.
        </p>
      </div>

      {/* Bottom Card 6: Running Project Memory */}
      <div className="lg:col-span-6 p-6 sm:p-7 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-2">
        <h3 className="text-xl font-medium text-[var(--neutral-900)] m-0">
          Consistent memory from Chapter 1 to the end
        </h3>
        <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
          Running summaries, key definitions, and your own manual edits carry forward automatically
          so Chapter 5 stays consistent with Chapter 1.
        </p>
      </div>
    </div>
  );
}
