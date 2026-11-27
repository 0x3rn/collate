"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import {
  DownloadMenuButton,
  type DownloadExportFormat,
} from "@/components/ui/download-menu-button";
import {
  InsufficientCreditsModal,
  ModalCard,
  type InsufficientCreditsDetails,
} from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";
import { estimateRevisionCredits, estimateSingleSectionRevisionCredits } from "@/config/pricing";
import type { ChapterAttachmentKind, ChapterStatus, ExperimentalDataMode } from "@/db/schema";
import {
  inferAttachmentKind,
  MAX_CHAPTER_INSTRUCTIONS_CHARS,
  MAX_MARKDOWN_ATTACHMENT_BYTES,
} from "@/lib/writing/chapter-instructions";
import type { ChapterAttentionInfo } from "@/lib/writing/attention";
import {
  formatUnitHeading,
  formatUnitShortLabel,
  subUnitNounPlural,
  unitNounPlural,
  unitNounSingular,
} from "@/lib/outline/structures";
import { canStartChapter } from "@/lib/writing/state-machine";

export interface ChapterPanelItem {
  id: string;
  number: number;
  title: string;
  chapterType: string;
  pageBudget: number | null;
  wordBudget: number | null;
  isAutoReferences: boolean;
  status: ChapterStatus;
  sectionHeadings: string[];
  userInstructions?: string | null;
  userAttachmentName?: string | null;
  userAttachmentKind?: ChapterAttachmentKind | null;
  hasUserDataTables?: boolean;
  attention?: ChapterAttentionInfo | null;
  hasDraftVersion?: boolean;
  originalityReport?: {
    passed: boolean;
    overlapScore: number;
    quoteSharePct: number;
    crossUserScore: number;
  } | null;
}

export interface DatasetPanelItem {
  id: string;
  filename: string;
  rowCount: number;
}

const CHAPTER_STATUS_BADGE: Record<ChapterStatus, { label: string; classes: string }> = {
  not_started: {
    label: "Not started",
    classes: "bg-[var(--neutral-100)] text-[var(--neutral-700)] border-[var(--neutral-200)]",
  },
  queued: {
    label: "Queued",
    classes: "bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]",
  },
  writing: {
    label: "Writing",
    classes: "bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]",
  },
  ready: {
    label: "Ready for review",
    classes: "bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]",
  },
  approved: {
    label: "Approved",
    classes: "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]",
  },
  needs_attention: {
    label: "Needs Attention",
    classes: "bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]",
  },
};

