"use client";

import { useState } from "react";

type PreviewTab = "check" | "chapter" | "export";

const SUBTOPICS = [
  { label: "Microgrid cold-chain reliability", sources: 12, pct: 95 },
  { label: "Battery lifecycle economics", sources: 10, pct: 86 },
  { label: "Rural clinic outage patterns", sources: 9, pct: 80 },
  { label: "Maintenance and policy barriers", sources: 7, pct: 72 },
];

export function HeroWorkspacePreview() {
  const [tab, setTab] = useState<PreviewTab>("check");
  const [citationOpen, setCitationOpen] = useState(true);

  return (
    <aside
      aria-label="Interactive example of a Collate project"
      className="relative bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] shadow-[var(--shadow-raised)] overflow-hidden"
    >
      {/* Top document bar */}
      <div className="px-5 py-3.5 bg-[var(--neutral-100)] border-b border-[var(--neutral-200)] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--neutral-500)] m-0">
            Sample workspace
          </p>
          <p className="text-sm font-semibold text-[var(--neutral-900)] truncate m-0">
            Solar Microgrid Reliability in Rural Clinics
          </p>
        </div>
        <span className="shrink-0 inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] border bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]">
          Feasible · 86/100
        </span>
      </div>

      {/* Interactive stage tabs */}
      <div
        role="tablist"
        aria-label="Preview stages"
        className="grid grid-cols-3 border-b border-[var(--neutral-200)] bg-[var(--neutral-50)] text-xs font-medium"
      >
        {(
          [
            { id: "check", label: "1. Source check" },
            { id: "chapter", label: "2. Chapter draft" },
            { id: "export", label: "3. Final PDF" },
          ] as const
        ).map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={`min-h-[42px] px-2 sm:px-3 py-2 text-center transition-colors duration-150 cursor-pointer border-b-2 ${
                active
                  ? "border-[var(--accent-600)] text-[var(--accent-600)] bg-white font-semibold"
                  : "border-transparent text-[var(--neutral-600)] hover:text-[var(--neutral-900)]"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="p-5 sm:p-6 min-h-[296px] flex flex-col justify-between gap-5">
        {tab === "check" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
                <p className="text-[11px] text-[var(--neutral-600)] m-0">Credible sources</p>
                <p className="text-base font-semibold text-[var(--neutral-900)] tabular-nums m-0">
                  38 verified
                </p>
              </div>
              <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
                <p className="text-[11px] text-[var(--neutral-600)] m-0">Ideal length</p>
                <p className="text-base font-semibold text-[var(--neutral-900)] tabular-nums m-0">
                  80 pages
                </p>
              </div>
              <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
                <p className="text-[11px] text-[var(--neutral-600)] m-0">Citation style</p>
                <p className="text-base font-semibold text-[var(--neutral-900)] m-0">APA 7th ed.</p>
              </div>
            </div>

            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-[var(--neutral-700)] m-0">
                Subtopic evidence coverage
              </p>
              {SUBTOPICS.map((sub) => (
                <div key={sub.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--neutral-800)]">{sub.label}</span>
                    <span className="tabular-nums text-[var(--neutral-600)]">
                      {sub.sources} sources
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[var(--neutral-100)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--accent-600)] transition-all duration-300"
                      style={{ width: `${sub.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {tab === "chapter" ? (
          <div className="space-y-4">
            <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--neutral-500)]">
                  Chapter 2 · Section 2.1
                </span>
                <span className="text-[11px] font-medium text-[var(--success-text)]">
                  Claims verified · Similarity passed
                </span>
              </div>
              <p className="text-sm text-[var(--neutral-800)] leading-relaxed m-0">
                Primary clinics powered by localized solar storage maintained cold-chain
                temperatures during extended grid outages{" "}
                <button
                  type="button"
                  onClick={() => setCitationOpen((prev) => !prev)}
                  className="inline px-1.5 py-0.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--accent-100)] text-[var(--accent-600)] underline underline-offset-2 cursor-pointer"
                >
                  (Okonkwo &amp; Mensah, 2024)
                </button>
                .
              </p>

              {citationOpen ? (
                <div className="p-3 rounded-[var(--radius-sm)] bg-white border border-[var(--neutral-200)] text-xs space-y-1">
                  <p className="font-semibold text-[var(--neutral-900)] m-0">
                    Verified source · Energy Policy (2024)
                  </p>
                  <p className="text-[var(--neutral-600)] m-0">
                    Linked passage: &ldquo;Vaccine refrigerator uptime rose from 61% to 97% across
                    18 monitored rural facilities.&rdquo;
                  </p>
                </div>
              ) : null}
            </div>

            <ul className="divide-y divide-[var(--neutral-200)] border border-[var(--neutral-200)] rounded-[var(--radius-sm)] list-none p-0 m-0 text-xs">
              <li className="px-3.5 py-2.5 flex items-center justify-between">
                <span>
                  <strong className="mr-1.5">Ch. 1</strong> Introduction
                </span>
                <span className="text-[var(--success-text)] font-medium">Approved</span>
              </li>
              <li className="px-3.5 py-2.5 flex items-center justify-between bg-[var(--neutral-50)]">
                <span>
                  <strong className="mr-1.5">Ch. 2</strong> Literature Review
                </span>
                <span className="text-[var(--accent-600)] font-medium">Ready · Email sent</span>
              </li>
              <li className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-[var(--neutral-600)]">
                  <strong className="mr-1.5">Ch. 3</strong> Methodology
                </span>
                <span className="text-[var(--neutral-500)]">Starts when you click</span>
              </li>
            </ul>
          </div>
        ) : null}

        {tab === "export" ? (
          <div className="space-y-4">
            <div className="p-5 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-3">
              <div className="flex items-center justify-between border-b border-[var(--neutral-200)] pb-2.5">
                <p
                  className="text-sm font-semibold text-[var(--neutral-900)] m-0"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  Table of Contents
                </p>
                <span className="text-[11px] text-[var(--neutral-500)] tabular-nums">
                  Measured · 82 pages
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-[var(--neutral-700)] tabular-nums">
                <div className="flex justify-between border-b border-dotted border-[var(--neutral-300)] pb-1">
                  <span>Declaration &amp; Abstract</span>
                  <span>ii</span>
                </div>
                <div className="flex justify-between border-b border-dotted border-[var(--neutral-300)] pb-1">
                  <span>Chapter 1 · Introduction</span>
                  <span>1</span>
                </div>
                <div className="flex justify-between border-b border-dotted border-[var(--neutral-300)] pb-1">
                  <span>Chapter 2 · Literature Review</span>
                  <span>11</span>
                </div>
                <div className="flex justify-between border-b border-dotted border-[var(--neutral-300)] pb-1">
                  <span>Chapter 3 · Methodology</span>
                  <span>34</span>
                </div>
                <div className="flex justify-between">
                  <span>References (verified records only)</span>
                  <span>76</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--neutral-700)]">
              <span className="px-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-white font-medium">
                Full thesis PDF
              </span>
              <span className="px-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-white font-medium">
                Editable Word (.docx)
              </span>
              <span className="px-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-white font-medium">
                Writing log &amp; disclosure
              </span>
            </div>
          </div>
        ) : null}

        <div className="pt-3 border-t border-[var(--neutral-200)] flex items-center justify-between text-xs text-[var(--neutral-500)]">
          <span>Click any stage above to inspect the workflow</span>
          <span className="tabular-nums">Example output</span>
        </div>
      </div>
    </aside>
  );
}
