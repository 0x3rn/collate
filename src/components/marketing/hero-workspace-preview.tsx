"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PreviewTab = "check" | "chapter" | "export";

const SUBTOPIC_TARGET = 8;

const SUBTOPICS = [
  { label: "Cold-chain reliability", found: 8, target: SUBTOPIC_TARGET },
  { label: "Battery lifecycle cost", found: 8, target: SUBTOPIC_TARGET },
  { label: "Rural clinic outages", found: 7, target: SUBTOPIC_TARGET },
  { label: "Maintenance and policy", found: 6, target: SUBTOPIC_TARGET },
];

export function HeroWorkspacePreview() {
  const containerRef = useRef<HTMLElement | null>(null);
  const [tab, setTab] = useState<PreviewTab>("check");
  const [citationOpen, setCitationOpen] = useState(true);
  const [barsAnimated, setBarsAnimated] = useState(false);

  const replayBars = useCallback(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setBarsAnimated(true);
      return;
    }

    setBarsAnimated(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setBarsAnimated(true);
      });
    });
  }, []);

  // Re-animate bars on initial mount and whenever hero scrolls back into view
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setBarsAnimated(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          replayBars();
        } else {
          setBarsAnimated(false);
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [replayBars]);

  function handleSelectTab(nextTab: PreviewTab) {
    setTab(nextTab);
    if (nextTab === "check") {
      replayBars();
    }
  }

  return (
    <aside
      ref={containerRef}
      aria-label="Interactive example of a Collate project"
      className="relative bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] shadow-[var(--shadow-raised)] overflow-hidden"
    >
      {/* Header bar */}
      <div className="px-5 py-3.5 bg-[var(--neutral-100)] border-b border-[var(--neutral-200)] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--neutral-500)] m-0">
            Sample project
          </p>
          <p className="text-sm font-semibold text-[var(--neutral-900)] truncate m-0">
            Solar Microgrid Reliability in Rural Clinics
          </p>
        </div>
        <span className="shrink-0 inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] border bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]">
          Feasible · 86/100
        </span>
      </div>

      {/* Stage selector */}
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
              onClick={() => handleSelectTab(item.id)}
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

      {/* Equal-height CSS Grid stack prevents any layout height jump across all 3 tabs */}
      <div className="p-5 sm:p-6 flex flex-col justify-between gap-4">
        <div className="grid">
          {/* Tab 1: Source Check */}
          <div
            aria-hidden={tab !== "check"}
            className={`col-start-1 row-start-1 space-y-4 transition-opacity duration-200 ${
              tab === "check"
                ? "opacity-100 visible"
                : "opacity-0 invisible pointer-events-none select-none"
            }`}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
                <p className="text-[11px] text-[var(--neutral-600)] m-0">Sources verified</p>
                <p className="text-base font-semibold text-[var(--neutral-900)] tabular-nums m-0">
                  38 of 30 min
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

            <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[var(--neutral-800)]">
                  Evidence coverage by subtopic
                </span>
                <span className="text-[var(--neutral-600)] tabular-nums">
                  Goal: {SUBTOPIC_TARGET} sources each
                </span>
              </div>

              <div className="space-y-2.5">
                {SUBTOPICS.map((sub, idx) => {
                  const pct = Math.min(100, Math.round((sub.found / sub.target) * 100));
                  return (
                    <div key={sub.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--neutral-800)]">{sub.label}</span>
                        <span className="tabular-nums text-[var(--neutral-600)]">
                          {sub.found} / {sub.target} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-white border border-[var(--neutral-200)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--accent-600)] transition-all duration-700 ease-out"
                          style={{
                            width: barsAnimated ? `${pct}%` : "0%",
                            transitionDelay: `${idx * 70}ms`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Tab 2: Chapter Draft */}
          <div
            aria-hidden={tab !== "chapter"}
            className={`col-start-1 row-start-1 space-y-4 transition-opacity duration-200 ${
              tab === "chapter"
                ? "opacity-100 visible"
                : "opacity-0 invisible pointer-events-none select-none"
            }`}
          >
            <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--neutral-600)]">
                  Chapter 2 · Section 2.1
                </span>
                <span className="text-[11px] font-medium text-[var(--success-text)]">
                  Claims verified · Similarity passed
                </span>
              </div>
              <p className="text-sm text-[var(--neutral-800)] leading-relaxed m-0">
                Primary clinics powered by localized solar storage maintained cold-chain
                temperatures during grid outages{" "}
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
                <div className="p-2.5 rounded-[var(--radius-sm)] bg-white border border-[var(--neutral-200)] text-xs space-y-0.5">
                  <p className="font-semibold text-[var(--neutral-900)] m-0">
                    Verified source · Energy Policy (2024)
                  </p>
                  <p className="text-[var(--neutral-600)] m-0">
                    Stored passage: &ldquo;Vaccine refrigerator uptime rose from 61% to 97% across
                    18 monitored facilities.&rdquo;
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

          {/* Tab 3: Final PDF */}
          <div
            aria-hidden={tab !== "export"}
            className={`col-start-1 row-start-1 space-y-4 transition-opacity duration-200 ${
              tab === "export"
                ? "opacity-100 visible"
                : "opacity-0 invisible pointer-events-none select-none"
            }`}
          >
            <div className="p-4 sm:p-5 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-3">
              <div className="flex items-center justify-between border-b border-[var(--neutral-200)] pb-2.5">
                <p
                  className="text-sm font-semibold text-[var(--neutral-900)] m-0"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  Table of Contents
                </p>
                <span className="text-xs text-[var(--neutral-600)] tabular-nums">
                  Measured · 82 pages
                </span>
              </div>

              <div className="space-y-2 text-xs text-[var(--neutral-700)] tabular-nums">
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
                <div className="flex justify-between border-b border-dotted border-[var(--neutral-300)] pb-1">
                  <span>Chapter 4 &amp; 5 · Results &amp; Conclusion</span>
                  <span>49</span>
                </div>
                <div className="flex justify-between">
                  <span>References (verified records only)</span>
                  <span>76</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs text-[var(--neutral-800)]">
              <div className="px-2 py-2.5 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-white font-medium">
                Full PDF
              </div>
              <div className="px-2 py-2.5 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-white font-medium">
                Word (.docx)
              </div>
              <div className="px-2 py-2.5 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-white font-medium">
                Writing log
              </div>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-[var(--neutral-200)] flex items-center justify-between text-xs text-[var(--neutral-500)]">
          <span>Switch stages above to inspect the flow</span>
          <span>Example project</span>
        </div>
      </div>
    </aside>
  );
}
