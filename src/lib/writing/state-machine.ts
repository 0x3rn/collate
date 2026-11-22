import { WRITING_CONFIG } from "@/config/writing";
import type { ChapterStatus } from "@/db/schema";

const ALLOWED_TRANSITIONS: Record<ChapterStatus, ReadonlySet<ChapterStatus>> = {
  not_started: new Set(["queued"]),
  queued: new Set(["writing", "needs_attention"]),
  writing: new Set(["ready", "needs_attention"]),
  ready: new Set(["approved", "queued", "needs_attention"]),
  approved: new Set(["queued"]),
  needs_attention: new Set(["queued"]),
};

export function canTransitionChapterStatus(from: ChapterStatus, to: ChapterStatus): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function assertChapterTransition(from: ChapterStatus, to: ChapterStatus): void {
  if (!canTransitionChapterStatus(from, to)) {
    throw new Error(`Invalid chapter state transition: ${from} -> ${to}`);
  }
}

export interface ChapterGateSummary {
  number: number;
  title: string;
  status: ChapterStatus;
  isAutoReferences: boolean;
}

export interface StartChapterCheck {
  allowed: boolean;
  reason?: string;
}

export function canStartChapter(
  allChapters: ChapterGateSummary[],
  targetNumber: number
): StartChapterCheck {
  const sorted = [...allChapters].sort((a, b) => a.number - b.number);
  const target = sorted.find((c) => c.number === targetNumber);

  if (!target) {
    return { allowed: false, reason: `Chapter ${targetNumber} does not exist in this project.` };
  }

  if (target.isAutoReferences) {
    return {
      allowed: false,
      reason:
        "The References chapter is generated automatically by the citation engine, not written by the LLM.",
    };
  }

  if (target.status === "queued" || target.status === "writing") {
    return { allowed: false, reason: `Chapter ${targetNumber} is already in progress.` };
  }

  const contentChapters = sorted.filter((c) => !c.isAutoReferences);
  const targetIndex = contentChapters.findIndex((c) => c.number === targetNumber);

  if (targetIndex > 0) {
    const prev = contentChapters[targetIndex - 1]!;
    if (prev.status !== "ready" && prev.status !== "approved") {
      return {
        allowed: false,
        reason: `Finish Chapter ${prev.number} ("${prev.title}") before starting Chapter ${targetNumber}. Current status: ${prev.status}.`,
      };
    }
  }

  return { allowed: true };
}

export function isChapterTimedOut(
  startedAt: Date | null | undefined,
  now: Date = new Date(),
  ceilingMs: number = WRITING_CONFIG.limits.chapterCeilingMs
): boolean {
  if (!startedAt) return false;
  return now.getTime() - startedAt.getTime() > ceilingMs;
}
