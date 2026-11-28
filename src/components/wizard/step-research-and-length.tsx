"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { FormField } from "@/components/ui/field";
import {
  InsufficientCreditsModal,
  type InsufficientCreditsDetails,
} from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";
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
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

const RUN_STAGE_LABELS: Record<ResearchRunStatus, string> = {
  queued: "Waiting to start the source check",
  planning: "Breaking your topic into parts to search",
  searching: "Searching research databases and web sources",
  fetching: "Reading each source and saving the useful passages",
  scoring: "Checking how many trusted sources back each part",
  completed: "Source check finished",
  failed: "The check stopped early. Your progress is saved, so you can resume.",
};

const VERDICT_META: Record<
  FeasibilityVerdict,
  { title: string; tone: "success" | "warning" | "error"; badge: string }
> = {
  feasible: {
    title: "Good news: this topic has enough sources.",
    tone: "success",
    badge: "Enough sources",
  },
  needs_refinement: {
    title: "Your topic needs narrowing.",
    tone: "warning",
    badge: "Narrow your topic",
  },
  not_feasible: {
    title: "There aren't enough real sources for this topic as written.",
    tone: "error",
    badge: "Not enough sources",
  },
};

export function StepResearchSweep({
  wizard,
  saving,
  allowDevPreview = false,
  onSave,
  onRefreshWizard,
  onBackToTopic,
  onContinueToLength,
}: {
  wizard: SerializedWizardState;
  saving: boolean;
  allowDevPreview?: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onRefreshWizard?: () => Promise<void>;
  onBackToTopic: () => void;
  onContinueToLength: () => void;
}) {
  const toast = useToast();
  const [simulateVerdict, setSimulateVerdict] = useState<FeasibilityVerdict>("feasible");
  const [liveSummary, setLiveSummary] = useState<LiveResearchSummary | null>(null);
  const [startingLive, setStartingLive] = useState(false);
  const [creditsModal, setCreditsModal] = useState<InsufficientCreditsDetails | null>(null);
  const lastCompletedRunIdRef = useRef<string | null>(null);
  const lastFailedRunKeyRef = useRef<string | null>(null);

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
          setLiveSummary({ run: data.run });
          if (data.run?.status === "completed" && data.run.id !== lastCompletedRunIdRef.current) {
            lastCompletedRunIdRef.current = data.run.id;
            if (onRefreshWizard) {
              await onRefreshWizard();
            }
          }
          if (data.run?.status === "failed" && data.run.error) {
            const failKey = `${data.run.id}:${data.run.error}`;
            if (failKey !== lastFailedRunKeyRef.current) {
              lastFailedRunKeyRef.current = failKey;
              toast.error(data.run.error, "Source check stopped");
            }
          }
        }
      } catch {
        // Keep current state on transient poll error
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
  }, [wizard.project.id, isRunning, onRefreshWizard, toast]);

  async function startLiveSweep(resumeRunId?: string) {
    setStartingLive(true);
    try {
      const res = await fetch(`/api/projects/${wizard.project.id}/research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(resumeRunId ? { resumeRunId } : {}),
      });
      const data = (await res.json()) as {
        ok: boolean;
        code?: string;
        creditsRequired?: number;
        creditsAvailable?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        if (
          (res.status === 402 || data.code === "INSUFFICIENT_CREDITS") &&
          typeof data.creditsRequired === "number"
        ) {
          setCreditsModal({
            actionLabel: "Running another topic check",
            creditsRequired: data.creditsRequired,
            creditsAvailable: data.creditsAvailable,
            message: data.error,
          });
          return;
        }
        toast.error(
          data.error ?? "We could not start the check. Try again.",
          "Could not start the check"
        );
        return;
      }

      const statusRes = await fetch(`/api/projects/${wizard.project.id}/research`);
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as { ok: boolean } & LiveResearchSummary;
        if (statusData.ok) {
          setLiveSummary({ run: statusData.run });
        }
      }
    } catch {
      toast.error("Check your connection, then try the check again.", "Connection error");
    } finally {
      setStartingLive(false);
    }
  }

  const primaryDataNotice = primaryReport?.coverage.primaryDataNotice ?? null;
  const subtopicBreakdown = primaryReport?.coverage.subtopicBreakdown ?? [];
  const suggestedRefinements = primaryReport?.coverage.suggestedRefinements ?? [];
  const canProceed =
    primaryReport !== undefined &&
    (wizard.project.type === "assignment"
      ? reports.some((r) => r.verdict === "feasible")
      : primaryReport.verdict === "feasible");

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-medium">Check your topic</h2>
        <p className="text-sm text-[var(--neutral-600)] leading-relaxed">
          Collate searches research databases and credible publications first to verify your topic
          has enough real evidence before any writing starts.
        </p>
      </div>

      <div className="p-5 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--neutral-900)]">Check topic sources</p>
            <p className="text-xs text-[var(--neutral-600)] mt-1">
              {activeRun
                ? RUN_STAGE_LABELS[activeRun.status]
                : "Searches peer-reviewed journals, research indexes, institutional reports, and credible publications."}
            </p>
          </div>
          <Button
            type="button"
            loading={startingLive || isRunning}
            loadingLabel={isRunning ? "Checking sources..." : "Starting check..."}
            onClick={() =>
              startLiveSweep(activeRun?.status === "failed" ? activeRun.id : undefined)
            }
          >
            {activeRun?.status === "failed"
              ? "Resume the check"
              : activeRun?.status === "completed"
                ? "Run a new check"
                : "Check my topic"}
          </Button>
        </div>

        {activeRun ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[var(--neutral-200)]">
            <div className="p-3 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
              <p className="text-xs text-[var(--neutral-600)]">Sources found</p>
              <p className="text-xl font-semibold text-[var(--neutral-900)] tabular-nums">
                {activeRun.sourcesFound}
              </p>
            </div>
            <div className="p-3 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
              <p className="text-xs text-[var(--neutral-600)]">Sources read</p>
              <p className="text-xl font-semibold text-[var(--neutral-900)] tabular-nums">
                {activeRun.sourcesFetched}
              </p>
            </div>
            <div className="p-3 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)]">
              <p className="text-xs text-[var(--neutral-600)]">Subtopics covered</p>
              <p className="text-xl font-semibold text-[var(--neutral-900)] tabular-nums">
                {activeRun.subtopicsCovered}
                {activeRun.totalSubtopics > 0 ? ` / ${activeRun.totalSubtopics}` : ""}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {primaryReport ? (
        <div className="space-y-4">
          <FormAlert tone={VERDICT_META[primaryReport.verdict].tone} label={null}>
            <span className="font-semibold">{VERDICT_META[primaryReport.verdict].title}</span>{" "}
            {countLabel(
              primaryReport.coverage.credibleRelevantSources ?? primaryReport.coverage.sourcesFound,
              "credible source",
              "credible sources"
            )}{" "}
            found, covering{" "}
            {countLabel(
              primaryReport.coverage.subtopicsCovered,
              "part of your topic",
              "parts of your topic"
            )}
            {primaryReport.isMocked ? " (preview mode)" : ""}.
          </FormAlert>

          {primaryDataNotice ? <FormAlert tone="warning">{primaryDataNotice}</FormAlert> : null}

          <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-3">
            <p className="text-sm font-semibold text-[var(--neutral-900)]">What we found</p>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-[var(--neutral-700)]">
              {primaryReport.reasons.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </div>

          {subtopicBreakdown.length > 0 ? (
            <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-3">
              <p className="text-sm font-semibold text-[var(--neutral-900)]">
                Sources for each part of your topic
              </p>
              <ul className="divide-y divide-[var(--neutral-200)] list-none p-0">
                {subtopicBreakdown.map((item) => (
                  <li
                    key={item.subtopic}
                    className="py-2.5 flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-[var(--neutral-800)]">{item.subtopic}</span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-[var(--radius-sm)] tabular-nums ${
                        item.covered
                          ? "bg-[var(--success-bg)] text-[var(--success-text)]"
                          : "bg-[var(--warning-bg)] text-[var(--warning-text)]"
                      }`}
                    >
                      {item.covered ? `Covered (${item.credibleSources})` : "No sources yet (0)"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {suggestedRefinements.length > 0 ? (
            <div className="bg-[var(--neutral-50)] border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-2">
              <p className="text-sm font-semibold text-[var(--neutral-900)]">
                Ways to narrow your topic
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-sm text-[var(--neutral-700)]">
                {suggestedRefinements.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {wizard.project.type === "assignment" && wizard.questions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[var(--neutral-900)]">
                Per-question verdicts ({wizard.questions.length})
              </p>
              <ul className="space-y-2 list-none p-0">
                {wizard.questions.map((q) => {
                  const rep = reports.find((r) => r.questionId === q.id) ?? primaryReport;
                  return (
                    <li
                      key={q.id}
                      className="p-4 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <span className="text-sm text-[var(--neutral-800)]">
                        <strong className="tabular-nums mr-1.5">Q{q.orderIndex}.</strong>
                        {q.text}
                      </span>
                      <span className="text-xs font-medium px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--neutral-100)] text-[var(--neutral-800)] w-fit">
                        {VERDICT_META[rep.verdict].badge}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {allowDevPreview ? (
        <details className="border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-4 bg-white">
          <summary className="text-sm font-medium text-[var(--neutral-700)] cursor-pointer">
            Local dev verdict preview (offline test helper)
          </summary>
          <div className="pt-4 space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="mock-verdict"
                className="block text-sm font-medium text-[var(--neutral-800)]"
              >
                Simulate verdict outcome
              </label>
              <CustomSelect<FeasibilityVerdict>
                id="mock-verdict"
                ariaLabel="Simulate verdict outcome"
                value={simulateVerdict}
                onChange={setSimulateVerdict}
                className="sm:max-w-[340px]"
                options={[
                  { value: "feasible", label: "Feasible (sufficient evidence)" },
                  { value: "needs_refinement", label: "Needs refinement (too broad/narrow)" },
                  { value: "not_feasible", label: "Not feasible (cannot guess)" },
                ]}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              loading={saving}
              loadingLabel="Saving verdict preview..."
              onClick={() => onSave({ step: 3, simulateVerdict })}
            >
              Save offline preview verdict
            </Button>
          </div>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onBackToTopic}>
          Edit topic
        </Button>

        {canProceed ? (
          <Button type="button" onClick={onContinueToLength}>
            Continue to page length
          </Button>
        ) : (
          <p className="text-sm text-[var(--neutral-600)]">
            {primaryReport
              ? "Edit your topic and run the check again. You can continue once enough sources are found."
              : "Start the check to see whether your topic has enough sources. You can continue once it does."}
          </p>
        )}
      </div>

      <InsufficientCreditsModal details={creditsModal} onClose={() => setCreditsModal(null)} />
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
    "Based on what you are writing and how long it usually runs.";

  const toast = useToast();
  const [pagesInput, setPagesInput] = useState(String(wizard.project.targetPages ?? recommended));

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = Number(pagesInput);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 300) {
      toast.error("Enter a whole page count between 1 and 300.", "Invalid page count");
      return;
    }
    await onSave({ step: 4, targetPages: parsed });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-medium">Recommended page length</h2>
        <p className="text-sm text-[var(--neutral-600)]">
          Keep our recommended length or enter your department&apos;s required page count. We count
          the pages in the finished PDF.
        </p>
      </div>

      <div className="p-5 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--accent-100)] space-y-2">
        <p className="text-xs font-semibold text-[var(--accent-600)]">Ideal recommendation</p>
        <p
          className="text-3xl font-medium text-[var(--neutral-900)] tabular-nums"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {recommended} pages
        </p>
        <p className="text-sm text-[var(--neutral-700)]">{reason}</p>
      </div>

      <div className="max-w-[260px]">
        <FormField
          id="target-pages"
          label="Your target page count"
          type="number"
          min={1}
          max={300}
          required
          value={pagesInput}
          onChange={(e) => setPagesInput(e.target.value)}
          helpText="Enter a number from 1 to 300."
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" loading={saving} loadingLabel="Saving length...">
          {wizard.project.type === "assignment"
            ? "Continue to citations"
            : (wizard.settings?.useChapters ?? true)
              ? "Continue to chapters"
              : "Continue to sections"}
        </Button>
      </div>
    </form>
  );
}
