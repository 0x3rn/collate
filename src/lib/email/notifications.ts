import { eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { notificationPreferences, users } from "@/db/schema";
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
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: {
        ...prefs,
        updatedAt: now,
      },
    });

  return prefs;
}

export function buildChapterReadyEmail(params: {
  name: string;
  projectTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  chapterUrl: string;
  wordCount: number;
  pageCount: number;
}): Omit<EmailMessage, "to"> {
  const safeName = params.name.trim() || "there";
  return {
    subject: `Chapter ${params.chapterNumber} is ready: ${params.chapterTitle}`,
    text: [
      `Hi ${safeName},`,
      "",
      `Chapter ${params.chapterNumber} ("${params.chapterTitle}") for "${params.projectTitle}" is ready for your review.`,
      `Length: ${params.wordCount.toLocaleString()} words (~${params.pageCount} pages).`,
      "",
      `Open and review Chapter ${params.chapterNumber}:`,
      params.chapterUrl,
      "",
      "You can read, make light edits, download the PDF, or start the next chapter whenever you are ready.",
    ].join("\n"),
    html: `<p>Hi ${escapeHtml(safeName)},</p><p>Chapter ${params.chapterNumber} (<strong>${escapeHtml(params.chapterTitle)}</strong>) for "${escapeHtml(params.projectTitle)}" is ready for your review.</p><p>Length: ${params.wordCount.toLocaleString()} words (~${params.pageCount} pages).</p><p><a href="${escapeHtml(params.chapterUrl)}">Open Chapter ${params.chapterNumber}</a></p><p>Review your similarity report, make edits, download the PDF, or start the next chapter when ready.</p>`,
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
}): Omit<EmailMessage, "to"> {
  const safeName = params.name.trim() || "there";
  const isTechnical = params.kind === "technical_error";

  if (isTechnical) {
    return {
      subject: `Chapter ${params.chapterNumber} paused temporarily: ${params.projectTitle}`,
      text: [
        `Hi ${safeName},`,
        "",
        `Drafting for Chapter ${params.chapterNumber} ("${params.chapterTitle}") in "${params.projectTitle}" paused due to a temporary service issue.`,
        "",
        params.reason,
        "",
        `Open your project to resume Chapter ${params.chapterNumber}:`,
        params.projectUrl,
      ].join("\n"),
      html: `<p>Hi ${escapeHtml(safeName)},</p><p>Drafting for Chapter ${params.chapterNumber} (<strong>${escapeHtml(params.chapterTitle)}</strong>) in "${escapeHtml(params.projectTitle)}" paused due to a temporary service issue.</p><p>${escapeHtml(params.reason)}</p><p><a href="${escapeHtml(params.projectUrl)}">Open project to resume Chapter ${params.chapterNumber}</a></p>`,
    };
  }

  return {
    subject: `Chapter ${params.chapterNumber} needs your input: ${params.projectTitle}`,
    text: [
      `Hi ${safeName},`,
      "",
      `Chapter ${params.chapterNumber} ("${params.chapterTitle}") for "${params.projectTitle}" paused and needs a few details from you before continuing.`,
      `What is needed: ${params.reason}`,
      "",
      "All completed section progress has been saved safely. Open your project to provide details and resume:",
      params.projectUrl,
    ].join("\n"),
    html: `<p>Hi ${escapeHtml(safeName)},</p><p>Chapter ${params.chapterNumber} (<strong>${escapeHtml(params.chapterTitle)}</strong>) for "${escapeHtml(params.projectTitle)}" paused and needs a few details from you before continuing.</p><p><strong>What is needed:</strong> ${escapeHtml(params.reason)}</p><p>All completed progress has been preserved. <a href="${escapeHtml(params.projectUrl)}">Open project to provide details</a></p>`,
  };
}

export function buildProjectCompleteEmail(params: {
  name: string;
  projectTitle: string;
  projectUrl: string;
}): Omit<EmailMessage, "to"> {
  const safeName = params.name.trim() || "there";
  return {
    subject: `Your full project is ready to download: ${params.projectTitle}`,
    text: [
      `Hi ${safeName},`,
      "",
      `All chapters for "${params.projectTitle}" are complete. You can now export the full typeset PDF and editable Word (.docx) document:`,
      params.projectUrl,
    ].join("\n"),
    html: `<p>Hi ${escapeHtml(safeName)},</p><p>All chapters for <strong>${escapeHtml(params.projectTitle)}</strong> are complete.</p><p><a href="${escapeHtml(params.projectUrl)}">Download full project (PDF &amp; Word)</a></p>`,
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
