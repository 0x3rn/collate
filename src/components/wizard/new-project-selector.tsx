"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ProjectType } from "@/db/schema";

const WORK_TYPES: Array<{
  type: ProjectType;
  title: string;
  typicalPages: string;
  description: string;
}> = [
  {
    type: "project",
    title: "Project",
    typicalPages: "40–70 pages",
    description:
      "Final-year undergraduate or practical project with chapters, citations, and optional system sections.",
  },
  {
    type: "research",
    title: "Research paper",
    typicalPages: "15–40 pages",
    description:
      "Focused scholarly study or report built from peer-reviewed sources and verified references.",
  },
  {
    type: "thesis",
    title: "Thesis",
    typicalPages: "50–300 pages",
    description:
      "Bachelor's, master's, or doctoral dissertation with full front matter, chapters, and project memory.",
  },
  {
    type: "assignment",
    title: "Assignment",
    typicalPages: "2–6 pages per question",
    description:
      "One or several separate assignment questions, each checked for source coverage individually.",
  },
];

export function NewProjectSelector() {
  const router = useRouter();
  const [selected, setSelected] = useState<ProjectType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    if (!selected) {
      setError("Select what you are working on before continuing.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: selected }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        wizard?: { project: { id: string } };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.wizard) {
        setError(data.error ?? "Could not start your project. Please try again.");
        return;
      }

      router.push(`/projects/${data.wizard.project.id}/setup`);
      router.refresh();
    } catch {
      setError("Network error while creating your project draft. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <div
        role="radiogroup"
        aria-label="Work type"
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        {WORK_TYPES.map((item) => {
          const isSelected = selected === item.type;
          return (
            <button
              key={item.type}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => {
                setSelected(item.type);
                setError(null);
              }}
              className={`text-left p-5 rounded-[var(--radius-md)] border transition-colors duration-150 cursor-pointer min-h-[120px] ${
                isSelected
                  ? "border-[var(--accent-600)] bg-[var(--accent-100)]"
                  : "border-[var(--neutral-200)] bg-white hover:border-[var(--neutral-400)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-lg font-semibold text-[var(--neutral-900)]">
                  {item.title}
                </span>
                <span className="text-xs font-medium text-[var(--neutral-600)] tabular-nums">
                  {item.typicalPages}
                </span>
              </div>
              <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
                {item.description}
              </p>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-end pt-2">
        <Button
          type="button"
          onClick={handleStart}
          loading={submitting}
          loadingLabel="Creating draft..."
        >
          Continue to topic
        </Button>
      </div>
    </div>
  );
}
