import { and, desc, eq, inArray, sql } from "drizzle-orm";
import PostalMime from "postal-mime";
import type { AppDb } from "@/db/client";
import {
  emailAttachments,
  emailMessages,
  emailThreads,
  type InboxMailbox,
  users,
} from "@/db/schema";
import { escapeEmailHtml } from "@/lib/email/layout";
import type { EmailAttachment, EmailSender } from "@/lib/email/mailer";
import type { AdminNotifier } from "@/lib/notify/admin-alerts";
import { escapeTelegramHtml } from "@/lib/notify/admin-alerts";
import { logEvent } from "@/lib/observability/logger";
import { type MailboxConfig, MAILBOX_LABELS, mailboxForRecipient, senderFor } from "./config";

export interface InboxBucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** "Re: Re:  Fwd: Hello" -> "hello", for matching a reply to its thread. */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^\s*((re|fw|fwd|aw|sv)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Keeps only the new part of a reply, dropping the quoted earlier message. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex(
    (line, i) =>
      /^On .+wrote:\s*$/.test(line.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim()) ||
      (/^From:\s/.test(line.trim()) && i > 0 && lines[i - 1]!.trim() === "") ||
      (line.startsWith(">") && lines.slice(i).every((l) => l.startsWith(">") || l.trim() === ""))
  );
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).join("\n").trim();
  return kept || text.trim();
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeFilename(name: string | null | undefined): string {
  const cleaned = (name ?? "attachment")
    .replace(/[^\w.\- ]+/g, "_")
    .trim()
    .slice(0, 120);
  return cleaned || "attachment";
}

function domainOf(address: string): string {
  return (address.trim().toLowerCase().split("@")[1] ?? "").replace(/>$/, "");
}

/**
 * True when the visible From address and the envelope sender (checked by the receiving server)
 * share a domain, or the envelope is a subdomain of it (as with mail services’ bounce addresses).
 */
export function senderMatchesEnvelope(headerFrom: string, envelopeFrom: string): boolean {
  const header = domainOf(headerFrom);
  const envelope = domainOf(envelopeFrom);
  if (!header || !envelope) return false;
  return envelope === header || envelope.endsWith(`.${header}`);
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function saveAttachments(
  db: AppDb,
  bucket: InboxBucket,
  params: {
    threadId: string;
    messageId: string;
    files: Array<{ filename: string; contentType: string; bytes: Uint8Array }>;
    now: Date;
  }
): Promise<number> {
  let saved = 0;
  for (const file of params.files.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
    if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_ATTACHMENT_BYTES) continue;
    const id = newId("att");
    const filename = safeFilename(file.filename);
    const r2Key = `inbox/${params.threadId}/${params.messageId}/${id}-${filename}`;
    await bucket.put(r2Key, file.bytes, { httpMetadata: { contentType: file.contentType } });
    await db.insert(emailAttachments).values({
      id,
      messageId: params.messageId,
      filename,
      contentType: file.contentType.slice(0, 120) || "application/octet-stream",
      sizeBytes: file.bytes.byteLength,
      r2Key,
      createdAt: params.now,
    });
    saved++;
  }
  return saved;
}

export interface InboundMessage {
  /** Envelope sender. */
  from: string;
  /** Envelope recipient (one of our addresses). */
  to: string;
  raw: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string;
}

/**
 * Stores an incoming email in the right inbox tab. A reply joins its existing conversation
 * (by In-Reply-To / References, then by sender and subject); anything else starts a new one.
 */
