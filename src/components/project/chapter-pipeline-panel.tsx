"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { FormAlert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import type { ChapterStatus } from "@/db/schema";
import type { ChapterAttentionInfo } from "@/lib/writing/attention";
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
    classes: "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]",
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
}: {
  projectId: string;
  chapters: ChapterPanelItem[];
  datasets: DatasetPanelItem[];
}) {
  const router = useRouter();
  const [busyChapterId, setBusyChapterId] = useState<string | null>(null);
  const [revisingChapterId, setRevisingChapterId] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const [detailsChapter, setDetailsChapter] = useState<ChapterPanelItem | null>(null);
  const [detailsText, setDetailsText] = useState("");
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasResultsChapter = chapters.some((c) => c.chapterType === "results");

  useEffect(() => {
    if (!detailsChapter) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDetailsChapter(null);
        setDetailsError(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailsChapter]);

  async function triggerStart(chapterId: string, providedDetails?: string) {
    setError(null);
    setDetailsError(null);
    setNotice(null);
    setBusyChapterId(chapterId);
    try {
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
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        const message = data.error ?? "Could not start this chapter.";
        if (detailsChapter?.id === chapterId) {
          setDetailsError(message);
        } else {
          setError(message);
        }
        return;
      }
      setDetailsChapter(null);
      setDetailsText("");
      setNotice(
        "Chapter queued for drafting. You will receive an email as soon as it is ready to review."
      );
      router.refresh();
    } catch {
      const message = "Network error while starting chapter.";
      if (detailsChapter?.id === chapterId) {
        setDetailsError(message);
      } else {
        setError(message);
      }
    } finally {
      setBusyChapterId(null);
    }
  }

  async function triggerChapterPdfDownload(chapterId: string) {
    setError(null);
    setBusyChapterId(chapterId);
    try {
      const res = await fetch(`/api/projects/${projectId}/exports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "chapter", format: "pdf", chapterId }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        export?: { downloadUrl: string };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.export?.downloadUrl) {
        setError(data.error ?? "Could not build chapter PDF.");
        return;
      }
      window.location.href = data.export.downloadUrl;
    } catch {
      setError("Network error while building chapter PDF.");
    } finally {
      setBusyChapterId(null);
    }
  }

  async function triggerApprove(chapterId: string) {
    setError(null);
    setNotice(null);
    setBusyChapterId(chapterId);
    try {
      const res = await fetch(`/api/projects/${projectId}/chapters/${chapterId}/approve`, {
        method: "POST",
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not approve chapter.");
        return;
      }
      setNotice("Chapter approved. You can now start the next chapter whenever you are ready.");
      router.refresh();
    } catch {
      setError("Network error while approving chapter.");
    } finally {
      setBusyChapterId(null);
    }
  }

  async function submitRevision(chapterId: string) {
    setError(null);
    setNotice(null);
    if (revisionNote.trim().length < 10) {
      setError("Describe the requested changes in at least 10 characters.");
      return;
    }
    setBusyChapterId(chapterId);
    try {
      const res = await fetch(`/api/projects/${projectId}/chapters/${chapterId}/revise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instructions: revisionNote.trim() }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not queue chapter revision.");
        return;
      }
      setRevisionNote("");
      setRevisingChapterId(null);
      setNotice("Revision queued. A new chapter version will be saved when ready.");
      router.refresh();
    } catch {
      setError("Network error while requesting changes.");
    } finally {
      setBusyChapterId(null);
    }
  }

  async function handleCsvUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setNotice(null);
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
        setError(data.error ?? "Could not upload CSV dataset.");
        return;
      }
      setNotice(
        `Uploaded ${data.dataset.filename} (${data.dataset.rowCount} rows, ${data.dataset.columnCount} columns). Real statistics will be used in your Results chapter.`
      );
      router.refresh();
    } catch {
      setError("Failed to read or upload the CSV file.");
    } finally {
      setUploadingCsv(false);
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-6">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}

      {hasResultsChapter ? (
        <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 sm:p-6 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-[var(--neutral-900)]">
                Results data (optional)
              </h3>
              <p className="text-sm text-[var(--neutral-600)] leading-relaxed max-w-[62ch]">
                Upload a CSV file from your survey or lab work so Collate calculates real tables
                automatically. Without one, it uses cited public data or clearly marked placeholders
                — never invented numbers.
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
              Attached file{datasets.length === 1 ? "" : "s"}:{" "}
              {datasets
                .map((d) => `${d.filename} (${d.rowCount.toLocaleString("en-US")} rows)`)
                .join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden">
        <div className="px-5 sm:px-6 py-4 bg-[var(--neutral-50)] border-b border-[var(--neutral-200)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-lg font-medium text-[var(--neutral-900)]">
            Chapters ({chapters.length})
          </h2>
          <p className="text-xs text-[var(--neutral-600)]">
            Chapters unlock one at a time as each draft is ready
          </p>
        </div>

        <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0">
          {chapters.map((ch) => {
            const badge = CHAPTER_STATUS_BADGE[ch.status];
            const gate = canStartChapter(chapters, ch.number);
            const isBusy = busyChapterId === ch.id;

            return (
              <li
                key={ch.id}
                className="px-5 sm:px-6 py-5 space-y-3 hover:bg-[var(--neutral-50)]/60 transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 w-8 h-8 rounded-[var(--radius-sm)] text-xs font-semibold tabular-nums grid place-items-center shrink-0 ${
                        ch.isAutoReferences
                          ? "bg-[var(--neutral-100)] text-[var(--neutral-600)] border border-[var(--neutral-200)]"
                          : ch.status === "approved" || ch.status === "ready"
                            ? "bg-[var(--success-bg)] text-[var(--success-text)] border border-[var(--success-border)]"
                            : "bg-[var(--accent-100)] text-[var(--accent-600)]"
                      }`}
                    >
                      {ch.isAutoReferences ? "Ref" : String(ch.number).padStart(2, "0")}
                    </span>

                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3
                          className="text-base font-semibold text-[var(--neutral-900)] leading-snug"
                          style={{ fontFamily: "var(--font-sans)" }}
                        >
                          {ch.isAutoReferences ? ch.title : `Chapter ${ch.number}: ${ch.title}`}
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
                          ? "Built automatically from the verified sources cited across your chapters."
                          : `Target: ~${(ch.pageBudget ?? 0).toLocaleString("en-US")} pages (~${(ch.wordBudget ?? 0).toLocaleString("en-US")} words)`}
                      </p>

                      {ch.sectionHeadings.length > 0 ? (
                        <p className="text-xs text-[var(--neutral-500)] leading-relaxed">
                          Sections: {ch.sectionHeadings.join(" · ")}
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

                      {ch.status === "needs_attention" && ch.attention ? (
                        <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3.5 py-2.5 text-xs text-[var(--warning-text)] leading-relaxed max-w-[64ch]">
                          <p className="font-semibold m-0">{ch.attention.title}</p>
                          <p className="mt-0.5 m-0">{ch.attention.userMessage}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {!ch.isAutoReferences ? (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {ch.status === "not_started" ? (
                        <Button
                          type="button"
                          variant={gate.allowed ? "primary" : "secondary"}
                          disabled={!gate.allowed || isBusy}
                          loading={isBusy}
                          loadingLabel="Starting..."
                          title={gate.allowed ? undefined : gate.reason}
                          onClick={() => triggerStart(ch.id)}
                        >
                          Start Chapter {ch.number}
                        </Button>
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
                                setDetailsError(null);
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
                              Resume Chapter {ch.number}
                            </Button>
                          )}
                        </>
                      ) : null}

                      {ch.status === "ready" || ch.status === "approved" ? (
                        <>
                          <LinkButton
                            href={`/projects/${projectId}/chapters/${ch.id}`}
                            variant="secondary"
                          >
                            Read / edit
                          </LinkButton>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={isBusy}
                            onClick={() => triggerChapterPdfDownload(ch.id)}
                          >
                            Download PDF
                          </Button>
                        </>
                      ) : null}

                      {ch.status === "ready" ? (
                        <>
                          <Button
                            type="button"
                            variant="primary"
                            loading={isBusy}
                            loadingLabel="Approving..."
                            onClick={() => triggerApprove(ch.id)}
                          >
                            Approve Chapter
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() =>
                              setRevisingChapterId(revisingChapterId === ch.id ? null : ch.id)
                            }
                          >
                            Request changes
                          </Button>
                        </>
                      ) : null}

                      {ch.status === "approved" ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            setRevisingChapterId(revisingChapterId === ch.id ? null : ch.id)
                          }
                        >
                          Request changes
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {revisingChapterId === ch.id ? (
                  <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-3">
                    <label
                      htmlFor={`rev-note-${ch.id}`}
                      className="block text-xs font-medium text-[var(--neutral-800)]"
                    >
                      What should be revised in Chapter {ch.number}?
                    </label>
                    <textarea
                      id={`rev-note-${ch.id}`}
                      rows={3}
                      value={revisionNote}
                      onChange={(e) => setRevisionNote(e.target.value)}
                      placeholder="e.g. Expand section 2 with more Nigerian empirical studies and tighten the opening paragraph."
                      className="block w-full px-3 py-2 text-sm bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        loading={isBusy}
                        loadingLabel="Queueing revision..."
                        onClick={() => submitRevision(ch.id)}
                      >
                        Start revision run
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setRevisingChapterId(null);
                          setRevisionNote("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {detailsChapter && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setDetailsChapter(null);
                  setDetailsError(null);
                }
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="provide-details-title"
                className="w-full max-w-[540px] max-h-[calc(100vh-2rem)] flex flex-col bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] shadow-xl overflow-hidden"
              >
                <div className="px-6 py-4 bg-[var(--neutral-50)] border-b border-[var(--neutral-200)] flex items-start justify-between gap-4 shrink-0">
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-xs font-medium text-[var(--accent-600)] m-0">
                      Chapter {detailsChapter.number}: {detailsChapter.title}
                    </p>
                    <h3
                      id="provide-details-title"
                      className="text-lg font-medium text-[var(--neutral-900)] m-0"
                    >
                      {detailsChapter.attention?.title ?? "Provide details to continue"}
                    </h3>
                  </div>
                  <button
                    type="button"
                    aria-label="Close modal"
                    onClick={() => {
                      setDetailsChapter(null);
                      setDetailsError(null);
                    }}
                    className="w-8 h-8 rounded-[var(--radius-sm)] grid place-items-center text-[var(--neutral-500)] hover:text-[var(--neutral-900)] hover:bg-[var(--neutral-100)] transition-colors cursor-pointer shrink-0"
                  >
                    ×
                  </button>
                </div>

                <div className="p-6 space-y-5 overflow-y-auto">
                  <div className="rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning-text)] leading-relaxed">
                    {detailsChapter.attention?.userMessage}
                  </div>

                  {detailsError ? <FormAlert tone="error">{detailsError}</FormAlert> : null}

                  {detailsChapter.attention?.allowCsvUpload ||
                  detailsChapter.chapterType === "results" ? (
                    <div className="rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] p-4 space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
                            Upload CSV data (optional)
                          </p>
                          <p className="text-xs text-[var(--neutral-600)] m-0">
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
                        <p className="text-xs text-[var(--neutral-700)] tabular-nums m-0 pt-2 border-t border-[var(--neutral-200)]">
                          Attached:{" "}
                          {datasets
                            .map(
                              (d) => `${d.filename} (${d.rowCount.toLocaleString("en-US")} rows)`
                            )
                            .join(", ")}
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
                    <p className="text-xs text-[var(--neutral-500)] m-0">
                      Your notes will guide the resumed draft while staying grounded in your
                      verified sources.
                    </p>
                  </div>
                </div>

                <div className="px-6 py-4 bg-[var(--neutral-50)] border-t border-[var(--neutral-200)] flex items-center justify-end gap-2.5 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busyChapterId === detailsChapter.id}
                    onClick={() => {
                      setDetailsChapter(null);
                      setDetailsError(null);
                    }}
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
                    Resume Chapter {detailsChapter.number}
                  </Button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
