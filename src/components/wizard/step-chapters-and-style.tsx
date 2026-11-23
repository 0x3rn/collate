"use client";

import { useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import type { CitationInlineMode, CitationStyle, LineSpacing, SpellingVariant } from "@/db/schema";
import type { SerializedWizardState } from "@/lib/wizard/http-handlers";
import { ALLOWED_FONTS, type FrontMatterToggles } from "@/lib/wizard/schema";

const FRONT_MATTER_LABELS: Array<{ key: keyof FrontMatterToggles; label: string }> = [
  { key: "coverPage", label: "Cover / title page" },
  { key: "certification", label: "Certification / declaration" },
  { key: "dedication", label: "Dedication" },
  { key: "acknowledgements", label: "Acknowledgements" },
  { key: "preface", label: "Preface / foreword" },
  { key: "abstract", label: "Abstract" },
  { key: "tableOfContents", label: "Table of contents" },
  { key: "listOfFiguresAndTables", label: "List of figures and tables" },
  { key: "appendices", label: "Appendices" },
];

export function StepChaptersForm({
  wizard,
  saving,
  onSave,
  onBack,
}: {
  wizard: SerializedWizardState;
  saving: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onBack: () => void;
}) {
  const initialEditable = wizard.chapters
    .filter((ch) => !ch.isAutoReferences)
    .map((ch) => ({ number: ch.number, title: ch.title }));

  const [chapterRows, setChapterRows] = useState<Array<{ number: number; title: string }>>(
    initialEditable.length > 0
      ? initialEditable
      : [
          { number: 1, title: "Introduction" },
          { number: 2, title: "Literature Review" },
          { number: 3, title: "Methodology" },
          { number: 4, title: "Results and Findings" },
          { number: 5, title: "Conclusion and Recommendations" },
        ]
  );
  const [frontMatter, setFrontMatter] = useState<FrontMatterToggles>(wizard.settings.frontMatter);
  const [localError, setLocalError] = useState<string | null>(null);

  function handleChapterCountChange(nextCount: number) {
    const clamped = Math.max(1, Math.min(20, nextCount));
    setChapterRows((prev) => {
      if (clamped === prev.length) return prev;
      if (clamped < prev.length) return prev.slice(0, clamped);
      const copy = [...prev];
      for (let i = prev.length; i < clamped; i++) {
        copy.push({ number: i + 1, title: `Chapter ${i + 1}` });
      }
      return copy;
    });
  }

  function toggleFrontMatter(key: keyof FrontMatterToggles) {
    setFrontMatter((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);

    const seen = new Set<number>();
    for (const row of chapterRows) {
      if (seen.has(row.number)) {
        setLocalError(
          `Duplicate chapter number found: Chapter ${row.number}. Make every number unique.`
        );
        return;
      }
      if (row.title.trim().length < 2) {
        setLocalError(`Chapter ${row.number} needs a title.`);
        return;
      }
      seen.add(row.number);
    }

    await onSave({
      step: 5,
      chapters: chapterRows.map((r) => ({ number: r.number, title: r.title.trim() })),
      frontMatter,
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-medium">Chapters and front matter</h2>
        <p className="text-sm text-[var(--neutral-600)]">
          Choose how many chapters to include, name each one, and toggle front or back matter. The
          References chapter is always added automatically.
        </p>
      </div>

      {localError ? <FormAlert tone="error">{localError}</FormAlert> : null}

      <div className="max-w-[240px]">
        <FormField
          id="chapter-count"
          label="Number of chapters"
          type="number"
          min={1}
          max={20}
          value={String(chapterRows.length)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n)) handleChapterCountChange(n);
          }}
        />
      </div>

      <div className="space-y-3">
        {chapterRows.map((row, idx) => (
          <div
            key={idx}
            className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3.5 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)]"
          >
            <div className="sm:col-span-4">
              <label
                htmlFor={`ch-num-${idx}`}
                className="block text-xs font-medium text-[var(--neutral-600)] mb-1"
              >
                Chapter number
              </label>
              <select
                id={`ch-num-${idx}`}
                value={row.number}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setChapterRows((prev) =>
                    prev.map((item, i) => (i === idx ? { ...item, number: val } : item))
                  );
                }}
                className="block w-full min-h-[44px] px-3 py-2 text-base bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
              >
                {Array.from({ length: Math.max(20, chapterRows.length) }, (_, n) => n + 1).map(
                  (num) => (
                    <option key={num} value={num}>
                      Chapter {num}
                    </option>
                  )
                )}
              </select>
            </div>

            <div className="sm:col-span-8">
              <label
                htmlFor={`ch-title-${idx}`}
                className="block text-xs font-medium text-[var(--neutral-600)] mb-1"
              >
                Chapter title
              </label>
              <input
                id={`ch-title-${idx}`}
                type="text"
                value={row.title}
                onChange={(e) => {
                  const val = e.target.value;
                  setChapterRows((prev) =>
                    prev.map((item, i) => (i === idx ? { ...item, title: val } : item))
                  );
                }}
                placeholder="e.g. Literature Review"
                className="block w-full min-h-[44px] px-3.5 py-2 text-base bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
              />
            </div>
          </div>
        ))}

        <div className="p-3.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--neutral-300)] bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-[var(--neutral-900)] m-0">References</p>
            <p className="text-xs text-[var(--neutral-600)] m-0">
              Added automatically and formatted from verified source metadata by the citation
              engine.
            </p>
          </div>
          <span className="text-xs font-medium px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--neutral-100)] text-[var(--neutral-700)] w-fit">
            Automatic
          </span>
        </div>
      </div>

      <fieldset className="border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-3">
        <legend className="text-sm font-semibold text-[var(--neutral-900)] px-1">
          Front matter and back matter
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {FRONT_MATTER_LABELS.map((item) => (
            <label
              key={item.key}
              className="flex items-center gap-2.5 min-h-[44px] px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] cursor-pointer text-sm text-[var(--neutral-800)]"
            >
              <input
                type="checkbox"
                checked={frontMatter[item.key]}
                onChange={() => toggleFrontMatter(item.key)}
                className="w-4 h-4 accent-[var(--accent-600)]"
              />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" loading={saving} loadingLabel="Saving chapters...">
          Continue to citations
        </Button>
      </div>
    </form>
  );
}

const CITATION_OPTIONS: Array<{ value: CitationStyle; label: string; example: string }> = [
  { value: "apa7", label: "APA 7th edition", example: "(Okonkwo, 2024)" },
  { value: "harvard", label: "Harvard", example: "(Okonkwo 2024, p. 14)" },
  { value: "mla9", label: "MLA 9th edition", example: "(Okonkwo 14)" },
  { value: "chicago", label: "Chicago", example: "(Okonkwo 2024, 14)" },
  { value: "ieee", label: "IEEE (numeric)", example: "[1]" },
  { value: "vancouver", label: "Vancouver (numeric)", example: "(1)" },
];

export function StepCitationsForm({
  wizard,
  saving,
  onSave,
  onBack,
}: {
  wizard: SerializedWizardState;
  saving: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onBack: () => void;
}) {
  const [citationStyle, setCitationStyle] = useState<CitationStyle>(wizard.settings.citationStyle);
  const [inlineMode, setInlineMode] = useState<CitationInlineMode>(wizard.settings.inlineMode);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await onSave({ step: 6, citationStyle, inlineMode });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-medium">Citation style</h2>
        <p className="text-sm text-[var(--neutral-600)]">
          All references are formatted by Collate&apos;s citation engine from verified metadata.
        </p>
      </div>

      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        role="radiogroup"
        aria-label="Citation style"
      >
        {CITATION_OPTIONS.map((opt) => {
          const active = citationStyle === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setCitationStyle(opt.value)}
              className={`text-left p-4 rounded-[var(--radius-sm)] border cursor-pointer min-h-[82px] ${
                active
                  ? "border-[var(--accent-600)] bg-[var(--accent-100)]"
                  : "border-[var(--neutral-200)] bg-white hover:border-[var(--neutral-400)]"
              }`}
            >
              <p className="text-sm font-semibold text-[var(--neutral-900)] m-0">{opt.label}</p>
              <p className="text-xs text-[var(--neutral-600)] mt-1">{opt.example}</p>
            </button>
          );
        })}
      </div>

      <fieldset className="space-y-2.5 border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5">
        <legend className="text-sm font-semibold text-[var(--neutral-900)] px-1">
          Citation placement
        </legend>
        <label className="flex items-start gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)] cursor-pointer">
          <input
            type="radio"
            name="inlineMode"
            checked={inlineMode === "inline_and_list"}
            onChange={() => setInlineMode("inline_and_list")}
            className="mt-1 accent-[var(--accent-600)]"
          />
          <div>
            <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
              Inline citations and reference list (recommended)
            </p>
            <p className="text-xs text-[var(--neutral-600)] m-0">
              Includes in-text citations on every supported claim plus the matching reference list.
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)] cursor-pointer">
          <input
            type="radio"
            name="inlineMode"
            checked={inlineMode === "list_only"}
            onChange={() => setInlineMode("list_only")}
            className="mt-1 accent-[var(--accent-600)]"
          />
          <div>
            <p className="text-sm font-medium text-[var(--neutral-900)] m-0">Reference list only</p>
            <p className="text-xs text-[var(--neutral-600)] m-0">
              Claims are still verified against sources internally, with citations listed at the
              end.
            </p>
          </div>
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" loading={saving} loadingLabel="Saving citations...">
          Continue to formatting
        </Button>
      </div>
    </form>
  );
}

