import { and, eq, gt, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { type BroadcastKind, notificationPreferences, users } from "@/db/schema";
import { escapeEmailHtml } from "@/lib/email/layout";
import type { EmailSender } from "@/lib/email/mailer";
import { renderBroadcastHtml, renderBroadcastText } from "./broadcast-format";
import { type MailboxConfig, senderFor } from "./config";

export { renderBroadcastHtml, renderBroadcastText };

/**
 * Announcements and promotions.
 *
 * The body is written in a small, safe formatting language (the composer's toolbar inserts it):
 *   **bold**  *italic*  [link text](https://…)  ![image description](https://… or /email-assets/…)
 *   "## " heading, "- " list item, blank line between paragraphs.
 * Everything else is escaped, so the result can never contain scripts or arbitrary HTML.
 *
 * Announcements go to every verified account (service news). Promotions go only to people who
 * opted in to "News and offers", each with a personal one-click unsubscribe link.
 */

// ── Unsubscribe links (HMAC-signed, no login needed) ─────────────────────────

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  let binary = "";
  for (const b of sig) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function createUnsubscribeToken(userId: string, secret: string): Promise<string> {
  return `${userId}.${await hmac(secret, `unsubscribe:${userId}`)}`;
}

export async function verifyUnsubscribeToken(
  token: string,
  secret: string
): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const expected = await hmac(secret, `unsubscribe:${userId}`);
  const given = token.slice(dot + 1);
  if (given.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? userId : null;
}

export async function unsubscribeFromPromotions(
  db: AppDb,
  userId: string,
  now: Date
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({ userId, emailMarketing: false, updatedAt: now })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { emailMarketing: false, updatedAt: now },
    });
}

// ── Recipients and sending ───────────────────────────────────────────────────

export interface Recipient {
  id: string;
  email: string;
  name: string;
}

/** Recipients after a given user id (for batching), ordered by id. */
export async function listBroadcastRecipients(
  db: AppDb,
  kind: BroadcastKind,
  options: { afterId?: string; limit?: number } = {}
): Promise<Recipient[]> {
  const conditions = [eq(users.emailVerified, true)];
  if (options.afterId) conditions.push(gt(users.id, options.afterId));
  const base = db.select({ id: users.id, email: users.email, name: users.name }).from(users);
  const query =
    kind === "promotion"
      ? base
          .innerJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
          .where(and(...conditions, eq(notificationPreferences.emailMarketing, true)))
      : base.where(and(...conditions));
  return query.orderBy(users.id).limit(options.limit ?? 1000);
}

export async function countBroadcastRecipients(db: AppDb, kind: BroadcastKind): Promise<number> {
  if (kind === "promotion") {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .innerJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
      .where(and(eq(users.emailVerified, true), eq(notificationPreferences.emailMarketing, true)));
    return Number(row?.n ?? 0);
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.emailVerified, true));
  return Number(row?.n ?? 0);
}

/** Sends one broadcast to a batch of recipients; returns how many were sent and failed. */
export async function sendBroadcastBatch(
  params: {
    kind: BroadcastKind;
    subject: string;
    body: string;
    recipients: Recipient[];
  },
  deps: { mailer: EmailSender; mailboxes: MailboxConfig; appUrl: string; unsubscribeSecret: string }
): Promise<{ sent: number; failed: number }> {
  if (params.kind === "promotion" && deps.unsubscribeSecret.length < 16) {
    throw new Error(
      "Promotions need EMAIL_UNSUBSCRIBE_SECRET (or EXPORT_SIGNING_SECRET) for unsubscribe links."
    );
  }
  const root = deps.appUrl.replace(/\/+$/, "");
  const html = renderBroadcastHtml(params.body, root);
  const text = renderBroadcastText(params.body, root);
  let sent = 0;
  let failed = 0;
  for (const r of params.recipients) {
    const greeting = `Hi ${r.name.trim() || "there"},`;
    let footerHtml = "";
    let footerText = "";
    const headers: Record<string, string> = {};
    if (params.kind === "promotion") {
      const token = await createUnsubscribeToken(r.id, deps.unsubscribeSecret);
      const url = `${root}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
      footerHtml = `<p style="margin:22px 0 0 0;font-size:12px;color:#6b7280;">You get this because you opted in to news and offers. <a href="${escapeEmailHtml(url)}" style="color:#6b7280;">Unsubscribe</a></p>`;
      footerText = `\n\nYou get this because you opted in to news and offers. Unsubscribe: ${url}`;
      headers["List-Unsubscribe"] = `<${url}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    const result = await deps.mailer.send({
      to: r.email,
      from: senderFor(params.kind, deps.mailboxes),
      replyTo: deps.mailboxes.general,
      subject: params.subject,
      text: `${greeting}\n\n${text}${footerText}`,
      html: `<p style="margin:0 0 14px 0;">${escapeEmailHtml(greeting)}</p>${html}${footerHtml}`,
      headers,
    });
    if (result.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}
