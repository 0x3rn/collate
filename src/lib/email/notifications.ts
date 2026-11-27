import { eq, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { auditLog, notificationPreferences, users } from "@/db/schema";
import { escapeHtml } from "@/lib/export/templates";
import type { EmailMessage, EmailSender, EmailSendResult } from "./mailer";

export interface NotificationPrefs {
  emailChapterReady: boolean;
  emailNeedsAttention: boolean;
  emailProjectComplete: boolean;
  emailReceipts: boolean;
  /** Promotions and offers; off unless the user opts in. */
  emailMarketing: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  emailChapterReady: true,
  emailNeedsAttention: true,
  emailProjectComplete: true,
  emailReceipts: true,
  emailMarketing: false,
};

export async function getUserNotificationPrefs(
  db: AppDb,
  userId: string
): Promise<NotificationPrefs> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  if (!row) return { ...DEFAULT_NOTIFICATION_PREFS };
  return {
    emailChapterReady: row.emailChapterReady,
    emailNeedsAttention: row.emailNeedsAttention,
    emailProjectComplete: row.emailProjectComplete,
    emailReceipts: row.emailReceipts,
    emailMarketing: row.emailMarketing,
  };
}

export async function updateUserNotificationPrefs(
  db: AppDb,
  userId: string,
  prefs: NotificationPrefs,
  now: Date = new Date()
): Promise<NotificationPrefs> {
  await db
    .insert(notificationPreferences)
    .values({
      userId,
      ...prefs,
      marketingPromptSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: {
        ...prefs,
        marketingPromptSeenAt: sql`coalesce(${notificationPreferences.marketingPromptSeenAt}, ${now.getTime()})`,
        updatedAt: now,
      },
    });

  return prefs;
}

/**
 * Returns true once for accounts that have neither opted in to product news/offers
 * nor dismissed the dashboard updates prompt yet.
 */
export async function shouldShowMarketingPrompt(db: AppDb, userId: string): Promise<boolean> {
  const [row] = await db
    .select({
      emailMarketing: notificationPreferences.emailMarketing,
      marketingPromptSeenAt: notificationPreferences.marketingPromptSeenAt,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  if (!row) return true;
  return !row.emailMarketing && !row.marketingPromptSeenAt;
}

/**
 * Records a user's one-time response to the dashboard product-updates opt-in prompt.
 * Preserves existing transactional notification preferences when a row already exists.
 */
export async function recordMarketingPromptChoice(
  db: AppDb,
  userId: string,
  optIn: boolean,
  now: Date = new Date()
): Promise<{ emailMarketing: boolean; seenAt: Date }> {
  await db
    .insert(notificationPreferences)
    .values({
      userId,
      ...DEFAULT_NOTIFICATION_PREFS,
      emailMarketing: optIn,
      marketingPromptSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: {
        emailMarketing: optIn,
        marketingPromptSeenAt: now,
        updatedAt: now,
      },
    });

  await db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: userId,
    action: "account.marketing_prompt_responded",
    entityType: "user",
    entityId: userId,
    metadataJson: JSON.stringify({ optIn }),
    createdAt: now,
  });

  return { emailMarketing: optIn, seenAt: now };
}

export function buildChapterReadyEmail(params: {
  name: string;
  projectTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  chapterUrl: string;
  wordCount: number;
  pageCount: number;
  useChapters?: boolean;
}): Omit<EmailMessage, "to"> {
  const safeName = params.name.trim() || "there";
  const useChapters = params.useChapters ?? true;
  const unitLabel = useChapters
    ? `Chapter ${params.chapterNumber}`
    : `Section ${params.chapterNumber}`;
  const unitLower = useChapters ? "chapter" : "section";
  return {
    subject: `${unitLabel} is ready: ${params.chapterTitle}`,
    text: [
      `Hi ${safeName},`,
      "",
      `${unitLabel} ("${params.chapterTitle}") for "${params.projectTitle}" is ready for your review.`,
      `Length: ${params.wordCount.toLocaleString()} words (~${params.pageCount} pages).`,
      "",
      `Open and review ${unitLabel}:`,
      params.chapterUrl,
      "",
      `You can read, make light edits, download the PDF, or start the next ${unitLower} whenever you are ready.`,
    ].join("\n"),
    html: `<p>Hi ${escapeHtml(safeName)},</p><p>${escapeHtml(unitLabel)} (<strong>${escapeHtml(params.chapterTitle)}</strong>) for "${escapeHtml(params.projectTitle)}" is ready for your review.</p><p>Length: ${params.wordCount.toLocaleString()} words (~${params.pageCount} pages).</p><p><a href="${escapeHtml(params.chapterUrl)}">Open ${escapeHtml(unitLabel)}</a></p><p>Review your similarity report, make edits, download the PDF, or start the next ${unitLower} when ready.</p>`,
  };
}

