"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  distributeWordsAcrossSections,
  validateConfirmedOutline,
  type ProjectOutlinePlan,
} from "@/lib/outline/planner";
import { formatProjectType } from "@/lib/ui/formatters";
import type { SerializedWizardState } from "@/lib/wizard/http-handlers";

export function StepOutlineConfirm({
  wizard,
  onBack,
}: {
  wizard: SerializedWizardState;
  saving?: boolean;
  onConfirm?: () => Promise<void>;
  onBack: () => void;
}) {
  const router = useRouter();
  const [outline, setOutline] = useState<ProjectOutlinePlan | null>(null);
  const [outlineLocked, setOutlineLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadOutline() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${wizard.project.id}/outline`);
        const data = (await res.json()) as {
          ok: boolean;
          outline?: ProjectOutlinePlan;
          outlineLocked?: boolean;
          error?: string;
        };
        if (!cancelled) {
          if (!res.ok || !data.ok || !data.outline) {
            setError(data.error ?? "Could not load your outline plan.");
          } else {
            setOutline(data.outline);
            setOutlineLocked(Boolean(data.outlineLocked));
          }
        }
      } catch {
        if (!cancelled) setError("Network error while loading your outline plan.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadOutline();
    return () => {
      cancelled = true;
    };
  }, [wizard.project.id]);

  async function handleUnlock() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${wizard.project.id}/outline/unlock`, {
        method: "POST",
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not unlock outline.");
        return;
      }
      setOutlineLocked(false);
    } catch {
      setError("Network error while unlocking outline.");
    } finally {
      setSubmitting(false);
    }
  }

  function updateChapterField(
    index: number,
    patch: Partial<ProjectOutlinePlan["chapters"][number]>
  ) {
    setOutline((prev) => {
      if (!prev) return prev;
      const nextChapters = prev.chapters.map((ch, idx) => {
        if (idx !== index) return ch;
        const merged = { ...ch, ...patch };
        if (patch.pageBudget !== undefined && !merged.isAutoReferences) {
          merged.wordBudget = merged.pageBudget * prev.wordsPerPage;
          merged.sections = distributeWordsAcrossSections(
            merged.sections.map((s) => s.heading),
            merged.wordBudget
          );
        }
        return merged;
      });
      return { ...prev, chapters: nextChapters };
    });
  }

  function updateChapterSections(chapterIndex: number, headings: string[]) {
    setOutline((prev) => {
      if (!prev) return prev;
      const nextChapters = prev.chapters.map((ch, idx) => {
        if (idx !== chapterIndex) return ch;
        const cleanHeadings = headings.map((h) => h.trim()).filter(Boolean);
        return {
          ...ch,
          sections: distributeWordsAcrossSections(
            cleanHeadings.length > 0 ? cleanHeadings : ["Overview"],
            ch.wordBudget
          ),
        };
      });
      return { ...prev, chapters: nextChapters };
    });
  }

  function updateAssignmentPages(qIndex: number, pageBudget: number) {
    setOutline((prev) => {
      if (!prev) return prev;
      const safePages = Math.max(1, Math.min(100, pageBudget));
      const nextPlans = prev.assignmentPlans.map((q, idx) => {
        if (idx !== qIndex) return q;
        const wordBudget = safePages * prev.wordsPerPage;
        return {
          ...q,
          pageBudget: safePages,
          wordBudget,
          sections: distributeWordsAcrossSections(
            q.sections.map((s) => s.heading),
            wordBudget
          ),
        };
      });
      return { ...prev, assignmentPlans: nextPlans };
    });
  }

  async function handleConfirmAndSave() {
    if (!outline) return;
    setError(null);

    const check = validateConfirmedOutline(outline);
    if (!check.valid) {
      setError(check.errors[0] ?? "Please resolve outline issues before confirming.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${wizard.project.id}/outline`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(outline),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not save your confirmed outline.");
        return;
      }
      router.push(`/projects/${wizard.project.id}`);
      router.refresh();
    } catch {
      setError("Network error while saving your outline. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <FormAlert tone="info">Building your chapter and section plan...</FormAlert>;
  }

  if (!outline) {
    return (
      <div className="space-y-4">
        <FormAlert tone="error">{error ?? "Outline plan could not be loaded."}</FormAlert>
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    );
  }

  const validation = validateConfirmedOutline(outline);
  const { project, settings } = wizard;
  const enabledFrontMatter = Object.entries(settings.frontMatter)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key.replace(/([A-Z])/g, " $1").toLowerCase());

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-medium">Review, adjust, and confirm your outline</h2>
        <p className="text-sm text-[var(--neutral-600)]">
          Edit chapter titles, page budgets, and section headings before writing begins. Total
          allocated pages must stay within 2% of your target ({outline.targetPages} pages).
        </p>
      </div>

      {outlineLocked ? (
        <FormAlert tone="warning">
          This outline is locked because chapter drafting has started.{" "}
          <button
            type="button"
            onClick={handleUnlock}
            className="underline font-semibold cursor-pointer ml-1"
          >
            Revise outline (unlock)
          </button>
        </FormAlert>
      ) : null}

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)]">
          <p className="text-xs text-[var(--neutral-600)] m-0">Work type</p>
          <p className="text-base font-semibold text-[var(--neutral-900)] m-0">
            {formatProjectType(project.type)}
          </p>
        </div>
        <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)]">
          <p className="text-xs text-[var(--neutral-600)] m-0">Budget allocation</p>
          <p className="text-base font-semibold tabular-nums text-[var(--neutral-900)] m-0">
            {validation.allocatedPages} / {outline.targetPages} pages
          </p>
        </div>
        <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)]">
          <p className="text-xs text-[var(--neutral-600)] m-0">Layout density</p>
          <p className="text-base font-semibold tabular-nums text-[var(--neutral-900)] m-0">
            ~{outline.wordsPerPage} words/page
          </p>
        </div>
      </div>

      {!validation.valid ? <FormAlert tone="warning">{validation.errors[0]}</FormAlert> : null}

      {outline.projectType === "assignment" ? (
        <div className="space-y-4">
          {outline.assignmentPlans.map((q, idx) => (
            <div
              key={q.questionId}
              className="p-5 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--neutral-900)] m-0">
                  <span className="tabular-nums mr-1.5">Q{q.orderIndex}.</span>
                  {q.questionText}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <label htmlFor={`q-pages-${idx}`} className="text-xs text-[var(--neutral-600)]">
                    Pages
                  </label>
                  <input
                    id={`q-pages-${idx}`}
                    type="number"
                    min={1}
                    max={100}
                    disabled={outlineLocked}
                    value={q.pageBudget}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isInteger(v)) updateAssignmentPages(idx, v);
                    }}
                    className="w-20 min-h-[38px] px-2.5 py-1 text-sm bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)] tabular-nums"
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--neutral-600)] tabular-nums m-0">
                Answer structure:{" "}
                {q.sections.map((s) => `${s.heading} (~${s.wordBudget}w)`).join(" · ")}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {outline.chapters.map((ch, idx) => (
            <div
              key={ch.number}
              className="p-5 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1 space-y-1">
                  <label
                    htmlFor={`out-title-${idx}`}
                    className="text-xs font-medium text-[var(--neutral-500)]"
                  >
                    {ch.isAutoReferences
                      ? "Automatic chapter (CSL citation engine)"
                      : `Chapter ${ch.number} · ${ch.chapterType.replace("_", " ")}`}
                  </label>
                  <input
                    id={`out-title-${idx}`}
                    type="text"
                    disabled={outlineLocked || ch.isAutoReferences}
                    value={ch.title}
                    onChange={(e) => updateChapterField(idx, { title: e.target.value })}
                    className="block w-full min-h-[42px] px-3 py-2 text-base font-medium bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)] disabled:bg-[var(--neutral-50)]"
                  />
                </div>

                {!ch.isAutoReferences ? (
                  <div className="w-full sm:w-32 space-y-1">
                    <label
                      htmlFor={`out-pages-${idx}`}
                      className="block text-xs font-medium text-[var(--neutral-500)]"
                    >
                      Page budget
                    </label>
                    <input
                      id={`out-pages-${idx}`}
                      type="number"
                      min={1}
                      max={300}
                      disabled={outlineLocked}
                      value={ch.pageBudget}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isInteger(v) && v >= 1) {
                          updateChapterField(idx, { pageBudget: v });
                        }
                      }}
                      className="block w-full min-h-[42px] px-3 py-2 text-base tabular-nums bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
                    />
                  </div>
                ) : null}
              </div>

              {ch.needsConfirmation ? (
                <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-bg)] space-y-3">
                  <p className="text-xs font-semibold text-[var(--warning-text)] m-0">
                    Custom chapter confirmation required
                  </p>
                  <textarea
                    rows={2}
                    disabled={outlineLocked}
                    value={ch.inferredPurpose}
                    onChange={(e) => updateChapterField(idx, { inferredPurpose: e.target.value })}
                    className="block w-full px-3 py-2 text-sm bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
                  />
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--neutral-900)] cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={outlineLocked}
                      checked={ch.purposeConfirmed}
                      onChange={(e) =>
                        updateChapterField(idx, { purposeConfirmed: e.target.checked })
                      }
                      className="w-4 h-4 accent-[var(--accent-600)]"
                    />
                    Confirm this chapter purpose
                  </label>
                </div>
              ) : (
                <p className="text-xs text-[var(--neutral-600)] m-0">{ch.inferredPurpose}</p>
              )}

              {!ch.isAutoReferences ? (
                <div className="space-y-1.5">
                  <label
                    htmlFor={`out-sec-${idx}`}
                    className="block text-xs font-medium text-[var(--neutral-600)]"
                  >
                    Sections (one per line · ~{ch.wordBudget.toLocaleString()} total words)
                  </label>
                  <textarea
                    id={`out-sec-${idx}`}
                    rows={Math.max(3, Math.min(8, ch.sections.length))}
                    disabled={outlineLocked}
                    value={ch.sections.map((s) => s.heading).join("\n")}
                    onChange={(e) => updateChapterSections(idx, e.target.value.split("\n"))}
                    className="block w-full px-3 py-2 text-sm bg-[var(--neutral-50)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
                  />
                </div>
              ) : null}
            </div>
          ))}

          {enabledFrontMatter.length > 0 ? (
            <p className="text-xs text-[var(--neutral-600)] m-0">
              Included front/back matter: {enabledFrontMatter.join(", ")}.
            </p>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onBack}>
          Back to formatting
        </Button>
        <Button
          type="button"
          disabled={outlineLocked || !validation.valid}
          loading={submitting}
          loadingLabel="Saving confirmed outline..."
          onClick={handleConfirmAndSave}
        >
          Confirm outline and save to project memory
        </Button>
      </div>
    </div>
  );
}
