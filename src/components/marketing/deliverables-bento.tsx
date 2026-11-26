"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/layout/workspace-icons";
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
    title: "Honest results for empirical work",
    summary:
      "Tables are calculated from your uploaded data or taken from published studies, never invented.",
  },
  {
    id: "exports",
    title: "Print-ready PDF and Word (.docx)",
    summary:
      "Opening pages numbered i, ii, iii, chapters numbered 1, 2, 3, and a table of contents with the real page numbers.",
  },
  {
    id: "integrity",
    title: "Similarity report, logs & chapter memory",
    summary:
      "Every chapter keeps prior terms consistent and includes overlap scores, a writing log, and a disclosure template.",
  },
];

const MOBILE_QUERY = "(max-width: 1023px)";

function PanelHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)]">
        {children}
      </p>
      {aside}
    </div>
  );
}

function CitationsPanel() {
  const [activeStyle, setActiveStyle] = useState<string>(CITATION_SPECIMENS[0]!.id);
  const specimen = CITATION_SPECIMENS.find((c) => c.id === activeStyle) ?? CITATION_SPECIMENS[0]!;
  return (
    <div className="space-y-5">
      <PanelHeading
        aside={
          <span className="text-xs font-medium text-[var(--success-text)]">
            Checked against the publisher&apos;s record
          </span>
        }
      >
        Live citation formatter
      </PanelHeading>

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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--neutral-500)]">
            In-text sentence
          </p>
          <p className="text-sm text-[var(--neutral-900)] leading-relaxed">
            Off-grid battery storage lowered vaccine spoilage rates by more than half across
            monitored clinics{" "}
            <strong className="text-[var(--accent-600)]">{specimen.inText}</strong>.
          </p>
        </div>

        <div className="border-t border-[var(--neutral-200)] pt-4 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--neutral-500)]">
            Generated reference list entry
          </p>
          <p className="text-xs text-[var(--neutral-800)] leading-relaxed pl-4 -indent-4">
            {specimen.reference}
          </p>
        </div>
      </div>

      <p className="text-xs text-[var(--neutral-600)]">
        Choose in-text citations with a reference list, or a reference list only. Uncited sources
        are never included in the final bibliography.
      </p>
    </div>
  );
}

function ClaimsPanel() {
  return (
    <div className="space-y-4">
      <PanelHeading>How each sentence is checked</PanelHeading>

      <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-5 space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--neutral-700)]">
              Sentence in your chapter
            </span>
            <span className="px-2 py-0.5 text-[11px] font-medium rounded-[var(--radius-sm)] bg-[var(--success-bg)] text-[var(--success-text)]">
              Matches the source
            </span>
          </div>
          <p className="text-sm text-[var(--neutral-900)]">
            Solar microgrids increased vaccine refrigerator uptime from 61% to 97% across 18
            monitored rural clinics.
          </p>
        </div>

        <div className="border-l-2 border-[var(--accent-600)] pl-4 space-y-1 bg-[var(--neutral-50)] py-2.5 pr-3 rounded-r-[var(--radius-sm)]">
          <p className="text-[11px] font-semibold text-[var(--accent-600)]">
            Saved source passage · Okonkwo &amp; Mensah (2024), Section 3
          </p>
          <p className="text-xs text-[var(--neutral-700)]">
            &ldquo;Across the 18 primary clinics monitored for 12 months, mean cold-chain uptime
            rose from 61% under diesel generators to 97% following solar installation.&rdquo;
          </p>
        </div>

        <div className="pt-2 border-t border-[var(--neutral-200)] flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[var(--neutral-600)]">A sentence the source does not support?</span>
          <span className="font-medium text-[var(--warning-text)]">Rewritten or removed</span>
        </div>
      </div>
    </div>
  );
}