export function buildChapterNeedsAttentionEmail(params: {
  name: string;
  projectTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  projectUrl: string;
  reason: string;
  kind?: "technical_error" | "user_input_required";
  useChapters?: boolean;
}): Omit<EmailMessage, "to"> {
  const safeName = params.name.trim() || "there";
  const isTechnical = params.kind === "technical_error";
  const useChapters = params.useChapters ?? true;
  const unitLabel = useChapters
    ? `Chapter ${params.chapterNumber}`
    : `Section ${params.chapterNumber}`;

  if (isTechnical) {
    return {
      subject: `${unitLabel} paused temporarily: ${params.projectTitle}`,
      text: [
        `Hi ${safeName},`,
        "",
        `Drafting for ${unitLabel} ("${params.chapterTitle}") in "${params.projectTitle}" paused due to a temporary service issue.`,
        "",
        params.reason,
        "",
        `Open your workspace to resume ${unitLabel}:`,
        params.projectUrl,
      ].join("\n"),
      html: `<p>Hi ${escapeHtml(safeName)},</p><p>Drafting for ${escapeHtml(unitLabel)} (<strong>${escapeHtml(params.chapterTitle)}</strong>) in "${escapeHtml(params.projectTitle)}" paused due to a temporary service issue.</p><p>${escapeHtml(params.reason)}</p><p><a href="${escapeHtml(params.projectUrl)}">Open workspace to resume ${escapeHtml(unitLabel)}</a></p>`,
    };
  }

  return {
    subject: `${unitLabel} needs your input: ${params.projectTitle}`,
    text: [
      `Hi ${safeName},`,
      "",
      `${unitLabel} ("${params.chapterTitle}") for "${params.projectTitle}" paused and needs a few details from you before continuing.`,
      `What is needed: ${params.reason}`,
      "",
      "All completed section progress has been saved safely. Open your workspace to provide details and resume:",
      params.projectUrl,
    ].join("\n"),
    html: `<p>Hi ${escapeHtml(safeName)},</p><p>${escapeHtml(unitLabel)} (<strong>${escapeHtml(params.chapterTitle)}</strong>) for "${escapeHtml(params.projectTitle)}" paused and needs a few details from you before continuing.</p><p><strong>What is needed:</strong> ${escapeHtml(params.reason)}</p><p>All completed progress has been preserved. <a href="${escapeHtml(params.projectUrl)}">Open workspace to provide details</a></p>`,
  };
}

export function buildProjectCompleteEmail(params: {
  name: string;
  projectTitle: string;
  projectUrl: string;
  workTypeLabel?: string;
  useChapters?: boolean;
}): Omit<EmailMessage, "to"> {
  const safeName = params.name.trim() || "there";
  const workNoun = (params.workTypeLabel ?? "project").toLowerCase();
  const unitsLower = params.useChapters === false ? "sections" : "chapters";
  return {
    subject: `Your full ${workNoun} is ready to download: ${params.projectTitle}`,
    text: [
      `Hi ${safeName},`,
      "",
      `All ${unitsLower} for "${params.projectTitle}" are complete. You can now export the full typeset PDF and editable Word (.docx) document:`,
      params.projectUrl,
    ].join("\n"),
    html: `<p>Hi ${escapeHtml(safeName)},</p><p>All ${unitsLower} for <strong>${escapeHtml(params.projectTitle)}</strong> are complete.</p><p><a href="${escapeHtml(params.projectUrl)}">Download full ${escapeHtml(workNoun)} (PDF &amp; Word)</a></p>`,
  };
}

export function buildPaymentReceiptEmail(params: {
  name: string;
  amountFormatted: string;
  creditsAdded: number;
  reference: string;
  accountUrl: string;
}): Omit<EmailMessage, "to"> {
  const safeName = params.name.trim() || "there";
  return {
    subject: `Collate receipt: ${params.creditsAdded} credits added`,
    text: [
      `Hi ${safeName},`,
      "",
      `Payment received: ${params.amountFormatted}`,
      `Credits added: ${params.creditsAdded}`,
      `Reference: ${params.reference}`,
      "",
      `View your balance: ${params.accountUrl}`,
    ].join("\n"),
    html: `<p>Hi ${escapeHtml(safeName)},</p><p>Your payment of <strong>${escapeHtml(params.amountFormatted)}</strong> was confirmed.</p><p>Credits added: <strong>${params.creditsAdded}</strong> · Reference: <code>${escapeHtml(params.reference)}</code></p><p><a href="${escapeHtml(params.accountUrl)}">View your account</a></p>`,
  };
}

export type NotificationKind = "chapter_ready" | "needs_attention" | "project_complete" | "receipt";

export async function dispatchUserNotification(
  db: AppDb,
  mailer: EmailSender,
  params: {
    userId: string;
    kind: NotificationKind;
    message: Omit<EmailMessage, "to">;
  }
): Promise<{ sent: boolean; skippedByPreference?: boolean; result?: EmailSendResult }> {
  const [user] = await db.select().from(users).where(eq(users.id, params.userId)).limit(1);
  if (!user) return { sent: false };

  const prefs = await getUserNotificationPrefs(db, user.id);
  const allowed =
    (params.kind === "chapter_ready" && prefs.emailChapterReady) ||
    (params.kind === "needs_attention" && prefs.emailNeedsAttention) ||
    (params.kind === "project_complete" && prefs.emailProjectComplete) ||
    (params.kind === "receipt" && prefs.emailReceipts);

  if (!allowed) {
    return { sent: false, skippedByPreference: true };
  }

  const result = await mailer.send({ to: user.email, ...params.message });
  if (!result.ok) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "user_notification_email_failed",
        userId: user.id,
        kind: params.kind,
        provider: result.provider,
        error: result.error,
      })
    );
  }
  return { sent: result.ok, result };
}
