import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { auditLog, originalityReports } from "@/db/schema";

export type ChapterAttentionKind = "technical_error" | "user_input_required";

export type ChapterAttentionInputType =
  "none" | "originality_guidance" | "results_data" | "general_details";

export interface ChapterAttentionInfo {
  kind: ChapterAttentionKind;
  inputType: ChapterAttentionInputType;
  title: string;
  userMessage: string;
  /** Prompt shown inside the "Provide Details" modal when kind === "user_input_required". */
  promptLabel?: string;
  /** Whether the modal should also offer CSV dataset upload (e.g. Results chapter). */
  allowCsvUpload?: boolean;
}

export const MASKED_TECHNICAL_UI_TITLE = "Drafting paused temporarily";

export const MASKED_TECHNICAL_UI_MESSAGE =
  "We ran into a temporary service issue while drafting this chapter. Your saved progress is intact and any reserved credits have been refunded. Please resume to try again.";

export function buildTechnicalErrorAttention(): ChapterAttentionInfo {
  return {
    kind: "technical_error",
    inputType: "none",
    title: MASKED_TECHNICAL_UI_TITLE,
    userMessage: MASKED_TECHNICAL_UI_MESSAGE,
  };
}

export function buildOriginalityAttention(params: {
  overlapScore?: number;
  quoteSharePct?: number;
  semanticScore?: number;
  crossUserScore?: number;
}): ChapterAttentionInfo {
  const details: string[] = [];
  if (typeof params.overlapScore === "number" && params.overlapScore > 0) {
    details.push(`matched source text ${params.overlapScore}%`);
  }
  if (typeof params.quoteSharePct === "number" && params.quoteSharePct > 0) {
    details.push(`direct quotes ${params.quoteSharePct}%`);
  }
  if (typeof params.crossUserScore === "number" && params.crossUserScore > 0) {
    details.push(`wording shared with other projects ${params.crossUserScore}%`);
  }
  if (
    details.length === 0 &&
    typeof params.semanticScore === "number" &&
    params.semanticScore > 0
  ) {
    details.push(`similar wording ${Math.round(params.semanticScore)}%`);
  }

  const scoreDetail = details.length > 0 ? ` (${details.join(", ")})` : "";
  return {
    kind: "user_input_required",
    inputType: "originality_guidance",
    title: "Needs your input to refine wording",
    userMessage: `Our similarity check found phrases that sit too close to the original sources${scoreDetail}. Tell us what to keep or reframe, then resume.`,
    promptLabel: "Guidance for rewriting (angle, emphasis, or specific points to focus on)",
    allowCsvUpload: false,
  };
}

export function buildResultsDataAttention(): ChapterAttentionInfo {
  return {
    kind: "user_input_required",
    inputType: "results_data",
    title: "Results data or notes needed",
    userMessage:
      "Upload a CSV file from your survey or lab work, or share brief notes on the findings you want discussed, then resume drafting.",
    promptLabel: "Notes on your findings or preferred structure (optional if uploading a CSV)",
    allowCsvUpload: true,
  };
}

/**
 * Classifies an unexpected workflow/runtime error into a safe, user-facing attention payload.
 * Raw technical details (Cloudflare subrequest limits, LLM provider errors, HTTP codes, stack traces)
 * are NEVER exposed in user-facing copy or emails.
 */
export function classifyChapterRuntimeError(err: unknown): {
  attention: ChapterAttentionInfo;
  internalReason: string;
} {
  const internalReason =
    err instanceof Error ? err.message.slice(0, 400) : String(err ?? "Unknown workflow error");

  if (/24-hour execution ceiling/i.test(internalReason)) {
    return {
      attention: {
        kind: "technical_error",
        inputType: "none",
        title: "Drafting paused after time limit",
        userMessage:
          "This chapter took longer than expected and paused automatically. All completed sections were saved and your reserved credits were refunded. Click Resume to pick up where it left off.",
      },
      internalReason,
    };
  }

  return {
    attention: buildTechnicalErrorAttention(),
    internalReason,
  };
}