function ResultsPanel() {
  return (
    <div className="space-y-4">
      <PanelHeading>Real tables calculated from your data</PanelHeading>

      <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[var(--neutral-900)]">
            Table 4.1: Summary of your survey data
          </span>
          <span className="text-[11px] font-medium text-[var(--success-text)]">
            Calculated from your file
          </span>
        </div>

        <div className="overflow-x-auto border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
          <table className="w-full text-left border-collapse text-xs tabular-nums">
            <thead>
              <tr className="bg-[var(--neutral-100)] border-b border-[var(--neutral-200)] text-[var(--neutral-700)]">
                <th className="py-2 px-3">Measure</th>
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

        <p className="text-xs text-[var(--neutral-600)] leading-relaxed">
          No data of your own yet? Collate can build tables from published studies or public
          datasets, or leave clearly marked blanks such as{" "}
          <span className="font-mono text-[11px] bg-[var(--neutral-100)] px-1 py-0.5 rounded">
            [ADD: value]
          </span>{" "}
          for you to fill in.
        </p>
      </div>
    </div>
  );
}

function ExportsPanel() {
  return (
    <div className="space-y-4">
      <PanelHeading>How your file is laid out</PanelHeading>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-4 flex flex-col justify-between gap-4 text-xs">
          <div className="text-center space-y-2 pt-1">
            <p className="text-[10px] uppercase tracking-wider text-[var(--neutral-500)]">
              Opening pages
            </p>
            <p
              className="text-sm font-semibold text-[var(--neutral-900)]"
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
          <p className="text-center text-[10px] text-[var(--neutral-500)]">Numbered i, ii, iii</p>
        </div>

        <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-4 flex flex-col justify-between gap-4 text-xs">
          <div className="space-y-2 pt-1">
            <p className="text-[10px] uppercase tracking-wider text-[var(--neutral-500)]">
              Chapters &amp; references
            </p>
            <p
              className="text-sm font-semibold text-[var(--neutral-900)]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Chapter 1: Introduction
            </p>
            <p className="text-[11px] text-[var(--neutral-600)] leading-relaxed">
              Set in the font, size, spacing and margins you chose. Download as a PDF or as an
              editable Word file.
            </p>
          </div>
          <p className="text-center text-[10px] text-[var(--neutral-500)]">Numbered 1, 2, 3</p>
        </div>
      </div>
    </div>
  );
}

function IntegrityPanel() {
  return (
    <div className="space-y-4">
      <PanelHeading>Integrity report &amp; cross-chapter memory</PanelHeading>

      <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-5 space-y-4">
        <div className="grid grid-cols-3 gap-3 text-xs tabular-nums">
          <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
            <p className="text-[var(--neutral-600)]">Source overlap</p>
            <p className="text-base font-semibold text-[var(--success-text)]">2.8%</p>
          </div>
          <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
            <p className="text-[var(--neutral-600)]">Direct quotes</p>
            <p className="text-base font-semibold text-[var(--neutral-900)]">0.4%</p>
          </div>
          <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)]">
            <p className="text-[var(--neutral-600)]">Uniqueness</p>
            <p className="text-base font-semibold text-[var(--success-text)]">Passed</p>
          </div>
        </div>

        <div className="space-y-1.5 text-xs text-[var(--neutral-700)] border-t border-[var(--neutral-200)] pt-3">
          <p className="font-semibold text-[var(--neutral-900)]">Included with every project:</p>
          <p>• Downloadable writing-process log showing sources, drafts, and edits</p>
          <p>• Editable AI-use disclosure statement tailored to your institution</p>
          <p>• Shared chapter memory carrying terms and edits into later chapters</p>
        </div>
      </div>
    </div>
  );
}

const PANELS: Record<DeliverableKey, () => ReactNode> = {
  citations: () => <CitationsPanel />,
  claims: () => <ClaimsPanel />,
  results: () => <ResultsPanel />,
  exports: () => <ExportsPanel />,
  integrity: () => <IntegrityPanel />,
};

/**
 * Desktop: list on the left, the selected item's detail on the right, sized to its own content.
 * Phones and tablets: the same two panes side by side in a swipeable track. Tapping an item
 * slides its detail into view; swiping or "All features" slides back to the list.
 */
