"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import type { FeasibilityVerdict, ResearchRunStatus } from "@/db/schema";
import type { SerializedWizardState } from "@/lib/wizard/http-handlers";

interface LiveResearchSummary {
  run: {
    id: string;
    status: ResearchRunStatus;
    sourcesFound: number;
    sourcesFetched: number;
    subtopicsCovered: number;
    totalSubtopics: number;
    error: string | null;
  } | null;
  topSources: Array<{
    id: string;
    title: string;
    url: string;
    doi: string | null;
    year: number | null;
    venue: string | null;
    sourceType: string;
    credibilityScore: number;
    relevanceScore: number;
    accessStatus: string;
  }>;
}

const RUN_STAGE_LABELS: Record<ResearchRunStatus, string> = {
  queued: "Queued for research sweep",
  planning: "Planning subtopics and scholarly queries",
  searching: "Searching scholarly databases and web sources",
  fetching: "Fetching pages, extracting passages, and saving snapshots",
  scoring: "Scoring credibility, relevance, and subtopic coverage",
  completed: "Source sweep completed",
  failed: "Sweep interrupted — ready to resume without losing progress",
};

const VERDICT_META: Record<
  FeasibilityVerdict,
  { title: string; tone: "success" | "warning" | "error"; badge: string }
> = {
  feasible: { title: "Topic is feasible", tone: "success", badge: "Feasible" },
  needs_refinement: {
    title: "Topic needs refinement",
    tone: "warning",
    badge: "Needs refinement",
  },
  not_feasible: {
    title: "Cannot be worked on as written",
    tone: "error",
    badge: "Not feasible",
  },
};

