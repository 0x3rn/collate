"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRightIcon } from "@/components/layout/workspace-icons";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ProjectType } from "@/db/schema";

const WORKBENCH_TYPES: Array<{
  type: ProjectType;
  label: string;
  pageHint: string;
  placeholder: string;
}> = [
  {
    type: "project",
    label: "Project",
    pageHint: "40–70 pages",
    placeholder: "e.g. Solar microgrid reliability in rural clinics",
  },
  {
    type: "research",
    label: "Research paper",
    pageHint: "15–40 pages",
    placeholder: "e.g. Mobile money and smallholder farm incomes",
  },
  {
    type: "thesis",
    label: "Thesis",
    pageHint: "50–300 pages",
    placeholder: "e.g. Urban flood resilience in coastal cities",
  },
  {
    type: "assignment",
    label: "Assignment",
    pageHint: "2–6 pages / question",
    placeholder: "e.g. Inflation and exchange rate policy seminar",
  },
];

export function QuickStartWorkbench() {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<ProjectType>("project");
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSpec =
    WORKBENCH_TYPES.find((item) => item.type === selectedType) ?? WORKBENCH_TYPES[0]!;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const payload: { type: ProjectType; title?: string } = { type: selectedType };
      const cleanedTopic = topic.trim();
      if (cleanedTopic.length > 0) {
        payload.title = cleanedTopic;
      }

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
        setError(data.error ?? "Could not start your project right now. Please try again.");
        setSubmitting(false);
        return;
      }

      router.push(`/projects/${data.wizard.project.id}/setup`);
      router.refresh();
    } catch {
      setError("Could not connect right now. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-label="Quick start a new project"
      className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] shadow-[var(--shadow-subtle)] overflow-hidden"
    >
      {/* Top segmented work-type bar */}
      <div className="px-4 sm:px-6 py-3 bg-[var(--neutral-50)] border-b border-[var(--neutral-200)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div
          role="radiogroup"
          aria-label="Choose work type"
          className="grid grid-cols-2 sm:inline-flex items-center gap-1 p-0.5 rounded-[var(--radius-sm)] bg-[var(--neutral-100)] border border-[var(--neutral-200)]"
        >
          {WORKBENCH_TYPES.map((item) => {
            const active = item.type === selectedType;
            return (
              <button
                key={item.type}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setSelectedType(item.type);
                  setError(null);
                }}
                className={`min-h-[34px] px-3 py-1 rounded-[5px] text-xs font-medium text-center transition-all duration-150 cursor-pointer ${
                  active
                    ? "bg-white text-[var(--neutral-900)] font-semibold shadow-[var(--shadow-subtle)]"
                    : "text-[var(--neutral-600)] hover:text-[var(--neutral-900)]"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <span className="text-xs text-[var(--neutral-500)] tabular-nums">
          Typical length:{" "}
          <strong className="font-medium text-[var(--neutral-700)]">{activeSpec.pageHint}</strong>
        </span>
      </div>

      {/* Focused Hunter-style command input */}
      <form onSubmit={handleSubmit} className="p-5 sm:p-7 space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-[1.375rem] font-medium text-[var(--neutral-900)]">
            Start a new {activeSpec.label.toLowerCase()}
          </h2>
          <p className="text-sm text-[var(--neutral-600)]">
            Enter a working title to jump straight into setup, or leave it blank to refine it next.
          </p>
        </div>

        {error ? <FormAlert tone="error">{error}</FormAlert> : null}

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-1.5 rounded-[var(--radius-md)] border border-[var(--neutral-300)] bg-white focus-within:border-[var(--accent-600)] focus-within:ring-2 focus-within:ring-[var(--accent-100)] transition-all">
          <label htmlFor="workbench-topic-input" className="sr-only">
            Working title or topic
          </label>
          <input
            id="workbench-topic-input"
            type="text"
            maxLength={300}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={activeSpec.placeholder}
            className="flex-1 min-h-[42px] px-3 py-2 rounded-[var(--radius-sm)] text-sm sm:text-[0.9375rem] text-[var(--neutral-900)] placeholder:text-[var(--neutral-400)] bg-transparent border-0 outline-none focus:outline-none focus-visible:outline-none"
          />
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            loadingLabel="Creating draft..."
            className="shrink-0 sm:px-5"
          >
            <span>Start project</span>
            <ArrowRightIcon className="w-4 h-4" />
          </Button>
        </div>

        {/* Quiet editorial reassurance strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-[var(--neutral-500)]">
          <span>
            Sources are verified against scholarly indexes before any chapter drafting starts.
          </span>

          <Link
            href="/projects/new"
            className="text-xs font-medium text-[var(--accent-600)] hover:text-[var(--accent-700)] hover:underline underline-offset-4"
          >
            Compare work types
          </Link>
        </div>
      </form>
    </section>
  );
}
