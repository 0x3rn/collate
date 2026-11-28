"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  distributeWordsAcrossSections,
  validateConfirmedOutline,
  type ProjectOutlinePlan,
} from "@/lib/outline/planner";
import {
  formatUnitShortLabel,
  subUnitNounPlural,
  unitNounSingular,
} from "@/lib/outline/structures";
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
  const toast = useToast();
  const [outline, setOutline] = useState<ProjectOutlinePlan | null>(null);
  const [outlineLocked, setOutlineLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadOutline() {
      setLoading(true);
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
            toast.error(
              data.error ?? "Could not load your outline plan.",
              "Could not load outline"
            );
          } else {
            setOutline(data.outline);
            setOutlineLocked(Boolean(data.outlineLocked));
          }
        }
      } catch {
        if (!cancelled) {
          toast.error("Network error while loading your outline plan.", "Connection error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadOutline();
    return () => {
      cancelled = true;
    };
  }, [wizard.project.id, toast]);

  async function handleUnlock() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${wizard.project.id}/outline/unlock`, {
        method: "POST",
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? "We could not open the outline for editing.",
          "Could not edit outline"
        );
        return;
      }
      setOutlineLocked(false);
      toast.success(
        "You can now edit your outline before drafting resumes.",
        "Outline is editable again"
      );
    } catch {
      toast.error("Check your connection and try again.", "Connection error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegenerateForTopic() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/projects/${wizard.project.id}/outline/suggest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        ok: boolean;
        usedAi?: boolean;
        outline?: ProjectOutlinePlan;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.outline) {
        toast.error(data.error ?? "We could not update your outline.", "Could not update outline");
        return;
      }
      setOutline(data.outline);
      toast.success(
        data.usedAi
          ? "Updated your outline titles and subheadings specifically for your topic."
          : "Updated your outline to match your topic and study settings.",
        "Outline updated"
      );
    } catch {
      toast.error("Check your connection and try again.", "Connection error");
    } finally {
      setRegenerating(false);
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

    const check = validateConfirmedOutline(outline);
    if (!check.valid) {
      toast.error(
        check.errors[0] ?? "Please resolve outline issues before confirming.",
        "Check your outline"
      );
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
        toast.error(
          data.error ?? "Could not save your confirmed outline.",
          "Could not save outline"
        );
        return;
      }
      router.push(`/projects/${wizard.project.id}`);
      router.refresh();
    } catch {
      toast.error("Network error while saving your outline. Try again.", "Connection error");
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
        <p className="text-sm text-[var(--neutral-600)]">
          Your outline plan could not be loaded right now. Return to the previous step or try again
          shortly.
        </p>
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    );
  }

  const validation = validateConfirmedOutline(outline);
  const { project, settings } = wizard;
  const useChapters = outline.useChapters ?? settings.useChapters;
  const unitLower = unitNounSingular(useChapters, false);
  const subUnitsCap = subUnitNounPlural(useChapters, true);
  const subUnitsLower = subUnitNounPlural(useChapters, false);
  const enabledFrontMatter = Object.entries(settings.frontMatter)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key.replace(/([A-Z])/g, " $1").toLowerCase());

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl font-medium">Review, adjust, and confirm your outline</h2>
          <p className="text-sm text-[var(--neutral-600)]">
            Edit {unitLower} titles, page counts, and {subUnitsLower} before writing begins. Your
            pages must add up to within 2% of your {outline.targetPages}-page target.
          </p>
        </div>

        {!outlineLocked && outline.projectType !== "assignment" ? (
          <Button
            type="button"
            variant="secondary"
            disabled={submitting || regenerating}
            loading={regenerating}
            loadingLabel="Updating..."
            onClick={() => void handleRegenerateForTopic()}
            className="shrink-0 w-fit"
          >
            Update outline for this topic
          </Button>
        ) : null}
      </div>

      {outlineLocked ? (
        <FormAlert tone="warning">
          You can&apos;t change the outline after writing starts.{" "}
          <button
            type="button"
            onClick={handleUnlock}
            className="underline font-semibold cursor-pointer ml-1"
          >
            Edit outline anyway
          </button>
        </FormAlert>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)]">
          <p className="text-xs text-[var(--neutral-600)]">Format &amp; mode</p>
          <p className="text-base font-semibold text-[var(--neutral-900)]">
            {formatProjectType(project.type)}
          </p>
          {project.type !== "assignment" ? (
            <p className="text-xs text-[var(--neutral-600)] mt-0.5">
              {settings.isExperimental ? "Experimental / empirical" : "Pure literature"} ·{" "}
              {useChapters ? "Chapters" : "Numbered sections"}
            </p>
          ) : null}
        </div>
        <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)]">
          <p className="text-xs text-[var(--neutral-600)]">Pages per chapter</p>
          <p className="text-base font-semibold tabular-nums text-[var(--neutral-900)]">
            {validation.allocatedPages} / {outline.targetPages} pages
          </p>
        </div>
        <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)]">
          <p className="text-xs text-[var(--neutral-600)]">Words per page</p>
          <p className="text-base font-semibold tabular-nums text-[var(--neutral-900)]">
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
                <p className="text-sm font-semibold text-[var(--neutral-900)]">
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
              <p className="text-xs text-[var(--neutral-600)] tabular-nums">
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
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex-1 space-y-1">
                  <label
                    htmlFor={`out-title-${idx}`}
                    className="block text-xs font-medium text-[var(--neutral-500)]"
                  >
                    {ch.isAutoReferences
                      ? "Automatic reference list"
                      : `${formatUnitShortLabel(ch.number, useChapters)} · ${ch.chapterType.replaceAll("_", " ")}`}
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
                      Pages
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
                  <p className="text-xs font-semibold text-[var(--warning-text)]">
                    Custom {unitLower} confirmation required
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
                    Confirm this {unitLower} purpose
                  </label>
                </div>
              ) : (
                <p className="text-xs text-[var(--neutral-600)]">{ch.inferredPurpose}</p>
              )}

              {!ch.isAutoReferences ? (
                <div className="space-y-1.5">
                  <label
                    htmlFor={`out-sec-${idx}`}
                    className="block text-xs font-medium text-[var(--neutral-600)]"
                  >
                    {subUnitsCap} (one per line · ~{ch.wordBudget.toLocaleString()} total words)
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
            <p className="text-xs text-[var(--neutral-600)]">
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