export function StepResearchSweep({
  wizard,
  saving,
  onSave,
  onBackToTopic,
  onContinueToLength,
}: {
  wizard: SerializedWizardState;
  saving: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onBackToTopic: () => void;
  onContinueToLength: () => void;
}) {
  const [simulateVerdict, setSimulateVerdict] = useState<FeasibilityVerdict>("feasible");
  const [liveSummary, setLiveSummary] = useState<LiveResearchSummary | null>(null);
  const [startingLive, setStartingLive] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const reports = wizard.feasibilityReports;
  const primaryReport = reports[0];
  const activeRun = liveSummary?.run;
  const isRunning =
    activeRun !== null &&
    activeRun !== undefined &&
    ["queued", "planning", "searching", "fetching", "scoring"].includes(activeRun.status);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const res = await fetch(`/api/projects/${wizard.project.id}/research`);
        if (!res.ok) return;
        const data = (await res.json()) as { ok: boolean } & LiveResearchSummary;
        if (!cancelled && data.ok) {
          setLiveSummary({ run: data.run, topSources: data.topSources });
        }
      } catch {
        // Keep current UI state on transient poll hiccup
      }
    }

    void fetchStatus();
    if (!isRunning) {
      return () => {
        cancelled = true;
      };
    }

    const interval = setInterval(() => {
      void fetchStatus();
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [wizard.project.id, isRunning]);

  async function startLiveSweep(resumeRunId?: string) {
    setLiveError(null);
    setStartingLive(true);
    try {
      const res = await fetch(`/api/projects/${wizard.project.id}/research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(resumeRunId ? { resumeRunId } : {}),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setLiveError(data.error ?? "Could not start the source sweep. Try again.");
        return;
      }

      const statusRes = await fetch(`/api/projects/${wizard.project.id}/research`);
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as { ok: boolean } & LiveResearchSummary;
        if (statusData.ok) {
          setLiveSummary({ run: statusData.run, topSources: statusData.topSources });
        }
      }
    } catch {
      setLiveError("Network error while starting the source sweep.");
    } finally {
      setStartingLive(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-medium">Source sweep and feasibility check</h2>
        <p className="text-sm text-[var(--neutral-600)]">
          Collate searches scholarly databases and web sources first to verify your topic can be
          written without guessing.
        </p>
      </div>

      {liveError ? <FormAlert tone="error">{liveError}</FormAlert> : null}

      <div className="p-5 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--neutral-900)] m-0">
              Live scholarly &amp; web research sweep
            </p>
            <p className="text-xs text-[var(--neutral-600)] mt-0.5 m-0">
              {activeRun
                ? RUN_STAGE_LABELS[activeRun.status]
                : "Runs OpenAlex, Crossref, Semantic Scholar, arXiv, Europe PMC, DOAJ, Unpaywall, and configured web APIs."}
            </p>
          </div>
          <Button
            type="button"
            loading={startingLive || isRunning}
            loadingLabel={isRunning ? "Sweeping sources..." : "Starting sweep..."}
            onClick={() =>
              startLiveSweep(activeRun?.status === "failed" ? activeRun.id : undefined)
            }
          >
            {activeRun?.status === "failed"
              ? "Resume interrupted sweep"
              : activeRun?.status === "completed"
                ? "Run fresh sweep"
                : "Start source sweep"}
          </Button>
        </div>

        {activeRun ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[var(--neutral-200)]">
            <div className="p-3 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
              <p className="text-xs text-[var(--neutral-600)] m-0">Sources found</p>
              <p className="text-xl font-semibold text-[var(--neutral-900)] tabular-nums m-0">
                {activeRun.sourcesFound}
              </p>
            </div>
            <div className="p-3 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
              <p className="text-xs text-[var(--neutral-600)] m-0">Sources fetched</p>
              <p className="text-xl font-semibold text-[var(--neutral-900)] tabular-nums m-0">
                {activeRun.sourcesFetched}
              </p>
            </div>
            <div className="p-3 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
              <p className="text-xs text-[var(--neutral-600)] m-0">Subtopics covered</p>
              <p className="text-xl font-semibold text-[var(--neutral-900)] tabular-nums m-0">
                {activeRun.subtopicsCovered}
                {activeRun.totalSubtopics > 0 ? ` / ${activeRun.totalSubtopics}` : ""}
              </p>
            </div>
          </div>
        ) : null}

        {activeRun?.error ? <FormAlert tone="warning">{activeRun.error}</FormAlert> : null}
      </div>

      {liveSummary && liveSummary.topSources.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-[var(--neutral-900)] m-0">
            Top retrieved sources ({liveSummary.topSources.length} shown)
          </p>
          <ul className="divide-y divide-[var(--neutral-200)] border border-[var(--neutral-200)] rounded-[var(--radius-md)] bg-white list-none p-0 m-0">
            {liveSummary.topSources.slice(0, 8).map((src) => (
              <li key={src.id} className="p-4 space-y-1">
                <p className="text-sm font-medium text-[var(--neutral-900)] m-0">{src.title}</p>
                <p className="text-xs text-[var(--neutral-600)] tabular-nums m-0">
                  {src.venue ? `${src.venue} · ` : ""}
                  {src.year ?? "n.d."} · Credibility {Math.round(src.credibilityScore)}/100 ·
                  Relevance {Math.round(src.relevanceScore)}/100
                  {src.doi ? ` · DOI: ${src.doi}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-4 bg-white">
        <summary className="text-sm font-medium text-[var(--neutral-700)] cursor-pointer">
          Offline verdict preview (mock mode until Phase 4 feasibility gate)
        </summary>
        <div className="pt-4 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="mock-verdict"
              className="block text-sm font-medium text-[var(--neutral-800)]"
            >
              Preview verdict outcome
            </label>
            <select
              id="mock-verdict"
              value={simulateVerdict}
              onChange={(e) => setSimulateVerdict(e.target.value as FeasibilityVerdict)}
              className="block w-full sm:max-w-[320px] min-h-[44px] px-3.5 py-2.5 text-base bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
            >
              <option value="feasible">Feasible (sufficient evidence)</option>
              <option value="needs_refinement">Needs refinement (too broad/narrow)</option>
              <option value="not_feasible">Not feasible (cannot guess)</option>
            </select>
          </div>
          <Button
            type="button"
            variant="secondary"
            loading={saving}
            loadingLabel="Saving verdict preview..."
            onClick={() => onSave({ step: 3, simulateVerdict })}
          >
            Save mock verdict preview
          </Button>
        </div>
      </details>

      {primaryReport ? (
        <div className="space-y-4">
          <FormAlert tone={VERDICT_META[primaryReport.verdict].tone}>
            <span className="font-semibold">{VERDICT_META[primaryReport.verdict].title}</span> —
            Evidence score {primaryReport.score}/100 ({primaryReport.coverage.sourcesFound} sources,{" "}
            {primaryReport.coverage.subtopicsCovered} subtopics covered).
          </FormAlert>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onBackToTopic}>
              Edit topic
            </Button>
            {primaryReport.verdict === "feasible" ? (
              <Button type="button" onClick={onContinueToLength}>
                Continue to page length
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onBackToTopic}>
            Edit topic
          </Button>
          {activeRun?.status === "completed" && activeRun.sourcesFound > 0 ? (
            <Button type="button" onClick={onContinueToLength}>
              Continue to page length
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function StepLengthForm({
  wizard,
  saving,
  onSave,
  onBack,
}: {
  wizard: SerializedWizardState;
  saving: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onBack: () => void;
}) {
  const recommended = wizard.project.idealPages ?? 40;
  const reason =
    wizard.feasibilityReports[0]?.coverage.idealPagesReason ||
    "Recommended based on your selected work type and scope.";

  const [pagesInput, setPagesInput] = useState(String(wizard.project.targetPages ?? recommended));
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);
    const parsed = Number(pagesInput);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 300) {
      setLocalError("Enter a whole page count between 1 and 300.");
      return;
    }
    await onSave({ step: 4, targetPages: parsed });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-medium">Recommended page length</h2>
        <p className="text-sm text-[var(--neutral-600)]">
          Keep our recommended length or enter your department&apos;s required page count. Final
          pages are measured from real rendered PDFs.
        </p>
      </div>

      {localError ? <FormAlert tone="error">{localError}</FormAlert> : null}

      <div className="p-5 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--accent-100)] space-y-2">
        <p className="text-xs font-semibold text-[var(--accent-600)] m-0">Ideal recommendation</p>
        <p
          className="text-3xl font-medium text-[var(--neutral-900)] tabular-nums m-0"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {recommended} pages
        </p>
        <p className="text-sm text-[var(--neutral-700)] m-0">{reason}</p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 max-w-[260px]">
          <FormField
            id="target-pages"
            label="Your target page count"
            type="number"
            min={1}
            max={300}
            required
            value={pagesInput}
            onChange={(e) => setPagesInput(e.target.value)}
            helpText="Accepted range: 1 to 300 pages."
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setPagesInput(String(recommended))}
        >
          Use recommended ({recommended})
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" loading={saving} loadingLabel="Saving length...">
          {wizard.project.type === "assignment" ? "Continue to citations" : "Continue to chapters"}
        </Button>
      </div>
    </form>
  );
}