export async function receiveInboundEmail(
  message: InboundMessage,
  deps: {
    db: AppDb;
    bucket: InboxBucket;
    mailboxes: MailboxConfig;
    notifier?: AdminNotifier | null;
    now?: Date;
  }
): Promise<{ threadId: string; mailbox: InboxMailbox; isNewThread: boolean }> {
  const now = deps.now ?? new Date();
  const parsed = await PostalMime.parse(message.raw as Parameters<typeof PostalMime.parse>[0]);
  const mailbox = mailboxForRecipient(message.to, deps.mailboxes);
  const fromEmail = (parsed.from?.address ?? message.from).trim().toLowerCase();
  const fromName = parsed.from?.name?.trim() || null;
  const subject = (parsed.subject ?? "").trim().slice(0, 300) || "(no subject)";
  const bodyRaw = parsed.text?.trim() || (parsed.html ? htmlToPlainText(parsed.html) : "");
  const textBody = stripQuotedReply(bodyRaw).slice(0, 50_000);
  const messageIdHeader = parsed.messageId?.trim() || null;
  const senderVerified = senderMatchesEnvelope(fromEmail, message.from);

  // Thread lookup: the message ids this email says it replies to.
  const refs = [parsed.inReplyTo, ...(parsed.references ?? "").split(/\s+/)]
    .map((r) => r?.trim())
    .filter((r): r is string => Boolean(r));
  // A sender we cannot confirm never joins an existing conversation, so a forged "From" line
  // cannot slip a message into someone else’s thread.
  let threadId: string | null = null;
  if (senderVerified && refs.length > 0) {
    const [match] = await deps.db
      .select({ threadId: emailMessages.threadId })
      .from(emailMessages)
      .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
      .where(
        and(inArray(emailMessages.messageIdHeader, refs), eq(emailThreads.contactEmail, fromEmail))
      )
      .limit(1);
    threadId = match?.threadId ?? null;
  }
  if (senderVerified && !threadId) {
    const recent = await deps.db
      .select({ id: emailThreads.id, subject: emailThreads.subject })
      .from(emailThreads)
      .where(and(eq(emailThreads.contactEmail, fromEmail), eq(emailThreads.mailbox, mailbox)))
      .orderBy(desc(emailThreads.lastMessageAt))
      .limit(20);
    threadId =
      recent.find((t) => normalizeSubject(t.subject) === normalizeSubject(subject))?.id ?? null;
  }

  const isNewThread = !threadId;
  if (!threadId) {
    const [account] = await deps.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, fromEmail))
      .limit(1);
    threadId = newId("thr");
    await deps.db.insert(emailThreads).values({
      id: threadId,
      mailbox,
      subject,
      contactEmail: fromEmail,
      contactName: fromName,
      userId: senderVerified ? (account?.id ?? null) : null,
      status: "open",
      unread: true,
      lastMessageAt: now,
      createdAt: now,
    });
  } else {
    await deps.db
      .update(emailThreads)
      .set({ unread: true, status: "open", lastMessageAt: now })
      .where(eq(emailThreads.id, threadId));
  }

  const messageId = newId("msg");
  await deps.db.insert(emailMessages).values({
    id: messageId,
    threadId,
    direction: "inbound",
    fromAddress: fromEmail,
    toAddress: message.to.trim().toLowerCase(),
    subject,
    textBody,
    messageIdHeader,
    senderVerified,
    createdAt: now,
  });

  const files = (parsed.attachments ?? [])
    .filter((a) => a.disposition !== "inline" || !a.contentId)
    .map((a) => ({
      filename: a.filename ?? "attachment",
      contentType: a.mimeType ?? "application/octet-stream",
      bytes:
        typeof a.content === "string"
          ? new TextEncoder().encode(a.content)
          : new Uint8Array(a.content as ArrayBuffer),
    }));
  await saveAttachments(deps.db, deps.bucket, { threadId, messageId, files, now });

  if (deps.notifier) {
    await deps.notifier.send(
      [
        `📨 <b>New email · ${escapeTelegramHtml(MAILBOX_LABELS[mailbox])}</b>`,
        `From: ${escapeTelegramHtml(fromName ? `${fromName} <${fromEmail}>` : fromEmail)}`,
        `Subject: ${escapeTelegramHtml(subject)}`,
        escapeTelegramHtml(textBody.slice(0, 280)),
      ].join("\n")
    );
  }

  return { threadId, mailbox, isNewThread };
}

function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeEmailHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export interface QuotedMessage {
  author: string;
  at: Date;
  text: string;
}

const MAX_QUOTED_MESSAGES = 10;

function quoteHeader(m: QuotedMessage): string {
  const when = m.at.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `On ${when} UTC, ${m.author} wrote:`;
}

/**
 * The earlier messages under a reply, the way mail apps quote them: the newest first, each
 * older one nested inside it. Gmail and Outlook fold this away behind "…" automatically.
 * `history` is newest first.
 */
