"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ChapterStatus } from "@/db/schema";
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
    label: "Needs attention",
    classes: "bg-[var(--error-bg)] text-[var(--error-text)] border-[var(--error-border)]",
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
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasResultsChapter = chapters.some((c) => c.chapterType === "results");

  async function triggerStart(chapterId: string) {
    setError(null);
    setNotice(null);
    setBusyChapterId(chapterId);
    try {
      const res = await fetch(`/api/projects/${projectId}/chapters/${chapterId}/start`, {
        method: "POST",
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not start this chapter.");
        return;
      }
      setNotice(
        "Chapter queued for evidence-bound drafting. You will be notified when it is ready."
      );
      router.refresh();
    } catch {
      setError("Network error while starting chapter.");
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
        <section className="bg-[var(--neutral-50)] border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-base font-medium m-0">
                Empirical dataset for Results (Rule NN-4)
              </h3>
              <p className="text-xs text-[var(--neutral-600)] m-0">
                Upload a CSV file so Collate computes real statistics and tables. Without uploaded
                or public dataset evidence, Collate generates a clearly labelled results
                framework—never invented numbers.
              </p>
            </div>
            <label className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] hover:bg-[var(--neutral-100)] cursor-pointer shrink-0">
              {uploadingCsv ? "Analyzing CSV..." : "Upload CSV dataset"}
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
            <p className="text-xs text-[var(--neutral-700)] m-0 tabular-nums">
              Attached dataset{datasets.length === 1 ? "" : "s"}:{" "}
              {datasets.map((d) => `${d.filename} (${d.rowCount} rows)`).join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-medium m-0">Chapters ({chapters.length})</h2>
          <p className="text-xs text-[var(--neutral-500)] m-0">
            Chapter N+1 unlocks only after Chapter N is ready (Rule NN-8)
          </p>
        </div>

        <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0">
          {chapters.map((ch) => {
            const badge = CHAPTER_STATUS_BADGE[ch.status];
            const gate = canStartChapter(chapters, ch.number);
            const isBusy = busyChapterId === ch.id;

            return (
              <li key={ch.id} className="py-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--neutral-500)] tabular-nums">
                        {ch.isAutoReferences ? "AUTO" : `Chapter ${ch.number}`}
                      </span>
                      <span className="text-base font-medium text-[var(--neutral-900)]">
                        {ch.title}
                      </span>
                      {!ch.isAutoReferences ? (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded-[var(--radius-sm)] ${badge.classes}`}
                        >
                          {badge.label}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-[var(--neutral-600)] tabular-nums m-0">
                      {ch.isAutoReferences
                        ? "Assembled automatically from verified cited sources by the CSL citation engine."
                        : `Target: ~${ch.pageBudget ?? 0} pages (~${(ch.wordBudget ?? 0).toLocaleString()} words)`}
                    </p>
                    {ch.sectionHeadings.length > 0 ? (
                      <p className="text-xs text-[var(--neutral-500)] m-0">
                        Sections: {ch.sectionHeadings.join(" · ")}
                      </p>
                    ) : null}
                    {ch.originalityReport ? (
                      <p className="text-xs font-medium tabular-nums text-[var(--neutral-700)] m-0">
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
                  </div>

                  {!ch.isAutoReferences ? (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {ch.status === "not_started" || ch.status === "needs_attention" ? (
                        <Button
                          type="button"
                          variant={gate.allowed ? "primary" : "secondary"}
                          disabled={!gate.allowed || isBusy}
                          loading={isBusy}
                          loadingLabel="Starting..."
                          title={gate.allowed ? undefined : gate.reason}
                          onClick={() => triggerStart(ch.id)}
                        >
                          {ch.status === "needs_attention"
                            ? `Resume chapter ${ch.number}`
                            : `Start chapter ${ch.number}`}
                        </Button>
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
                            Approve chapter
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
    </div>
  );
}