export async function recordChapterNeedsAttentionAudit(
  db: AppDb,
  params: {
    userId?: string | null;
    projectId: string;
    chapterId: string;
    attention: ChapterAttentionInfo;
    internalReason?: string;
    now?: Date;
  }
): Promise<void> {
  await db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: params.userId ?? null,
    action: "chapter.needs_attention",
    entityType: "chapter",
    entityId: params.chapterId,
    metadataJson: JSON.stringify({
      projectId: params.projectId,
      kind: params.attention.kind,
      inputType: params.attention.inputType,
      title: params.attention.title,
      userMessage: params.attention.userMessage,
      promptLabel: params.attention.promptLabel ?? null,
      allowCsvUpload: Boolean(params.attention.allowCsvUpload),
      // Stored strictly for server-side troubleshooting; never rendered to end users
      internalReason: params.internalReason?.slice(0, 400) ?? null,
    }),
    createdAt: params.now ?? new Date(),
  });
}

interface StoredAttentionMetadata {
  kind?: ChapterAttentionKind;
  inputType?: ChapterAttentionInputType;
  title?: string;
  userMessage?: string;
  promptLabel?: string | null;
  allowCsvUpload?: boolean;
}

/**
 * Loads safe, user-facing attention metadata for chapters currently in `needs_attention`.
 * Falls back cleanly for legacy chapters paused before structured audit entries existed.
 */
export async function loadChapterAttentionMap(
  db: AppDb,
  chaptersNeedingAttention: Array<{ id: string; chapterType?: string | null }>
): Promise<Map<string, ChapterAttentionInfo>> {
  const result = new Map<string, ChapterAttentionInfo>();
  if (chaptersNeedingAttention.length === 0) return result;

  const chapterIds = chaptersNeedingAttention.map((c) => c.id);

  const [auditRows, reportRows] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "chapter.needs_attention"),
          eq(auditLog.entityType, "chapter"),
          inArray(auditLog.entityId, chapterIds)
        )
      )
      .orderBy(desc(auditLog.createdAt)),
    db
      .select()
      .from(originalityReports)
      .where(inArray(originalityReports.chapterId, chapterIds))
      .orderBy(desc(originalityReports.createdAt)),
  ]);

  const latestAuditByChapter = new Map<string, (typeof auditRows)[number]>();
  for (const row of auditRows) {
    if (!latestAuditByChapter.has(row.entityId)) {
      latestAuditByChapter.set(row.entityId, row);
    }
  }

  const latestReportByChapter = new Map<string, (typeof reportRows)[number]>();
  for (const rep of reportRows) {
    if (!latestReportByChapter.has(rep.chapterId)) {
      latestReportByChapter.set(rep.chapterId, rep);
    }
  }

  for (const ch of chaptersNeedingAttention) {
    const audit = latestAuditByChapter.get(ch.id);
    if (audit?.metadataJson) {
      try {
        const parsed = JSON.parse(audit.metadataJson) as StoredAttentionMetadata;
        if (
          (parsed.kind === "technical_error" || parsed.kind === "user_input_required") &&
          typeof parsed.title === "string" &&
          typeof parsed.userMessage === "string"
        ) {
          result.set(ch.id, {
            kind: parsed.kind,
            inputType:
              parsed.inputType ?? (parsed.kind === "technical_error" ? "none" : "general_details"),
            title: parsed.title,
            userMessage: parsed.userMessage,
            promptLabel: parsed.promptLabel ?? undefined,
            allowCsvUpload: Boolean(parsed.allowCsvUpload) || ch.chapterType === "results",
          });
          continue;
        }
      } catch {
        // Fall through to deterministic fallback below
      }
    }

    const latestReport = latestReportByChapter.get(ch.id);
    if (latestReport && !latestReport.passed) {
      result.set(
        ch.id,
        buildOriginalityAttention({
          overlapScore: latestReport.overlapScore,
          quoteSharePct: latestReport.quoteSharePct,
          semanticScore: latestReport.semanticScore,
          crossUserScore: latestReport.crossUserScore,
        })
      );
      continue;
    }

    result.set(ch.id, buildTechnicalErrorAttention());
  }

  return result;
}