export function DeliverablesBento() {
  const [selected, setSelected] = useState<DeliverableKey>("citations");
  const [page, setPage] = useState<0 | 1>(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const isMobile = () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;

  // On phones the track is as tall as the pane in view, so neither pane leaves empty space.
  const fitHeight = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    if (!isMobile()) {
      track.style.height = "";
      return;
    }
    const pane = page === 0 ? listRef.current : detailRef.current;
    if (pane) track.style.height = `${pane.offsetHeight}px`;
  }, [page]);

  useEffect(() => {
    fitHeight();
    const observer = new ResizeObserver(fitHeight);
    if (listRef.current) observer.observe(listRef.current);
    if (detailRef.current) observer.observe(detailRef.current);
    window.addEventListener("resize", fitHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fitHeight);
    };
  }, [fitHeight, selected]);

  function goTo(target: 0 | 1) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: target === 1 ? track.clientWidth : 0, behavior: "smooth" });
    setPage(target);
  }

  function choose(id: DeliverableKey) {
    setSelected(id);
    if (isMobile()) goTo(1);
  }

  function handleScroll() {
    const track = trackRef.current;
    if (!track || !isMobile()) return;
    const next = track.scrollLeft > track.clientWidth / 2 ? 1 : 0;
    if (next !== page) setPage(next);
  }

  const current = FEATURES.find((f) => f.id === selected)!;

  return (
    <div
      ref={trackRef}
      onScroll={handleScroll}
      className="flex items-start overflow-x-auto overflow-y-hidden snap-x snap-mandatory transition-[height] duration-300 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:grid lg:grid-cols-12 lg:gap-8 lg:overflow-visible lg:snap-none"
    >
      {/* Left: feature list */}
      <div
        ref={listRef}
        role="tablist"
        aria-label="Project deliverables"
        className="w-full shrink-0 snap-start pr-3 lg:pr-0 lg:col-span-5 flex flex-col gap-3"
      >
        {FEATURES.map((feat) => {
          const active = selected === feat.id;
          return (
            <button
              key={feat.id}
              type="button"
              role="tab"
              id={`deliverable-tab-${feat.id}`}
              aria-selected={active}
              aria-controls="deliverable-panel"
              onClick={() => choose(feat.id)}
              className={`text-left p-4 sm:p-5 rounded-[var(--radius-md)] border transition-all duration-150 cursor-pointer ${
                active
                  ? "bg-white border-[var(--accent-600)] shadow-[var(--shadow-subtle)]"
                  : "bg-[var(--neutral-50)] border-[var(--neutral-200)] hover:bg-white hover:border-[var(--neutral-300)]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-semibold text-[var(--neutral-900)]">
                  {feat.title}
                </span>
                <ArrowRightIcon
                  className={`w-4 h-4 shrink-0 transition-transform duration-150 ${
                    active
                      ? "text-[var(--accent-600)] translate-x-0.5"
                      : "text-[var(--neutral-400)]"
                  }`}
                />
              </div>
              <p className="text-sm text-[var(--neutral-600)] leading-relaxed mt-1.5">
                {feat.summary}
              </p>
            </button>
          );
        })}
      </div>

      {/* Right: detail for the selected feature */}
      <div
        ref={detailRef}
        className="w-full shrink-0 snap-start pl-3 lg:pl-0 lg:col-span-7 lg:sticky lg:top-24"
      >
        <button
          type="button"
          onClick={() => goTo(0)}
          className="lg:hidden mb-3 inline-flex items-center gap-1.5 min-h-[40px] text-sm font-medium text-[var(--accent-600)] cursor-pointer"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          All features
        </button>
        <div
          id="deliverable-panel"
          role="tabpanel"
          aria-labelledby={`deliverable-tab-${selected}`}
          className="bg-[var(--neutral-50)] border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 sm:p-8"
        >
          <p className="lg:hidden mb-4 text-base font-semibold text-[var(--neutral-900)]">
            {current.title}
          </p>
          <div key={selected} className="animate-[fadeIn_200ms_ease-out]">
            {PANELS[selected]()}
          </div>
        </div>
      </div>
    </div>
  );
}
