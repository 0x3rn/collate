"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { FormField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import type { ExperimentalDataMode } from "@/db/schema";
import type { SerializedWizardState } from "@/lib/wizard/http-handlers";
import { ACADEMIC_LEVELS } from "@/lib/wizard/schema";

const LEVEL_OPTIONS = [
  { value: "", label: "Select level" },
  ...ACADEMIC_LEVELS.map((lvl) => ({ value: lvl, label: lvl })),
];

export function StepTopicForm({
  wizard,
  saving,
  onSave,
}: {
  wizard: SerializedWizardState;
  saving: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const toast = useToast();
  const isAssignment = wizard.project.type === "assignment";
  const initialTitle = wizard.project.title.startsWith("Untitled ") ? "" : wizard.project.title;

  const [title, setTitle] = useState(initialTitle);
  const [field, setField] = useState(wizard.project.field ?? "");
  const [level, setLevel] = useState(wizard.project.level ?? "");
  const [institution, setInstitution] = useState(wizard.project.institution ?? "");
  const [supervisorNotes, setSupervisorNotes] = useState(wizard.project.supervisorNotes ?? "");
  const [isExperimental, setIsExperimental] = useState<boolean>(wizard.settings.isExperimental);
  const [experimentalDataMode, setExperimentalDataMode] = useState<ExperimentalDataMode>(
    wizard.settings.experimentalDataMode
  );
  const [questionList, setQuestionList] = useState<string[]>(
    wizard.questions.length > 0 ? wizard.questions.map((q) => q.text) : [""]
  );

  function updateQuestion(index: number, value: string) {
    setQuestionList((prev) => prev.map((q, idx) => (idx === index ? value : q)));
  }

  function addQuestion() {
    if (questionList.length >= 20) return;
    setQuestionList((prev) => [...prev, ""]);
  }

  function removeQuestion(index: number) {
    if (questionList.length <= 1) return;
    setQuestionList((prev) => prev.filter((_, idx) => idx !== index));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (title.trim().length < 5) {
      toast.error(
        isAssignment
          ? "Enter an assignment title (at least 5 characters)."
          : "Enter a clear topic title (at least 5 characters).",
        "Check your title"
      );
      return;
    }

    if (isAssignment) {
      const cleaned = questionList.map((q) => q.trim());
      if (cleaned.some((q) => q.length < 5)) {
        toast.error(
          "Every assignment question must be at least 5 characters (or remove empty rows).",
          "Check your questions"
        );
        return;
      }
      await onSave({
        step: 2,
        title: title.trim(),
        field: field.trim(),
        level: level.trim(),
        institution: institution.trim(),
        supervisorNotes: supervisorNotes.trim(),
        questions: cleaned,
      });
      return;
    }

    await onSave({
      step: 2,
      title: title.trim(),
      field: field.trim(),
      level: level.trim(),
      institution: institution.trim(),
      supervisorNotes: supervisorNotes.trim(),
      isExperimental,
      experimentalDataMode: isExperimental ? experimentalDataMode : "user_provided",
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-medium">
          {isAssignment ? "Assignment questions" : "Define your topic"}
        </h2>
        <p className="text-sm text-[var(--neutral-600)]">
          {isAssignment
            ? "Add each question you need to answer. Each question will get its own source check."
            : "Give your working title and optional academic context so the source check targets the right literature."}
        </p>
      </div>

      <FormField
        id="wizard-title"
        label={isAssignment ? "Assignment title or course name" : "Working topic"}
        type="text"
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={
          isAssignment
            ? "e.g. Public Economics Seminar Assignment 2"
            : "e.g. Impact of solar microgrids on rural clinic uptime in Northern Nigeria"
        }
      />

      {isAssignment ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-[var(--neutral-800)] m-0">
              Questions ({questionList.length})
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={addQuestion}
              disabled={questionList.length >= 20}
            >
              Add another question
            </Button>
          </div>

          <div className="space-y-3">
            {questionList.map((q, idx) => (
              <div
                key={idx}
                className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={`assignment-q-${idx}`}
                    className="text-sm font-medium text-[var(--neutral-800)] tabular-nums"
                  >
                    Question {idx + 1}
                  </label>
                  {questionList.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeQuestion(idx)}
                      className="text-xs font-medium text-[var(--error-text)] hover:underline cursor-pointer min-h-[32px] px-2"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <textarea
                  id={`assignment-q-${idx}`}
                  rows={3}
                  value={q}
                  onChange={(e) => updateQuestion(idx, e.target.value)}
                  placeholder="Enter the exact assignment question..."
                  className="block w-full px-3.5 py-2.5 text-base bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] focus:border-[var(--accent-600)]"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          id="wizard-field"
          label="Field of study (optional)"
          type="text"
          value={field}
          onChange={(e) => setField(e.target.value)}
          placeholder="e.g. Renewable Energy, Public Health"
        />

        <div className="space-y-1.5">
          <label
            htmlFor="wizard-level"
            className="block text-sm font-medium text-[var(--neutral-800)]"
          >
            Academic level (optional)
          </label>
          <CustomSelect
            id="wizard-level"
            ariaLabel="Academic level"
            value={level}
            onChange={setLevel}
            placeholder="Select level"
            options={LEVEL_OPTIONS}
          />
        </div>
      </div>

      <FormField
        id="wizard-institution"
        label="Institution (optional)"
        type="text"
        value={institution}
        onChange={(e) => setInstitution(e.target.value)}
        placeholder="e.g. University of Lagos"
      />

      {!isAssignment ? (
        <fieldset className="rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)]/70 p-4 sm:p-5 space-y-4">
          <legend className="sr-only">Experimental or empirical study settings</legend>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[var(--neutral-900)] m-0">
              Does this study involve an experiment or empirical data?
            </p>
            <p className="text-xs text-[var(--neutral-600)] leading-relaxed m-0">
              Tell Collate if your topic includes lab assays, animal or clinical trials, field
              measurements, or survey datasets that require numerical results.
            </p>
          </div>

          <div
            role="radiogroup"
            aria-label="Experimental or empirical study"
            className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!isExperimental}
              onClick={() => setIsExperimental(false)}
              className={`text-left px-3.5 py-3 rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
                !isExperimental
                  ? "border-[var(--accent-600)] bg-white ring-1 ring-[var(--accent-600)]/20"
                  : "border-[var(--neutral-200)] bg-white hover:border-[var(--neutral-300)]"
              }`}
            >
              <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
                No, standard / literature study
              </p>
              <p className="text-xs text-[var(--neutral-500)] mt-0.5 m-0">
                No primary lab or experimental values needed
              </p>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={isExperimental}
              onClick={() => setIsExperimental(true)}
              className={`text-left px-3.5 py-3 rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
                isExperimental
                  ? "border-[var(--accent-600)] bg-white ring-1 ring-[var(--accent-600)]/20"
                  : "border-[var(--neutral-200)] bg-white hover:border-[var(--neutral-300)]"
              }`}
            >
              <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
                Yes, experimental / empirical study
              </p>
              <p className="text-xs text-[var(--neutral-500)] mt-0.5 m-0">
                Includes lab assays, trials, or numerical findings
              </p>
            </button>
          </div>

          {isExperimental ? (
            <div className="pt-3 border-t border-[var(--neutral-200)] space-y-2.5">
              <p className="text-xs font-semibold text-[var(--neutral-800)] m-0">
                How should experimental results and figures be handled?
              </p>
              <div
                role="radiogroup"
                aria-label="Experimental data handling"
                className="flex flex-col gap-2"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={experimentalDataMode === "user_provided"}
                  onClick={() => setExperimentalDataMode("user_provided")}
                  className={`text-left p-3.5 rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
                    experimentalDataMode === "user_provided"
                      ? "border-[var(--accent-600)] bg-[var(--accent-100)]/45"
                      : "border-[var(--neutral-200)] bg-white hover:border-[var(--neutral-300)]"
                  }`}
                >
                  <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
                    I will provide my own lab or survey data
                  </p>
                  <p className="text-xs text-[var(--neutral-600)] mt-1 leading-relaxed m-0">
                    Upload your CSV file on the project page before starting Results so Collate
                    calculates your tables directly from your real readings.
                  </p>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={experimentalDataMode === "published_benchmarks"}
                  onClick={() => setExperimentalDataMode("published_benchmarks")}
                  className={`text-left p-3.5 rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
                    experimentalDataMode === "published_benchmarks"
                      ? "border-[var(--accent-600)] bg-[var(--accent-100)]/45"
                      : "border-[var(--neutral-200)] bg-white hover:border-[var(--neutral-300)]"
                  }`}
                >
                  <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
                    Gather published benchmark data from similar studies
                  </p>
                  <p className="text-xs text-[var(--neutral-600)] mt-1 leading-relaxed m-0">
                    Collate gathers verified published experimental studies, extracts accepted
                    physiological or empirical value ranges, and builds range-grounded comparative
                    tables strictly within those cited bounds.
                  </p>
                </button>
              </div>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <div className="space-y-1.5">
        <label
          htmlFor="wizard-notes"
          className="block text-sm font-medium text-[var(--neutral-800)]"
        >
          Supervisor notes or instructions (optional)
        </label>
        <textarea
          id="wizard-notes"
          rows={3}
          value={supervisorNotes}
          onChange={(e) => setSupervisorNotes(e.target.value)}
          placeholder="Any specific focus, methodology constraint, or department guidance..."
          className="block w-full px-3.5 py-2.5 text-base bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] focus:border-[var(--accent-600)]"
        />
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" loading={saving} loadingLabel="Saving topic...">
          Save and check sources
        </Button>
      </div>
    </form>
  );
}