export function ChapterPipelinePanel({
  projectId,
  chapters,
  datasets,
  useChapters = true,
  isExperimental = false,
  experimentalDataMode = "user_provided",
}: {
  projectId: string;
  chapters: ChapterPanelItem[];
  datasets: DatasetPanelItem[];
  useChapters?: boolean;
  isExperimental?: boolean;
  experimentalDataMode?: ExperimentalDataMode;
}) {
  const unitCap = unitNounSingular(useChapters, true);
  const unitLower = unitNounSingular(useChapters, false);
  const unitsCap = unitNounPlural(useChapters, true);
  const unitsLower = unitNounPlural(useChapters, false);
  const subUnitsCap = subUnitNounPlural(useChapters, true);
  const subUnitsLower = subUnitNounPlural(useChapters, false);
  const router = useRouter();
  const toast = useToast();
  const [busyChapterId, setBusyChapterId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<{
    chapterId: string;
    format: DownloadExportFormat;
  } | null>(null);
  const [revisingChapterId, setRevisingChapterId] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const [revisionTargetSection, setRevisionTargetSection] = useState("");
  const [detailsChapter, setDetailsChapter] = useState<ChapterPanelItem | null>(null);
  const [detailsText, setDetailsText] = useState("");
  const [instructionsChapter, setInstructionsChapter] = useState<ChapterPanelItem | null>(null);
  const [instructionsText, setInstructionsText] = useState("");
  const [stagedFile, setStagedFile] = useState<{
    filename: string;
    kind: ChapterAttachmentKind;
    content: string;
  } | null>(null);
  const [keepExistingAttachment, setKeepExistingAttachment] = useState(false);
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [creditsModal, setCreditsModal] = useState<InsufficientCreditsDetails | null>(null);

  const hasResultsChapter = chapters.some((c) => c.chapterType === "results");
  const hasInFlightChapter = chapters.some(
    (c) => !c.isAutoReferences && (c.status === "queued" || c.status === "writing")
  );

  // Lightweight live refresh ONLY while a chapter is queued or actively drafting.
  // Pauses when the browser tab is hidden and stops automatically once drafting finishes or pauses.
  useEffect(() => {
    if (!hasInFlightChapter) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 8000);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hasInFlightChapter, router]);

  async function triggerStart(chapterId: string, providedDetails?: string) {
    setBusyChapterId(chapterId);
    try {
      const targetChapter = chapters.find((c) => c.id === chapterId);
      const trimmedDetails = providedDetails?.trim();
      const res = await fetch(`/api/projects/${projectId}/chapters/${chapterId}/start`, {
        method: "POST",
        ...(trimmedDetails
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ details: trimmedDetails }),
            }
          : {}),
      });
      const data = (await res.json()) as {
        ok: boolean;
        code?: string;
        creditsRequired?: number;
        creditsAvailable?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        if (
          (res.status === 402 || data.code === "INSUFFICIENT_CREDITS") &&
          typeof data.creditsRequired === "number"
        ) {
          setDetailsChapter(null);
          setCreditsModal({
            actionLabel: targetChapter
              ? formatUnitHeading(targetChapter.number, targetChapter.title, useChapters)
              : `This ${unitLower}`,
            creditsRequired: data.creditsRequired,
            creditsAvailable: data.creditsAvailable,
            message: data.error,
          });
          return;
        }
        toast.error(
          data.error ?? `Could not start this ${unitLower}.`,
          `Could not start ${unitLower}`
        );
        return;
      }
      setDetailsChapter(null);
      setDetailsText("");
      toast.success(
        `${unitCap} queued for drafting. You will receive an email as soon as it is ready to review.`,
        `${unitCap} queued`
      );
      router.refresh();
    } catch {
      toast.error(`Network error while starting ${unitLower}.`, "Connection error");
    } finally {
      setBusyChapterId(null);
    }
  }

  async function triggerChapterDownload(chapterId: string, format: DownloadExportFormat) {
    setBusyChapterId(chapterId);
    setDownloading({ chapterId, format });
    try {
      const res = await fetch(`/api/projects/${projectId}/exports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "chapter", format, chapterId }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        export?: { downloadUrl: string };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.export?.downloadUrl) {
        toast.error(
          data.error ??
            (format === "docx"
              ? "Could not build chapter Word document."
              : "Could not build chapter PDF."),
          "Download unavailable"
        );
        return;
      }
      window.location.href = data.export.downloadUrl;
    } catch {
      toast.error(
        format === "docx"
          ? "Network error while building chapter Word document."
          : "Network error while building chapter PDF.",
        "Download unavailable"
      );
    } finally {
      setBusyChapterId(null);
      setDownloading(null);
    }
  }

  async function triggerApprove(chapterId: string) {
    setBusyChapterId(chapterId);
    try {
      const res = await fetch(`/api/projects/${projectId}/chapters/${chapterId}/approve`, {
        method: "POST",
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? `Could not approve ${unitLower}.`,
          `Could not approve ${unitLower}`
        );
        return;
      }
      toast.success(
        `You can now start the next ${unitLower} whenever you are ready.`,
        `${unitCap} approved`
      );
      router.refresh();
    } catch {
      toast.error(`Network error while approving ${unitLower}.`, "Connection error");
    } finally {
      setBusyChapterId(null);
    }
  }

  async function submitRevision(chapterId: string) {
    if (revisionNote.trim().length < 10) {
      toast.error(
        "Describe the requested changes in at least 10 characters.",
        "More detail needed"
      );
      return;
    }
    setBusyChapterId(chapterId);
    try {
      const targetChapter = chapters.find((c) => c.id === chapterId);
      const res = await fetch(`/api/projects/${projectId}/chapters/${chapterId}/revise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instructions: revisionNote.trim(),
          ...(revisionTargetSection ? { targetSectionHeadings: [revisionTargetSection] } : {}),
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        code?: string;
        creditsRequired?: number;
        creditsAvailable?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        if (
          (res.status === 402 || data.code === "INSUFFICIENT_CREDITS") &&
          typeof data.creditsRequired === "number"
        ) {
          setCreditsModal({
            actionLabel: targetChapter
              ? `Revising Chapter ${targetChapter.number}: ${targetChapter.title}`
              : "Revising this chapter",
            creditsRequired: data.creditsRequired,
            creditsAvailable: data.creditsAvailable,
            message: data.error,
          });
          return;
        }
        toast.error(data.error ?? "Could not queue chapter revision.", "Could not request changes");
        return;
      }
      setRevisionNote("");
      setRevisionTargetSection("");
      setRevisingChapterId(null);
      toast.success(
        "A new chapter version will be saved as soon as it is ready.",
        "Revision queued"
      );
      router.refresh();
    } catch {
      toast.error("Network error while requesting changes.", "Connection error");
    } finally {
      setBusyChapterId(null);
    }
  }

  function openInstructionsModal(ch: ChapterPanelItem) {
    setInstructionsChapter(ch);
    setInstructionsText(ch.userInstructions ?? "");
    setStagedFile(null);
    setKeepExistingAttachment(Boolean(ch.userAttachmentName));
  }

  function closeInstructionsModal() {
    if (savingInstructions) return;
    setInstructionsChapter(null);
    setInstructionsText("");
    setStagedFile(null);
    setKeepExistingAttachment(false);
  }

  async function handleInstructionFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const kind = inferAttachmentKind(file.name);
    if (!kind) {
      toast.error("Please upload a .csv, .md, .markdown, or .txt file.", "Unsupported file type");
      return;
    }

    if (kind === "csv" && file.size > 5 * 1024 * 1024) {
      toast.error("CSV files must be 5 MB or smaller.", "File too large");
      return;
    }
    if (kind !== "csv" && file.size > MAX_MARKDOWN_ATTACHMENT_BYTES) {
      toast.error("Markdown and text files must be 250 KB or smaller.", "File too large");
      return;
    }

    try {
      const text = await file.text();
      if (text.includes("\u0000")) {
        toast.error(
          "This file appears to be binary. Upload plain text CSV or Markdown files only.",
          "Invalid file"
        );
        return;
      }

      if (kind === "csv") {
        setStagedFile({ filename: file.name, kind, content: text });
        setKeepExistingAttachment(false);
        toast.info(
          `${file.name} attached. Click Save instructions to calculate statistical tables for this chapter.`,
          "CSV file attached"
        );
      } else {
        const trimmedFile = text.replace(/\r\n/g, "\n").trim();
        if (!trimmedFile) {
          toast.error("The selected file is empty.", "Empty file");
          return;
        }
        const existingTrimmed = instructionsText.trim();
        const combined = existingTrimmed ? `${existingTrimmed}\n\n${trimmedFile}` : trimmedFile;
        if (combined.length > MAX_CHAPTER_INSTRUCTIONS_CHARS) {
          toast.error(
            `Combined text exceeds ${MAX_CHAPTER_INSTRUCTIONS_CHARS.toLocaleString("en-US")} characters. Trim the notes before attaching.`,
            "Notes too long"
          );
          return;
        }
        setInstructionsText(combined);
        setStagedFile({ filename: file.name, kind, content: trimmedFile });
        setKeepExistingAttachment(false);
        toast.info(
          `Loaded ${file.name} into the instructions box. Review or edit, then click Save instructions.`,
          "File loaded"
        );
      }
    } catch {
      toast.error("Could not read the selected file.", "File read failed");
    }
  }

  async function saveChapterInstructions(clearAll = false) {
    if (!instructionsChapter) return;
    setSavingInstructions(true);
    try {
      const payload = clearAll
        ? { instructions: "", keepExistingAttachment: false }
        : {
            instructions: instructionsText,
            ...(stagedFile
              ? {
                  attachmentFilename: stagedFile.filename,
                  attachmentContent: stagedFile.content,
                }
              : { keepExistingAttachment }),
          };

      const res = await fetch(
        `/api/projects/${projectId}/chapters/${instructionsChapter.id}/instructions`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        userInstructions?: string | null;
        userAttachmentName?: string | null;
        hasDataTables?: boolean;
        csvStats?: { rowCount: number; columnCount: number } | null;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "Could not save chapter instructions.", "Save failed");
        return;
      }

      const cleared = !data.userInstructions && !data.userAttachmentName && !data.hasDataTables;
      if (cleared) {
        toast.success(
          `Cleared pre-start instructions for Chapter ${instructionsChapter.number}.`,
          "Instructions cleared"
        );
      } else if (data.csvStats) {
        toast.success(
          `Saved Chapter ${instructionsChapter.number} instructions with ${data.csvStats.rowCount} data rows (${data.csvStats.columnCount} columns) analyzed.`,
          "Instructions & data saved"
        );
      } else {
        toast.success(
          `Saved instructions for Chapter ${instructionsChapter.number}. They will be applied when you start drafting.`,
          "Instructions saved"
        );
      }

      setInstructionsChapter(null);
      setInstructionsText("");
      setStagedFile(null);
      setKeepExistingAttachment(false);
      router.refresh();
    } catch {
      toast.error("Network error while saving chapter instructions.", "Connection error");
    } finally {
      setSavingInstructions(false);
    }
  }

  async function handleCsvUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCsv(true);
    try {
      const csvContent = await file.text();
      const res = await fetch(`/api/projects/${projectId}/datasets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, csvContent }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        dataset?: { filename: string; rowCount: number; columnCount: number };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.dataset) {
        toast.error(data.error ?? "Could not upload CSV dataset.", "Upload failed");
        return;
      }
      toast.success(
        `${data.dataset.filename} (${data.dataset.rowCount} rows, ${data.dataset.columnCount} columns) will be used in your Results chapter.`,
        "CSV uploaded"
      );
      router.refresh();
    } catch {
      toast.error("Failed to read or upload the CSV file.", "Upload failed");
    } finally {
      setUploadingCsv(false);
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-6">
      {hasResultsChapter ? (
        <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 sm:p-6 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-[var(--neutral-900)]">
                Results data (optional)
              </h3>
              <p className="text-sm text-[var(--neutral-600)] leading-relaxed max-w-[62ch]">
                {isExperimental &&
                experimentalDataMode === "published_benchmarks" &&
                datasets.length === 0
                  ? "Published benchmark mode is active. Without an uploaded CSV, Collate will gather verified experimental value ranges from cited studies for your Results tables. Upload your own CSV anytime to use your primary measurements instead."
                  : "Upload a CSV file from your survey or lab work so Collate calculates real tables automatically. Without one, it uses cited public data or clearly marked placeholders, never invented numbers."}
              </p>
            </div>
            <label className="inline-flex items-center justify-center min-h-[42px] px-4 py-2 text-sm font-medium bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] hover:bg-[var(--neutral-100)] cursor-pointer shrink-0 whitespace-nowrap transition-colors">
              {uploadingCsv ? "Analyzing file..." : "Upload CSV file"}
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={uploadingCsv}
                onChange={handleCsvUpload}
                className="sr-only"
              />
            </label>
          </div>
          {datasets.length > 0 ? (
            <p className="text-xs text-[var(--neutral-700)] tabular-nums pt-2 border-t border-[var(--neutral-200)]">
              Active dataset:{" "}
              <span className="font-medium text-[var(--neutral-900)]">{datasets[0]!.filename}</span>{" "}
              ({datasets[0]!.rowCount.toLocaleString("en-US")} rows)
              <span className="text-[var(--neutral-500)]">
                {" "}
                · Uploading a new CSV replaces the active dataset for your Results chapter.
              </span>
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)]">
        <div className="px-5 sm:px-6 py-4 bg-[var(--neutral-50)] border-b border-[var(--neutral-200)] rounded-t-[var(--radius-md)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-lg font-medium text-[var(--neutral-900)]">
            {unitsCap} ({chapters.length})
          </h2>
          <p className="text-xs text-[var(--neutral-600)]">
            {unitsCap} unlock one at a time as each draft is ready
          </p>
        </div>

        <ul className="divide-y divide-[var(--neutral-200)] list-none p-0">
          {chapters.map((ch) => {
            const badge = CHAPTER_STATUS_BADGE[ch.status];
            const gate = canStartChapter(chapters, ch.number, useChapters);
            const isBusy = busyChapterId === ch.id;
            const isMultiActionChapter = ch.status === "ready" || ch.status === "approved";
            const loadingDownloadFormat =
              downloading?.chapterId === ch.id ? downloading.format : null;

            return (
              <li
                key={ch.id}
                className="px-5 sm:px-6 py-5 flex flex-col gap-3.5 last:rounded-b-[var(--radius-md)] hover:bg-[var(--neutral-50)]/60 transition-colors"
              >
                <div
                  className={
                    isMultiActionChapter
                      ? "flex flex-col gap-4"
                      : "flex flex-col sm:flex-row sm:items-start justify-between gap-4"
                  }
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 w-8 h-8 rounded-[var(--radius-sm)] text-xs font-semibold tabular-nums grid place-items-center shrink-0 ${
                        ch.isAutoReferences
                          ? "bg-[var(--neutral-100)] text-[var(--neutral-600)] border border-[var(--neutral-200)]"
                          : ch.status === "approved"
                            ? "bg-[var(--success-bg)] text-[var(--success-text)] border border-[var(--success-border)]"
                            : ch.status === "ready"
                              ? "bg-[var(--warning-bg)] text-[var(--warning-text)] border border-[var(--warning-border)]"
                              : "bg-[var(--accent-100)] text-[var(--accent-600)]"
                      }`}
                    >
                      {ch.isAutoReferences ? "Ref" : String(ch.number).padStart(2, "0")}
                    </span>

                    <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3
                          className="text-base font-semibold text-[var(--neutral-900)] leading-snug"
                          style={{ fontFamily: "var(--font-sans)" }}
                        >
                          {ch.isAutoReferences
                            ? ch.title
                            : formatUnitHeading(ch.number, ch.title, useChapters)}
                        </h3>

                        {ch.isAutoReferences ? (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded-[4px] bg-[var(--neutral-100)] text-[var(--neutral-600)] border-[var(--neutral-200)]">
                            Automatic
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded-[4px] ${badge.classes}`}
                          >
                            {badge.label}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-[var(--neutral-600)] tabular-nums leading-relaxed">
                        {ch.isAutoReferences
                          ? `Built automatically from the verified sources cited across your ${unitsLower}.`
                          : `Target: ~${(ch.pageBudget ?? 0).toLocaleString("en-US")} pages (~${(ch.wordBudget ?? 0).toLocaleString("en-US")} words)`}
                      </p>

                      {ch.sectionHeadings.length > 0 ? (
                        <p className="text-xs text-[var(--neutral-500)] leading-relaxed">
                          {subUnitsCap}: {ch.sectionHeadings.join(" · ")}
                        </p>
                      ) : null}

                      {!ch.isAutoReferences &&
                      ch.status === "not_started" &&
                      !ch.hasDraftVersion &&
                      (ch.userInstructions || ch.userAttachmentName || ch.hasUserDataTables) ? (
                        <p className="inline-flex flex-wrap items-center gap-1.5 text-xs font-medium text-[var(--accent-600)] pt-0.5">
                          <span
                            aria-hidden="true"
                            className="w-1.5 h-1.5 rounded-full bg-[var(--accent-600)] shrink-0"
                          />
                          <span>
                            Pre-start instructions saved
                            {ch.userAttachmentName ? ` · ${ch.userAttachmentName}` : ""}
                            {!ch.userAttachmentName && ch.hasUserDataTables
                              ? " · Data tables ready"
                              : ""}
                          </span>
                        </p>
                      ) : null}

                      {ch.originalityReport ? (
                        <p className="text-xs font-medium tabular-nums text-[var(--neutral-700)] pt-0.5">
                          Similarity report:{" "}
                          <span
                            className={
                              ch.originalityReport.passed
                                ? "text-[var(--success-text)]"
                                : "text-[var(--error-text)]"
                            }
                          >
                            {ch.originalityReport.passed ? "Passed" : "Flagged"}
                          </span>{" "}
                          · Source overlap {ch.originalityReport.overlapScore}% · Quotes{" "}
                          {ch.originalityReport.quoteSharePct}% · Cross-user{" "}
                          {ch.originalityReport.crossUserScore}%
                        </p>
                      ) : null}

                      {ch.status === "queued" || ch.status === "writing" ? (
                        <p className="inline-flex items-center gap-2 text-xs font-medium text-[var(--info-text)] pt-0.5">
                          <span
                            aria-hidden="true"
                            className="w-1.5 h-1.5 rounded-full bg-[var(--accent-600)] animate-pulse"
                          />
                          <span>
                            {ch.status === "queued"
                              ? "Queued for drafting. Status updates automatically."
                              : "Drafting in progress. Status updates automatically."}
                          </span>
                        </p>
                      ) : null}

                      {ch.status === "needs_attention" && ch.attention ? (
                        <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3.5 py-2.5 text-xs text-[var(--warning-text)] leading-relaxed max-w-[64ch]">
                          <p className="font-semibold">{ch.attention.title}</p>
                          <p className="mt-0.5">{ch.attention.userMessage}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {!ch.isAutoReferences ? (
                    <div
                      className={
                        isMultiActionChapter
                          ? "pt-3 border-t border-[var(--neutral-100)] grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end gap-2"
                          : ch.status === "not_started" && !ch.hasDraftVersion
                            ? "grid grid-cols-2 sm:flex sm:flex-nowrap sm:items-center sm:justify-end gap-2 sm:shrink-0"
                            : "flex flex-wrap items-center justify-end gap-2 shrink-0"
                      }
                    >
                      {ch.status === "not_started" ? (
                        <>
                          {!ch.hasDraftVersion ? (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={isBusy}
                              onClick={() => openInstructionsModal(ch)}
                              className="w-full sm:w-auto whitespace-nowrap"
                            >
                              {ch.userInstructions ||
                              ch.userAttachmentName ||
                              ch.hasUserDataTables ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <span
                                    aria-hidden="true"
                                    className="w-1.5 h-1.5 rounded-full bg-[var(--accent-600)]"
                                  />
                                  <span>Edit instructions</span>
                                </span>
                              ) : (
                                <>
                                  <span className="sm:hidden">Add instructions</span>
                                  <span className="hidden sm:inline">
                                    Add instructions (optional)
                                  </span>
                                </>
                              )}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant={gate.allowed ? "primary" : "secondary"}
                            disabled={!gate.allowed || isBusy}
                            loading={isBusy}
                            loadingLabel="Starting..."
                            title={gate.allowed ? undefined : gate.reason}
                            onClick={() => triggerStart(ch.id)}
                            className="w-full sm:w-auto whitespace-nowrap"
                          >
                            Start {formatUnitShortLabel(ch.number, useChapters)}
                          </Button>
                        </>
                      ) : null}

                      {ch.status === "needs_attention" ? (
                        <>
                          {ch.hasDraftVersion ? (
                            <LinkButton
                              href={`/projects/${projectId}/chapters/${ch.id}`}
                              variant="secondary"
                            >
                              Read / edit
                            </LinkButton>
                          ) : null}

                          {ch.attention?.kind === "user_input_required" ? (
                            <Button
                              type="button"
                              variant={gate.allowed ? "primary" : "secondary"}
                              disabled={!gate.allowed || isBusy}
                              title={gate.allowed ? undefined : gate.reason}
                              onClick={() => {
                                setDetailsText("");
                                setDetailsChapter(ch);
                              }}
                            >
                              Provide Details
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant={gate.allowed ? "primary" : "secondary"}
                              disabled={!gate.allowed || isBusy}
                              loading={isBusy}
                              loadingLabel="Resuming..."
                              title={gate.allowed ? undefined : gate.reason}
                              onClick={() => triggerStart(ch.id)}
                            >
                              Resume {formatUnitShortLabel(ch.number, useChapters)}
                            </Button>
                          )}
                        </>
                      ) : null}

                      {isMultiActionChapter ? (
                        <>
                          <LinkButton
                            href={`/projects/${projectId}/chapters/${ch.id}`}
                            variant="secondary"
                            className="w-full sm:w-auto whitespace-nowrap"
                          >
                            Read / edit
                          </LinkButton>

                          <Button
                            type="button"
                            variant="secondary"
                            className="w-full sm:w-auto whitespace-nowrap"
                            onClick={() =>
                              setRevisingChapterId(revisingChapterId === ch.id ? null : ch.id)
                            }
                          >
                            Request changes
                          </Button>

                          {ch.status === "ready" ? (
                            <Button
                              type="button"
                              variant="primary"
                              className="w-full sm:w-auto whitespace-nowrap"
                              disabled={isBusy}
                              loading={isBusy && loadingDownloadFormat === null}
                              loadingLabel="Approving..."
                              onClick={() => triggerApprove(ch.id)}
                            >
                              Approve {unitCap}
                            </Button>
                          ) : null}

                          <DownloadMenuButton
                            label="Download"
                            disabled={isBusy && loadingDownloadFormat === null}
                            loadingFormat={loadingDownloadFormat}
                            onSelectFormat={(format) => triggerChapterDownload(ch.id, format)}
                            align="right"
                            className={
                              ch.status === "approved"
                                ? "col-start-2 w-full sm:w-auto"
                                : "w-full sm:w-auto"
                            }
                          />
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {revisingChapterId === ch.id
                  ? (() => {
                      const fullRevCredits = estimateRevisionCredits(ch.pageBudget);
                      const hasMultipleSections = ch.sectionHeadings.length > 1;
                      const singleSectionCredits = hasMultipleSections
                        ? estimateSingleSectionRevisionCredits(
                            ch.pageBudget,
                            ch.sectionHeadings.length
                          )
                        : fullRevCredits;
                      const selectedCredits =
                        hasMultipleSections && revisionTargetSection
                          ? singleSectionCredits
                          : fullRevCredits;
                      const creditWord = (n: number) => (n === 1 ? "credit" : "credits");

                      return (
                        <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <label
                              htmlFor={`rev-note-${ch.id}`}
                              className="block text-xs font-medium text-[var(--neutral-800)]"
                            >
                              What should be revised in{" "}
                              {formatUnitShortLabel(ch.number, useChapters)}?
                            </label>
                            <p className="text-xs text-[var(--neutral-500)]">
                              Requesting changes deducts credits when the revision finishes
                              (refunded automatically if it fails).{" "}
                              {hasMultipleSections
                                ? `Select a specific ${useChapters ? "section" : "subsection"} to send only that part to Collate and use fewer credits.`
                                : "Untouched sentences and verified citations are preserved."}
                            </p>
                          </div>
                          {hasMultipleSections ? (
                            <div className="flex flex-col gap-1">
                              <label
                                htmlFor={`rev-section-${ch.id}`}
                                className="block text-xs font-medium text-[var(--neutral-700)]"
                              >
                                {useChapters ? "Section to update" : "Subsection to update"}
                              </label>
                              <CustomSelect
                                id={`rev-section-${ch.id}`}
                                ariaLabel={
                                  useChapters ? "Section to update" : "Subsection to update"
                                }
                                size="sm"
                                value={revisionTargetSection}
                                onChange={setRevisionTargetSection}
                                options={[
                                  {
                                    value: "",
                                    label: `Auto-detect from my note · ${fullRevCredits} ${creditWord(fullRevCredits)}`,
                                    description: `May review the whole ${unitLower} · deducts the full ${unitLower} credit cost`,
                                  },
                                  ...ch.sectionHeadings.map((heading, idx) => ({
                                    value: heading,
                                    label: `${ch.number}.${idx + 1} ${heading} · ${singleSectionCredits} ${creditWord(singleSectionCredits)}`,
                                    description: `Sends only this ${useChapters ? "section" : "subsection"} to Collate · untouched ${subUnitsLower} stay unchanged`,
                                  })),
                                ]}
                              />
                            </div>
                          ) : null}
                          <textarea
                            id={`rev-note-${ch.id}`}
                            rows={3}
                            value={revisionNote}
                            onChange={(e) => setRevisionNote(e.target.value)}
                            placeholder="e.g. In section 1.1, add a verified photograph of beetroot and clarify the antioxidant pathway."
                            className="block w-full px-3 py-2 text-sm bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
                          />
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                            <p className="text-xs text-[var(--neutral-600)] tabular-nums">
                              Estimated deduction:{" "}
                              <span className="font-semibold text-[var(--neutral-900)]">
                                {selectedCredits} {creditWord(selectedCredits)}
                              </span>{" "}
                              {hasMultipleSections && revisionTargetSection
                                ? "(only this section is sent to Collate)"
                                : "(full chapter estimate)"}
                            </p>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                loading={isBusy}
                                loadingLabel="Queueing revision..."
                                onClick={() => submitRevision(ch.id)}
                              >
                                Start revision ({selectedCredits} {creditWord(selectedCredits)})
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                  setRevisingChapterId(null);
                                  setRevisionNote("");
                                  setRevisionTargetSection("");
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  : null}
              </li>
            );
          })}
        </ul>
      </section>

      <ModalCard
        open={Boolean(instructionsChapter)}
        onClose={closeInstructionsModal}
        eyebrow={
          instructionsChapter
            ? formatUnitHeading(instructionsChapter.number, instructionsChapter.title, useChapters)
            : undefined
        }
        title={isExperimental ? "Optional instructions & data" : "Optional instructions & notes"}
        maxWidthClassName="max-w-[580px]"
        footer={
          instructionsChapter ? (
            <div className="w-full flex flex-wrap items-center justify-between gap-2">
              <div>
                {instructionsChapter.userInstructions ||
                instructionsChapter.userAttachmentName ||
                instructionsChapter.hasUserDataTables ||
                instructionsText.trim() ||
                stagedFile ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={savingInstructions}
                    onClick={() => saveChapterInstructions(true)}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={savingInstructions}
                  onClick={closeInstructionsModal}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  loading={savingInstructions}
                  loadingLabel="Saving..."
                  onClick={() => saveChapterInstructions(false)}
                >
                  Save instructions
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {instructionsChapter ? (
          <>
            <div className="rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] px-3.5 py-2.5 text-sm text-[var(--neutral-700)] leading-relaxed">
              <strong className="font-semibold text-[var(--neutral-900)]">
                Optional: you can start this {unitLower} right away.
              </strong>{" "}
              Collate already has your topic, outline, and verified sources. Only add notes here if
              you want to include extra details such as supervisor instructions, specific themes to
              emphasize{isExperimental ? ", or your own experimental or survey results" : ""}.
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] p-3.5 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-medium text-[var(--neutral-900)]">
                    Upload CSV or Markdown (optional)
                  </p>
                  <p className="text-xs text-[var(--neutral-600)]">
                    Attach a .csv dataset for automatic statistical tables, or load a .md / .txt
                    file directly into the box below.
                  </p>
                </div>
                <label className="inline-flex items-center justify-center min-h-[38px] px-3.5 py-1.5 text-xs font-medium bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] hover:bg-[var(--neutral-100)] cursor-pointer shrink-0 whitespace-nowrap transition-colors">
                  Upload CSV / Markdown
                  <input
                    type="file"
                    accept=".csv,.md,.markdown,.txt,text/csv,text/markdown,text/plain"
                    disabled={savingInstructions}
                    onChange={handleInstructionFileSelect}
                    className="sr-only"
                  />
                </label>
              </div>

              {stagedFile ? (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--neutral-200)] text-xs">
                  <span className="text-[var(--neutral-800)] font-medium truncate">
                    Attached: {stagedFile.filename}
                    {stagedFile.kind === "csv" ? " (CSV, stats calculated on save)" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setStagedFile(null)}
                    className="text-[var(--neutral-500)] hover:text-[var(--neutral-900)] underline underline-offset-2 shrink-0 cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              ) : keepExistingAttachment && instructionsChapter.userAttachmentName ? (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--neutral-200)] text-xs">
                  <span className="text-[var(--neutral-800)] font-medium truncate">
                    Saved file: {instructionsChapter.userAttachmentName}
                    {instructionsChapter.hasUserDataTables ? " · Data tables ready" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setKeepExistingAttachment(false)}
                    className="text-[var(--neutral-500)] hover:text-[var(--neutral-900)] underline underline-offset-2 shrink-0 cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="chapter-prestart-instructions"
                className="block text-sm font-medium text-[var(--neutral-800)]"
              >
                Extra instructions, supervisor notes, or experimental data (optional)
              </label>
              <textarea
                id="chapter-prestart-instructions"
                rows={7}
                maxLength={MAX_CHAPTER_INSTRUCTIONS_CHARS}
                value={instructionsText}
                onChange={(e) => setInstructionsText(e.target.value)}
                placeholder="e.g. Emphasize glutathione depletion mechanisms in male Wistar rats, include a summary table of the three dosage groups, or paste raw CSV / Markdown data directly here..."
                className="block w-full px-3.5 py-2.5 text-sm bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] leading-relaxed font-sans"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--neutral-500)]">
                <span>
                  Paste raw CSV rows or Markdown tables directly; Collate parses them automatically.
                </span>
                <span className="tabular-nums">
                  {instructionsText.length.toLocaleString("en-US")} /{" "}
                  {MAX_CHAPTER_INSTRUCTIONS_CHARS.toLocaleString("en-US")}
                </span>
              </div>
            </div>
          </>
        ) : null}
      </ModalCard>

      <ModalCard
        open={Boolean(detailsChapter)}
        onClose={() => setDetailsChapter(null)}
        eyebrow={
          detailsChapter
            ? formatUnitHeading(detailsChapter.number, detailsChapter.title, useChapters)
            : undefined
        }
        title={detailsChapter?.attention?.title ?? "Provide details to continue"}
        maxWidthClassName="max-w-[540px]"
        footer={
          detailsChapter ? (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={busyChapterId === detailsChapter.id}
                onClick={() => setDetailsChapter(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={busyChapterId === detailsChapter.id}
                loadingLabel="Resuming..."
                onClick={() => triggerStart(detailsChapter.id, detailsText)}
              >
                Resume {formatUnitShortLabel(detailsChapter.number, useChapters)}
              </Button>
            </>
          ) : null
        }
      >
        {detailsChapter ? (
          <>
            <div className="rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning-text)] leading-relaxed">
              {detailsChapter.attention?.userMessage}
            </div>

            {detailsChapter.attention?.allowCsvUpload ||
            detailsChapter.chapterType === "results" ? (
              <div className="rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] p-4 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-[var(--neutral-900)]">
                      Upload CSV data (optional)
                    </p>
                    <p className="text-xs text-[var(--neutral-600)]">
                      Attach survey or lab measurements to include real calculated tables.
                    </p>
                  </div>
                  <label className="inline-flex items-center justify-center min-h-[38px] px-3.5 py-1.5 text-xs font-medium bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] hover:bg-[var(--neutral-100)] cursor-pointer shrink-0 whitespace-nowrap transition-colors">
                    {uploadingCsv ? "Analyzing file..." : "Choose CSV file"}
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      disabled={uploadingCsv}
                      onChange={handleCsvUpload}
                      className="sr-only"
                    />
                  </label>
                </div>
                {datasets.length > 0 ? (
                  <p className="text-xs text-[var(--neutral-700)] tabular-nums pt-2 border-t border-[var(--neutral-200)]">
                    Active dataset:{" "}
                    <span className="font-medium text-[var(--neutral-900)]">
                      {datasets[0]!.filename}
                    </span>{" "}
                    ({datasets[0]!.rowCount.toLocaleString("en-US")} rows)
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label
                htmlFor="provide-details-notes"
                className="block text-sm font-medium text-[var(--neutral-800)]"
              >
                {detailsChapter.attention?.promptLabel ??
                  "Additional notes or guidance for this chapter"}
              </label>
              <textarea
                id="provide-details-notes"
                rows={4}
                maxLength={2000}
                value={detailsText}
                onChange={(e) => setDetailsText(e.target.value)}
                placeholder="e.g. Emphasize the physiological mechanism in Wistar rats and compare against Nigerian regional studies."
                className="block w-full px-3.5 py-2.5 text-sm bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] leading-relaxed"
              />
              <p className="text-xs text-[var(--neutral-500)]">
                Your notes will guide the resumed draft while staying grounded in your verified
                sources.
              </p>
            </div>
          </>
        ) : null}
      </ModalCard>

      <InsufficientCreditsModal details={creditsModal} onClose={() => setCreditsModal(null)} />
    </div>
  );
}
