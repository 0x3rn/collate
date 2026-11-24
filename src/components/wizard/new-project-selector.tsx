"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
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
  const toast = useToast();
  const [selected, setSelected] = useState<ProjectType>("project");
  const [submitting, setSubmitting] = useState(false);

  async function handleStart() {
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
        toast.error(
          data.error ?? "Could not start your project. Please try again.",
          "Could not start project"
        );
        return;
      }

      router.push(`/projects/${data.wizard.project.id}/setup`);
      router.refresh();
    } catch {
      toast.error(
        "Network error while creating your project draft. Try again.",
        "Connection error"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
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
              onClick={() => setSelected(item.type)}
              className={`text-left p-5 rounded-[var(--radius-md)] border transition-all duration-150 cursor-pointer min-h-[124px] ${
                isSelected
                  ? "border-[var(--accent-600)] ring-1 ring-[var(--accent-600)] bg-[var(--accent-100)]/45 shadow-[var(--shadow-subtle)]"
                  : "border-[var(--neutral-200)] bg-white hover:border-[var(--neutral-300)]"
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <span className="text-lg font-semibold text-[var(--neutral-900)] block leading-snug">
                    {item.title}
                  </span>
                  <span className="text-xs font-medium text-[var(--accent-600)] tabular-nums">
                    {item.typicalPages}
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className={`mt-1 w-4 h-4 rounded-full border grid place-items-center shrink-0 transition-colors ${
                    isSelected
                      ? "border-[var(--accent-600)] bg-[var(--accent-600)]"
                      : "border-[var(--neutral-300)] bg-white"
                  }`}
                >
                  {isSelected ? <span className="w-1.5 h-1.5 rounded-full bg-white" /> : null}
                </span>
              </div>
              <p className="text-sm text-[var(--neutral-600)] leading-relaxed">
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