export function buildQuotedHistory(history: QuotedMessage[]): { text: string; html: string } {
  const chain = history.slice(0, MAX_QUOTED_MESSAGES).reverse(); // oldest first
  let text = "";
  let html = "";
  for (const m of chain) {
    const quotedText = text ? `${m.text}\n\n${text}` : m.text;
    const quotedLines = quotedText
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
    text = `${quoteHeader(m)}\n${quotedLines}`;
    html = `<div class="gmail_quote"><div class="gmail_attr" style="color:#6b7280;font-size:13px;margin:18px 0 6px 0;">${escapeEmailHtml(quoteHeader(m))}</div><blockquote class="gmail_quote" style="margin:0 0 0 0.8ex;border-left:2px solid #d1d5db;padding-left:1ex;color:#4b5563;">${textToHtml(m.text)}${html}</blockquote></div>`;
  }
  return { text, html };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Sends the admin's reply into the conversation, threaded under the person's last email. */
export async function sendThreadReply(
  params: {
    threadId: string;
    text: string;
    files: Array<{ filename: string; contentType: string; bytes: Uint8Array }>;
  },
  deps: {
    db: AppDb;
    bucket: InboxBucket;
    mailer: EmailSender;
    mailboxes: MailboxConfig;
    now?: Date;
  }
): Promise<{ ok: true; messageId: string } | { ok: false; error: string; status: number }> {
  const now = deps.now ?? new Date();
  const [thread] = await deps.db
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.id, params.threadId))
    .limit(1);
  if (!thread) return { ok: false, error: "Conversation not found.", status: 404 };
  const text = params.text.trim();
  if (!text) return { ok: false, error: "Write a reply first.", status: 400 };
  if (params.files.some((f) => f.bytes.byteLength > MAX_ATTACHMENT_BYTES)) {
    return { ok: false, error: "Each attachment must be 10 MB or smaller.", status: 400 };
  }
  if (params.files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, error: "Attach at most 10 files.", status: 400 };
  }

  const history = await deps.db
    .select({
      messageIdHeader: emailMessages.messageIdHeader,
      direction: emailMessages.direction,
      fromAddress: emailMessages.fromAddress,
      textBody: emailMessages.textBody,
      createdAt: emailMessages.createdAt,
    })
    .from(emailMessages)
    .where(eq(emailMessages.threadId, thread.id))
    .orderBy(desc(emailMessages.createdAt))
    .limit(20);
  const ids = history.map((h) => h.messageIdHeader).filter((h): h is string => Boolean(h));
  const sender = senderFor(thread.mailbox, deps.mailboxes);
  const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
  const senderName = sender.replace(/\s*<[^>]*>\s*$/, "").trim() || deps.mailboxes[thread.mailbox];
  const quoted = buildQuotedHistory(
    history.map((h) => ({
      author:
        h.direction === "outbound"
          ? senderName
          : thread.contactName
            ? `${thread.contactName} <${h.fromAddress}>`
            : h.fromAddress,
      at: h.createdAt,
      text: h.textBody,
    }))
  );

  const attachments: EmailAttachment[] = params.files.map((f) => ({
    filename: f.filename,
    content: toBase64(f.bytes),
    type: f.contentType || "application/octet-stream",
  }));
  const result = await deps.mailer.send({
    to: thread.contactEmail,
    from: sender,
    replyTo: deps.mailboxes[thread.mailbox],
    subject,
    text: quoted.text ? `${text}\n\n${quoted.text}` : text,
    html: `${textToHtml(text)}${quoted.html}`,
    // Cloudflare sets Message-ID itself (a custom one is refused); only threading headers here.
    headers: {
      ...(ids[0] ? { "In-Reply-To": ids[0] } : {}),
      ...(ids.length ? { References: ids.slice().reverse().join(" ") } : {}),
    },
    attachments,
  });
  if (!result.ok) {
    logEvent("error", "inbox_reply_failed", { data: { threadId: thread.id, error: result.error } });
    return {
      ok: false,
      error: `The reply was not sent: ${result.error ?? "unknown error"}`,
      status: 502,
    };
  }

  // Keep the Message-ID Cloudflare assigned, so the person’s reply threads back here.
  const sentId = result.messageId?.trim();
  const ourMessageId =
    sentId && !sentId.startsWith("dev_") ? (sentId.startsWith("<") ? sentId : `<${sentId}>`) : null;
  const messageId = newId("msg");
  await deps.db.insert(emailMessages).values({
    id: messageId,
    threadId: thread.id,
    direction: "outbound",
    fromAddress: deps.mailboxes[thread.mailbox],
    toAddress: thread.contactEmail,
    subject,
    textBody: text.slice(0, 50_000),
    messageIdHeader: ourMessageId,
    createdAt: now,
  });
  await saveAttachments(deps.db, deps.bucket, {
    threadId: thread.id,
    messageId,
    files: params.files,
    now,
  });
  await deps.db
    .update(emailThreads)
    .set({ lastMessageAt: now, unread: false })
    .where(eq(emailThreads.id, thread.id));
  return { ok: true, messageId };
}

export async function unreadCounts(db: AppDb): Promise<Record<InboxMailbox, number>> {
  const rows = await db
    .select({ mailbox: emailThreads.mailbox, n: sql<number>`count(*)` })
    .from(emailThreads)
    .where(eq(emailThreads.unread, true))
    .groupBy(emailThreads.mailbox);
  const out: Record<InboxMailbox, number> = { support: 0, billing: 0, general: 0 };
  for (const r of rows) out[r.mailbox] = Number(r.n);
  return out;
}