export function StepFormattingForm({
  wizard,
  saving,
  onSave,
  onBack,
}: {
  wizard: SerializedWizardState;
  saving: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onBack: () => void;
}) {
  const [font, setFont] = useState(wizard.settings.font);
  const [fontSizePt, setFontSizePt] = useState(wizard.settings.fontSizePt);
  const [lineSpacing, setLineSpacing] = useState<LineSpacing>(wizard.settings.lineSpacing);
  const [marginsMm, setMarginsMm] = useState(wizard.settings.marginsMm);
  const [pageNumbering, setPageNumbering] = useState(wizard.settings.pageNumbering);
  const [spelling, setSpelling] = useState<SpellingVariant>(wizard.settings.spelling);
  const [authorName, setAuthorName] = useState(wizard.settings.cover.authorName);
  const [institution, setInstitution] = useState(
    wizard.settings.cover.institution || wizard.project.institution || ""
  );
  const [department, setDepartment] = useState(wizard.settings.cover.department);
  const [supervisor, setSupervisor] = useState(wizard.settings.cover.supervisor);
  const [submissionDate, setSubmissionDate] = useState(wizard.settings.cover.submissionDate);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await onSave({
      step: 7,
      font,
      fontSizePt,
      lineSpacing,
      marginsMm,
      pageNumbering,
      spelling,
      cover: {
        authorName: authorName.trim(),
        institution: institution.trim(),
        department: department.trim(),
        supervisor: supervisor.trim(),
        submissionDate: submissionDate.trim(),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-medium">Formatting and cover page</h2>
        <p className="text-sm text-[var(--neutral-600)]">
          These layout rules directly determine your PDF and Word page count.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="fmt-font" className="block text-sm font-medium text-[var(--neutral-800)]">
            Font family
          </label>
          <select
            id="fmt-font"
            value={font}
            onChange={(e) => setFont(e.target.value)}
            className="block w-full min-h-[44px] px-3 py-2 text-base bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
          >
            {ALLOWED_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="fmt-size" className="block text-sm font-medium text-[var(--neutral-800)]">
            Font size
          </label>
          <select
            id="fmt-size"
            value={fontSizePt}
            onChange={(e) => setFontSizePt(Number(e.target.value))}
            className="block w-full min-h-[44px] px-3 py-2 text-base bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
          >
            {[10, 11, 12, 13, 14].map((pt) => (
              <option key={pt} value={pt}>
                {pt} pt
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="fmt-spacing"
            className="block text-sm font-medium text-[var(--neutral-800)]"
          >
            Line spacing
          </label>
          <select
            id="fmt-spacing"
            value={lineSpacing}
            onChange={(e) => setLineSpacing(e.target.value as LineSpacing)}
            className="block w-full min-h-[44px] px-3 py-2 text-base bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
          >
            <option value="double">Double spacing</option>
            <option value="one_half">1.5 spacing</option>
            <option value="single">Single spacing</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="fmt-margins"
            className="block text-sm font-medium text-[var(--neutral-800)]"
          >
            Margins (mm)
          </label>
          <select
            id="fmt-margins"
            value={marginsMm}
            onChange={(e) => setMarginsMm(Number(e.target.value))}
            className="block w-full min-h-[44px] px-3 py-2 text-base bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
          >
            {[20, 25, 30, 35].map((mm) => (
              <option key={mm} value={mm}>
                {mm} mm
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="fmt-spelling"
            className="block text-sm font-medium text-[var(--neutral-800)]"
          >
            Spelling variant
          </label>
          <select
            id="fmt-spelling"
            value={spelling}
            onChange={(e) => setSpelling(e.target.value as SpellingVariant)}
            className="block w-full min-h-[44px] px-3 py-2 text-base bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
          >
            <option value="uk">UK English (colour, analyse)</option>
            <option value="us">US English (color, analyze)</option>
          </select>
        </div>

        <div className="flex items-end">
          <label className="flex items-center gap-2.5 min-h-[44px] px-3.5 py-2 w-full rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] cursor-pointer text-sm text-[var(--neutral-800)]">
            <input
              type="checkbox"
              checked={pageNumbering}
              onChange={(e) => setPageNumbering(e.target.checked)}
              className="w-4 h-4 accent-[var(--accent-600)]"
            />
            Include page numbers
          </label>
        </div>
      </div>

      <fieldset className="border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-4">
        <legend className="text-sm font-semibold text-[var(--neutral-900)] px-1">
          Cover page details (optional)
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            id="cover-author"
            label="Author / student name"
            type="text"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
          />
          <FormField
            id="cover-institution"
            label="Institution"
            type="text"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
          />
          <FormField
            id="cover-department"
            label="Department / faculty"
            type="text"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          />
          <FormField
            id="cover-supervisor"
            label="Supervisor"
            type="text"
            value={supervisor}
            onChange={(e) => setSupervisor(e.target.value)}
          />
          <FormField
            id="cover-date"
            label="Submission date"
            type="text"
            placeholder="e.g. November 2026"
            value={submissionDate}
            onChange={(e) => setSubmissionDate(e.target.value)}
          />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" loading={saving} loadingLabel="Saving formatting...">
          Preview outline
        </Button>
      </div>
    </form>
  );
}
