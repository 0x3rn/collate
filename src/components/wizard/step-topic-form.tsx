"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import type { SerializedWizardState } from "@/lib/wizard/http-handlers";
import { ACADEMIC_LEVELS } from "@/lib/wizard/schema";

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
          <select
            id="wizard-level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="block w-full min-h-[44px] px-3.5 py-2.5 text-base bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] focus:border-[var(--accent-600)]"
          >
            <option value="">Select level</option>
            {ACADEMIC_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}
              </option>
            ))}
          </select>
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
