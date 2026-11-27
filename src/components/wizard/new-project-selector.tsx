"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ProjectType } from "@/db/schema";
import { defaultUseChaptersForType } from "@/lib/outline/structures";

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
      "Final-year undergraduate or practical project with structured chapters, citations, and optional system sections.",
  },
  {
    type: "research",
    title: "Research paper",
    typicalPages: "15–40 pages",
    description:
      "Focused academic paper formatted as numbered sections or formal chapters, backed by verified references.",
  },
  {
    type: "thesis",
    title: "Thesis",
    typicalPages: "50–300 pages",
    description:
      "Bachelor's, master's, or doctoral dissertation with full front matter, structured chapters or sections, and memory.",
  },
  {
    type: "assignment",
    title: "Assignment",
    typicalPages: "2–6 pages per question",
    description:
      "One or several separate assignment questions, each checked for source coverage individually.",
  },
];

const STRUCTURE_HELP: Record<Exclude<ProjectType, "assignment">, string> = {
  research:
    "Standard academic research papers normally use numbered sections (1. Introduction, 2. ..., Conclusion) without chapters. Choose chapters if your department requires a chaptered paper.",
  project:
    "Final-year projects normally use formal chapters (Chapter 1 to Chapter 5). Switch to numbered sections only if your department expects a continuous report.",
  thesis:
    "University theses typically use formal chapters. Switch to numbered sections if your department uses a continuous paper-style thesis.",
};

export function NewProjectSelector() {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<ProjectType>("project");
  const [useChapters, setUseChapters] = useState<boolean>(defaultUseChaptersForType("project"));
  const [submitting, setSubmitting] = useState(false);

  function handleSelectType(nextType: ProjectType) {
    setSelected(nextType);
    setUseChapters(defaultUseChaptersForType(nextType));
  }

  async function handleStart() {
    setSubmitting(true);
    try {
      const payload: { type: ProjectType; useChapters?: boolean } = {
        type: selected,
        ...(selected !== "assignment" ? { useChapters } : {}),
      };
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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
              onClick={() => handleSelectType(item.type)}
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

      {selected !== "assignment" ? (
        <fieldset className="rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-[var(--neutral-50)]/70 p-4 sm:p-5 space-y-3.5">
          <legend className="sr-only">Document structure</legend>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[var(--neutral-900)]">
              Should this{" "}
              {selected === "research"
                ? "research paper"
                : selected === "thesis"
                  ? "thesis"
                  : "project"}{" "}
              have chapters?
            </p>
            <p className="text-xs text-[var(--neutral-600)] leading-relaxed">
              {STRUCTURE_HELP[selected]}
            </p>
          </div>

          <div
            role="radiogroup"
            aria-label="Document structure"
            className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
          >
            <button
              type="button"
              role="radio"
              aria-checked={useChapters}
              onClick={() => setUseChapters(true)}
              className={`text-left px-3.5 py-3 rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
                useChapters
                  ? "border-[var(--accent-600)] bg-white ring-1 ring-[var(--accent-600)]/20"
                  : "border-[var(--neutral-200)] bg-white hover:border-[var(--neutral-300)]"
              }`}
            >
              <p className="text-sm font-medium text-[var(--neutral-900)]">
                Yes, organize into chapters
                {defaultUseChaptersForType(selected) ? " (default)" : ""}
              </p>
              <p className="text-xs text-[var(--neutral-500)] mt-0.5">
                Chapter 1, Chapter 2, and so on with chapter breaks and tailored subheadings
              </p>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={!useChapters}
              onClick={() => setUseChapters(false)}
              className={`text-left px-3.5 py-3 rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
                !useChapters
                  ? "border-[var(--accent-600)] bg-white ring-1 ring-[var(--accent-600)]/20"
                  : "border-[var(--neutral-200)] bg-white hover:border-[var(--neutral-300)]"
              }`}
            >
              <p className="text-sm font-medium text-[var(--neutral-900)]">
                No chapters, use numbered sections
                {!defaultUseChaptersForType(selected) ? " (default)" : ""}
              </p>
              <p className="text-xs text-[var(--neutral-500)] mt-0.5">
                Continuous academic paper format (1. Introduction, 2. ..., Conclusion), drafted
                section by section
              </p>
            </button>
          </div>
        </fieldset>
      ) : null}

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
