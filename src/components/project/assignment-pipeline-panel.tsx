"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import {
  InsufficientCreditsModal,
  type InsufficientCreditsDetails,
} from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";
import type { ChapterStatus } from "@/db/schema";

export interface AssignmentQuestionPlanItem {
  questionId: string;
  orderIndex: number;
  questionText: string;
  pageBudget: number;
  wordBudget: number;
  sectionHeadings: string[];
}

export interface AssignmentRunChapterState {
  id: string;
  status: ChapterStatus;
  originalityReport?: {
    passed: boolean;
    overlapScore: number;
    quoteSharePct: number;
    crossUserScore: number;
  } | null;
}

const STATUS_BADGE: Record<ChapterStatus, { label: string; classes: string }> = {
  not_started: {
    label: "Not started",
    classes: "bg-[var(--neutral-100)] text-[var(--neutral-700)] border-[var(--neutral-200)]",
  },
  queued: {
    label: "Queued",
    classes: "bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]",
  },
  writing: {
    label: "Drafting answers",
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

export function AssignmentPipelinePanel({
  projectId,
  questions,
  assignmentChapter,
}: {
  projectId: string;
  questions: AssignmentQuestionPlanItem[];
  assignmentChapter: AssignmentRunChapterState | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [revising, setRevising] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [creditsModal, setCreditsModal] = useState<InsufficientCreditsDetails | null>(null);

  const status: ChapterStatus = assignmentChapter?.status ?? "not_started";
  const badge = STATUS_BADGE[status];
  const isInFlight = status === "queued" || status === "writing";

  useEffect(() => {
    if (!isInFlight) return;
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
  }, [isInFlight, router]);

  async function triggerStartAssignment() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/assignment/start`, {
        method: "POST",
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
            actionLabel: "Drafting this assignment",
            creditsRequired: data.creditsRequired,
            creditsAvailable: data.creditsAvailable,
            message: data.error,
          });
          return;
        }
        toast.error(
          data.error ?? "Could not start assignment drafting.",
          "Could not start assignment"
        );
        return;
      }
      toast.success(
        "Your assignment is queued for drafting. You will receive an email as soon as it is ready to review.",
        "Assignment queued"
      );
      router.refresh();
    } catch {
      toast.error("Network error while starting assignment drafting.", "Connection error");
    } finally {
      setBusy(false);
    }
  }

  async function triggerApprove() {
    if (!assignmentChapter) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${assignmentChapter.id}/approve`,
        { method: "POST" }
      );
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? "Could not approve assignment answers.",
          "Could not approve assignment"
        );
        return;
      }
      toast.success("Download your formatted PDF or Word file below.", "Assignment approved");
      router.refresh();
    } catch {
      toast.error("Network error while approving assignment.", "Connection error");
    } finally {
      setBusy(false);
    }
  }

  async function submitRevision() {
    if (!assignmentChapter) return;
    if (revisionNote.trim().length < 10) {
      toast.error(
        "Describe the requested changes in at least 10 characters.",
        "More detail needed"
      );
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${assignmentChapter.id}/revise`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instructions: revisionNote.trim() }),
        }
      );
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
            actionLabel: "Revising this assignment",
            creditsRequired: data.creditsRequired,
            creditsAvailable: data.creditsAvailable,
            message: data.error,
          });
          return;
        }
        toast.error(
          data.error ?? "Could not queue assignment revision.",
          "Could not request changes"
        );
        return;
      }
      setRevisionNote("");
      setRevising(false);
      toast.success("A new assignment version will be saved when ready.", "Revision queued");
      router.refresh();
    } catch {
      toast.error("Network error while requesting assignment changes.", "Connection error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-medium m-0">
              Assignment answer plan ({questions.length} question
              {questions.length === 1 ? "" : "s"})
            </h2>
            <span
              className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded-[var(--radius-sm)] ${badge.classes}`}
            >
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-[var(--neutral-600)] m-0">
            Each question is answered from its own verified sources and assembled into a single
            cited PDF and Word document.
          </p>
          {assignmentChapter?.originalityReport ? (
            <p className="text-xs font-medium tabular-nums text-[var(--neutral-700)] m-0">
              Similarity report:{" "}
              <span
                className={
                  assignmentChapter.originalityReport.passed
                    ? "text-[var(--success-text)]"
                    : "text-[var(--error-text)]"
                }
              >
                {assignmentChapter.originalityReport.passed ? "Passed" : "Flagged"}
              </span>{" "}
              · Source overlap {assignmentChapter.originalityReport.overlapScore}% · Quotes{" "}
              {assignmentChapter.originalityReport.quoteSharePct}% · Cross-user{" "}
              {assignmentChapter.originalityReport.crossUserScore}%
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {status === "not_started" || status === "needs_attention" ? (
            <Button
              type="button"
              variant="primary"
              disabled={questions.length === 0 || busy}
              loading={busy}
              loadingLabel="Starting..."
              onClick={triggerStartAssignment}
            >
              {status === "needs_attention" ? "Resume assignment" : "Start drafting assignment"}
            </Button>
          ) : null}

          {assignmentChapter && (status === "ready" || status === "approved") ? (
            <>
              <LinkButton
                href={`/projects/${projectId}/chapters/${assignmentChapter.id}`}
                variant="secondary"
              >
                Read / edit answers
              </LinkButton>
              {status === "ready" ? (
                <Button
                  type="button"
                  variant="primary"
                  loading={busy}
                  loadingLabel="Approving..."
                  onClick={triggerApprove}
                >
                  Approve
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={() => setRevising(!revising)}>
                Request changes
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {revising && assignmentChapter ? (
        <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-3">
          <label
            htmlFor="assignment-rev-note"
            className="block text-xs font-medium text-[var(--neutral-800)]"
          >
            What should be revised across your assignment answers?
          </label>
          <textarea
            id="assignment-rev-note"
            rows={3}
            value={revisionNote}
            onChange={(e) => setRevisionNote(e.target.value)}
            placeholder="e.g. Expand Question 2 with additional empirical comparisons and tighten Question 1's opening."
            className="block w-full px-3 py-2 text-sm bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              loading={busy}
              loadingLabel="Queueing revision..."
              onClick={submitRevision}
            >
              Start revision run
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setRevising(false);
                setRevisionNote("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <ol className="space-y-3 list-none p-0 m-0">
        {questions.map((q) => (
          <li
            key={q.questionId}
            className="p-4 border border-[var(--neutral-200)] rounded-[var(--radius-sm)] space-y-1.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
                <span className="tabular-nums font-semibold mr-1.5">Q{q.orderIndex}.</span>
                {q.questionText}
              </p>
              <span className="text-xs text-[var(--neutral-600)] tabular-nums">
                ~{q.pageBudget} pages (~{q.wordBudget.toLocaleString()} words)
              </span>
            </div>
            <p className="text-xs text-[var(--neutral-600)] m-0">
              Sections: {q.sectionHeadings.join(" · ")}
            </p>
          </li>
        ))}
      </ol>

      <InsufficientCreditsModal details={creditsModal} onClose={() => setCreditsModal(null)} />
    </section>
  );
}
