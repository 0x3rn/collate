"use client";

import { useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import type { FeasibilityVerdict } from "@/db/schema";
import type { SerializedWizardState } from "@/lib/wizard/http-handlers";

const VERDICT_META: Record<
  FeasibilityVerdict,
  { title: string; tone: "success" | "warning" | "error"; badge: string }
> = {
  feasible: {
    title: "Topic is feasible",
    tone: "success",
    badge: "Feasible",
  },
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
  const reports = wizard.feasibilityReports;
  const primaryReport = reports[0];

  async function runMockSweep() {
    await onSave({ step: 3, simulateVerdict });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-medium">Source sweep and feasibility check</h2>
        <p className="text-sm text-[var(--neutral-600)]">
          Before writing anything, Collate verifies whether enough credible sources exist to write
          without guessing.
        </p>
      </div>

      <FormAlert tone="info">
        Phase 2 preview: this screen runs a mocked feasibility sweep and saves the result to D1.
        Real scholarly and web search connects in Phases 3 and 4.
      </FormAlert>

      <div className="p-5 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="mock-verdict"
            className="block text-sm font-medium text-[var(--neutral-800)]"
          >
            Preview verdict outcome (Phase 2 test control)
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
          variant={primaryReport ? "secondary" : "primary"}
          loading={saving}
          loadingLabel="Running mock source sweep..."
          onClick={runMockSweep}
        >
          {primaryReport ? "Re-run mock source sweep" : "Run mock source sweep"}
        </Button>
      </div>

      {primaryReport ? (
        <div className="space-y-4">
          <FormAlert tone={VERDICT_META[primaryReport.verdict].tone}>
            <span className="font-semibold">{VERDICT_META[primaryReport.verdict].title}</span> —
            Evidence score {primaryReport.score}/100 ({primaryReport.coverage.sourcesFound} sources,{" "}
            {primaryReport.coverage.subtopicsCovered} subtopics covered).
          </FormAlert>

          <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-3">
            <p className="text-sm font-semibold text-[var(--neutral-900)] m-0">Reasons</p>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-[var(--neutral-700)] m-0">
              {primaryReport.reasons.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </div>

          {wizard.project.type === "assignment" && wizard.questions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[var(--neutral-900)]">
                Per-question verdicts ({wizard.questions.length})
              </p>
              <ul className="space-y-2 list-none p-0 m-0">
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

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onBackToTopic}>
              Edit topic
            </Button>

            {primaryReport.verdict === "feasible" ? (
              <Button type="button" onClick={onContinueToLength}>
                Continue to page length
              </Button>
            ) : (
              <p className="text-sm text-[var(--neutral-600)] m-0">
                Refine the topic or run a feasible preview to continue.
              </p>
            )}
          </div>
        </div>
      ) : null}
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
