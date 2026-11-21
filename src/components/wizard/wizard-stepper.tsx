"use client";

import type { ProjectType } from "@/db/schema";

export interface StepMeta {
  number: number;
  label: string;
}

export function getStepsForType(type: ProjectType): StepMeta[] {
  const all: StepMeta[] = [
    { number: 2, label: type === "assignment" ? "Questions" : "Topic" },
    { number: 3, label: "Source check" },
    { number: 4, label: "Length" },
    { number: 5, label: "Chapters" },
    { number: 6, label: "Citations" },
    { number: 7, label: "Formatting" },
    { number: 8, label: "Outline" },
  ];
  return type === "assignment" ? all.filter((s) => s.number !== 5) : all;
}

export function WizardStepper({
  projectType,
  currentStep,
  maxReachedStep,
  onSelectStep,
}: {
  projectType: ProjectType;
  currentStep: number;
  maxReachedStep: number;
  onSelectStep: (stepNum: number) => void;
}) {
  const steps = getStepsForType(projectType);
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.number === currentStep)
  );

  return (
    <nav aria-label="Setup steps" className="space-y-3">
      <div className="flex items-center justify-between text-sm text-[var(--neutral-600)]">
        <span className="tabular-nums font-medium text-[var(--neutral-800)]">
          Step {currentIndex + 1} of {steps.length}
        </span>
        <span>{steps[currentIndex]?.label}</span>
      </div>

      <ol className="flex flex-wrap gap-2 list-none p-0 m-0">
        {steps.map((s, idx) => {
          const isCurrent = s.number === currentStep;
          const isClickable = s.number <= maxReachedStep;
          return (
            <li key={s.number}>
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => onSelectStep(s.number)}
                aria-current={isCurrent ? "step" : undefined}
                className={`min-h-[38px] px-3 py-1.5 text-xs sm:text-sm font-medium rounded-[var(--radius-sm)] border transition-colors duration-150 ${
                  isCurrent
                    ? "bg-[var(--accent-600)] text-white border-[var(--accent-600)]"
                    : isClickable
                      ? "bg-white text-[var(--neutral-800)] border-[var(--neutral-300)] hover:bg-[var(--neutral-100)] cursor-pointer"
                      : "bg-[var(--neutral-100)] text-[var(--neutral-400)] border-[var(--neutral-200)] cursor-not-allowed"
                }`}
              >
                <span className="tabular-nums mr-1.5">{idx + 1}.</span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
