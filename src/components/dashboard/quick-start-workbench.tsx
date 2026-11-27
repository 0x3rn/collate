"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRightIcon } from "@/components/layout/workspace-icons";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ProjectType } from "@/db/schema";
import { defaultUseChaptersForType } from "@/lib/outline/structures";

const WORKBENCH_TYPES: Array<{
  type: ProjectType;
  label: string;
  pageHint: string;
  subtitle: string;
  inputLabel: string;
  placeholder: string;
  footerNote: string;
}> = [
  {
    type: "project",
    label: "Project",
    pageHint: "40–70 pages",
    subtitle:
      "Enter your project title to jump straight into setup, or leave it blank to refine it next.",
    inputLabel: "Project title",
    placeholder: "e.g. Solar microgrid reliability in rural clinics",
    footerNote: "Sources are verified against research indexes before any chapter drafting starts.",
  },
  {
    type: "research",
    label: "Research paper",
    pageHint: "15–40 pages",
    subtitle:
      "Enter your research paper title to jump straight into setup, or leave it blank to refine it next.",
    inputLabel: "Research paper title",
    placeholder: "e.g. Mobile money and smallholder farm incomes",
    footerNote: "Sources are verified against research indexes before any drafting starts.",
  },
  {
    type: "thesis",
    label: "Thesis",
    pageHint: "50–300 pages",
    subtitle:
      "Enter your thesis title to jump straight into setup, or leave it blank to refine it next.",
    inputLabel: "Thesis title",
    placeholder: "e.g. Urban flood resilience in coastal cities",
    footerNote: "Sources are verified against research indexes before any chapter drafting starts.",
  },
  {
    type: "assignment",
    label: "Assignment",
    pageHint: "2–6 pages / question",
    subtitle:
      "Enter your assignment or course title to begin, then add your questions on the next screen.",
    inputLabel: "Assignment or course title",
    placeholder: "e.g. Public Economics Seminar Assignment 2",
    footerNote: "Sources are verified for each question before any answer drafting starts.",
  },
];

export function QuickStartWorkbench({ initialType = "project" }: { initialType?: ProjectType }) {
  const router = useRouter();
  const toast = useToast();
  const [selectedType, setSelectedType] = useState<ProjectType>(initialType);
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const activeSpec =
    WORKBENCH_TYPES.find((item) => item.type === selectedType) ?? WORKBENCH_TYPES[0]!;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload: { type: ProjectType; title?: string; useChapters?: boolean } = {
        type: selectedType,
        ...(selectedType !== "assignment"
          ? { useChapters: defaultUseChaptersForType(selectedType) }
          : {}),
      };
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
        toast.error(
          data.error ??
            `Could not start your ${activeSpec.label.toLowerCase()} right now. Please try again.`,
          `Could not start ${activeSpec.label.toLowerCase()}`
        );
        setSubmitting(false);
        return;
      }

      router.push(`/projects/${data.wizard.project.id}/setup`);
      router.refresh();
    } catch {
      toast.error(
        "Could not connect right now. Check your connection and try again.",
        "Connection error"
      );
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
                onClick={() => setSelectedType(item.type)}
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
          <p className="text-sm text-[var(--neutral-600)]">{activeSpec.subtitle}</p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-1.5 rounded-[var(--radius-md)] border border-[var(--neutral-300)] bg-white focus-within:border-[var(--accent-600)] focus-within:ring-2 focus-within:ring-[var(--accent-100)] transition-all">
          <label htmlFor="workbench-topic-input" className="sr-only">
            {activeSpec.inputLabel}
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
            <span>{`Start ${activeSpec.label.toLowerCase()}`}</span>
            <ArrowRightIcon className="w-4 h-4" />
          </Button>
        </div>

        {/* Quiet editorial reassurance strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-[var(--neutral-500)]">
          <span>{activeSpec.footerNote}</span>

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
