import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  BROADCAST_KINDS,
  emailAssets,
  emailAttachments,
  emailBroadcasts,
  emailMessages,
  emailThreads,
  INBOX_MAILBOXES,
} from "@/db/schema";
import { isAllowedOrigin, jsonNoStore, readSessionTokenFromRequest } from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { getSessionFromToken, type PublicUser } from "@/lib/auth/service";
import { isAdminEmail } from "@/lib/billing/http-handlers";
import {
  countBroadcastRecipients,
  sendBroadcastBatch,
  unsubscribeFromPromotions,
  verifyUnsubscribeToken,
} from "./broadcast";
import type { MailboxConfig } from "./config";
import { type InboxBucket, sendThreadReply, unreadCounts } from "./store";

/**
 * Admin email suite: the Support / Billing / General inboxes (conversations shown as a chat),
 * announcements and promotions, and image uploads for them. Every route requires a signed-in,
 * verified admin (ADMIN_EMAILS); changes also require a same-origin request.
 */

export interface InboxDeps extends HttpAuthDeps {
  bucket: InboxBucket;
  mailboxes: MailboxConfig;
  adminEmails?: string;
  unsubscribeSecret: string;
  broadcastLauncher?: {
    create(opts: { id: string; params: { broadcastId: string } }): Promise<unknown>;
  };
}

async function requireAdmin(
  request: Request,
  deps: InboxDeps,
  mutating: boolean
): Promise<{ ok: true; admin: PublicUser } | { ok: false; response: Response }> {
  if (mutating && !isAllowedOrigin(request, deps.appUrl)) {
    return {
      ok: false,
      response: jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403),
    };
  }
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, deps.appEnv === "prod"),
    deps.nowFn
  );
  if (!session)
    return {
      ok: false,
      response: jsonNoStore({ ok: false, error: "Authentication required." }, 401),
    };
  if (!session.user.emailVerified || !isAdminEmail(session.user.email, deps.adminEmails)) {
    return {
      ok: false,
      response: jsonNoStore({ ok: false, error: "Admin access required." }, 403),
    };
  }
  return { ok: true, admin: session.user };
}

// ── Inbox ───────────────────────────────────────────────────────────────────

export async function handleListThreads(request: Request, deps: InboxDeps): Promise<Response> {
  const gate = await requireAdmin(request, deps, false);
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const mailbox = z.enum(INBOX_MAILBOXES).catch("support").parse(url.searchParams.get("mailbox"));
  const status = z
    .enum(["open", "closed", "all"])
    .catch("open")
    .parse(url.searchParams.get("status"));

  const where =
    status === "all"
      ? eq(emailThreads.mailbox, mailbox)
      : and(eq(emailThreads.mailbox, mailbox), eq(emailThreads.status, status));
  const threads = await deps.db
    .select()
    .from(emailThreads)
    .where(where)
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(200);

  const ids = threads.map((t) => t.id);
  const previews = new Map<string, string>();
  if (ids.length > 0) {
    const msgs = await deps.db
      .select({
        threadId: emailMessages.threadId,
        text: emailMessages.textBody,
        at: emailMessages.createdAt,
      })
      .from(emailMessages)
      .where(inArray(emailMessages.threadId, ids))
      .orderBy(desc(emailMessages.createdAt));
    for (const m of msgs)
      if (!previews.has(m.threadId)) previews.set(m.threadId, m.text.slice(0, 140));
  }

  return jsonNoStore(
    {
      ok: true,
      unread: await unreadCounts(deps.db),
      threads: threads.map((t) => ({
        id: t.id,
        subject: t.subject,
        contactEmail: t.contactEmail,
        contactName: t.contactName,
        hasAccount: Boolean(t.userId),
        status: t.status,
        unread: t.unread,
        lastMessageAt: t.lastMessageAt.toISOString(),
        preview: previews.get(t.id) ?? "",
      })),
    },
    200
  );
}

export async function handleGetThread(
  request: Request,
  threadId: string,
  deps: InboxDeps
): Promise<Response> {
  const gate = await requireAdmin(request, deps, false);
  if (!gate.ok) return gate.response;
  const [thread] = await deps.db
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  if (!thread) return jsonNoStore({ ok: false, error: "Conversation not found." }, 404);

  const messages = await deps.db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.threadId, thread.id))
    .orderBy(asc(emailMessages.createdAt));
  const attachments = messages.length
    ? await deps.db
        .select()
        .from(emailAttachments)
        .where(
          inArray(
            emailAttachments.messageId,
            messages.map((m) => m.id)
          )
        )
    : [];
  if (thread.unread) {
    await deps.db.update(emailThreads).set({ unread: false }).where(eq(emailThreads.id, thread.id));
  }

  return jsonNoStore(
    {
      ok: true,
      thread: {
        id: thread.id,
        mailbox: thread.mailbox,
        subject: thread.subject,
        contactEmail: thread.contactEmail,
        contactName: thread.contactName,
        status: thread.status,
      },
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        from: m.fromAddress,
        senderVerified: m.senderVerified,
        text: m.textBody,
        at: m.createdAt.toISOString(),
        attachments: attachments
          .filter((a) => a.messageId === m.id)
          .map((a) => ({
            id: a.id,
            filename: a.filename,
            contentType: a.contentType,
            size: a.sizeBytes,
          })),
      })),
    },
    200
  );
}

export async function handleReplyToThread(
  request: Request,
  threadId: string,
  deps: InboxDeps
): Promise<Response> {
  const gate = await requireAdmin(request, deps, true);
  if (!gate.ok) return gate.response;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonNoStore({ ok: false, error: "Send the reply as a form." }, 400);
  }
  const text = String(form.get("text") ?? "").slice(0, 20_000);
  const files: Array<{ filename: string; contentType: string; bytes: Uint8Array }> = [];
  for (const entry of form.getAll("files")) {
    if (typeof entry === "string") continue;
    files.push({
      filename: entry.name,
      contentType: entry.type || "application/octet-stream",
      bytes: new Uint8Array(await entry.arrayBuffer()),
    });
  }
  const result = await sendThreadReply(
    { threadId, text, files },
    {
      db: deps.db,
      bucket: deps.bucket,
      mailer: deps.mailer,
      mailboxes: deps.mailboxes,
      now: deps.nowFn?.(),
    }
  );
  if (!result.ok) return jsonNoStore({ ok: false, error: result.error }, result.status);
  return jsonNoStore({ ok: true, messageId: result.messageId }, 200);
}

export async function handleThreadStatus(
  request: Request,
  threadId: string,
  deps: InboxDeps
): Promise<Response> {
  const gate = await requireAdmin(request, deps, true);
  if (!gate.ok) return gate.response;
  const body = z
    .object({ status: z.enum(["open", "closed"]) })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonNoStore({ ok: false, error: "Choose open or closed." }, 400);
  const updated = await deps.db
    .update(emailThreads)
    .set({ status: body.data.status })
    .where(eq(emailThreads.id, threadId))
    .returning({ id: emailThreads.id });
  if (updated.length === 0)
    return jsonNoStore({ ok: false, error: "Conversation not found." }, 404);
  return jsonNoStore({ ok: true }, 200);
}

export async function handleDownloadAttachment(
  request: Request,
  attachmentId: string,
  deps: InboxDeps
): Promise<Response> {
  const gate = await requireAdmin(request, deps, false);
  if (!gate.ok) return gate.response;
  const [att] = await deps.db
    .select()
    .from(emailAttachments)
    .where(eq(emailAttachments.id, attachmentId))
    .limit(1);
  if (!att) return jsonNoStore({ ok: false, error: "File not found." }, 404);
  const obj = await deps.bucket.get(att.r2Key);
  if (!obj) return jsonNoStore({ ok: false, error: "File not found." }, 404);
  const isImage = /^image\/(png|jpe?g|gif|webp)$/i.test(att.contentType);
  return new Response(await obj.arrayBuffer(), {
    status: 200,
    headers: {
      // Only plain images may display inline; everything else downloads, so an attached HTML or
      // SVG file can never run in the admin's session.
      "content-type": isImage ? att.contentType : "application/octet-stream",
      "content-disposition": `${isImage ? "inline" : "attachment"}; filename="${att.filename.replace(/"/g, "")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}

// ── Announcements and promotions ────────────────────────────────────────────

const BroadcastSchema = z.object({
  kind: z.enum(BROADCAST_KINDS),
  subject: z.string().trim().min(3, "Add a subject.").max(200),
  body: z.string().trim().min(10, "Write the message.").max(30_000),
});

export async function handleListBroadcasts(request: Request, deps: InboxDeps): Promise<Response> {
  const gate = await requireAdmin(request, deps, false);
  if (!gate.ok) return gate.response;
  const rows = await deps.db
    .select()
    .from(emailBroadcasts)
    .orderBy(desc(emailBroadcasts.createdAt))
    .limit(100);
  return jsonNoStore(
    {
      ok: true,
      audience: {
        announcement: await countBroadcastRecipients(deps.db, "announcement"),
        promotion: await countBroadcastRecipients(deps.db, "promotion"),
      },
      broadcasts: rows.map((b) => ({
        id: b.id,
        kind: b.kind,
        subject: b.subject,
        status: b.status,
        recipientCount: b.recipientCount,
        sentCount: b.sentCount,
        failedCount: b.failedCount,
        createdAt: b.createdAt.toISOString(),
      })),
    },
    200
  );
}

/** Sends the draft only to the admin, to check how it looks before sending to everyone. */
export async function handleTestBroadcast(request: Request, deps: InboxDeps): Promise<Response> {
  const gate = await requireAdmin(request, deps, true);
  if (!gate.ok) return gate.response;
  const parsed = BroadcastSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return jsonNoStore(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Check the draft." },
      400
    );
  try {
    const result = await sendBroadcastBatch(
      {
        ...parsed.data,
        subject: `[Test] ${parsed.data.subject}`,
        recipients: [{ id: gate.admin.id, email: gate.admin.email, name: gate.admin.name }],
      },
      {
        mailer: deps.mailer,
        mailboxes: deps.mailboxes,
        appUrl: deps.appUrl,
        unsubscribeSecret: deps.unsubscribeSecret,
      }
    );
    if (result.sent !== 1)
      return jsonNoStore(
        { ok: false, error: "The test email was not sent. Check the email settings." },
        502
      );
  } catch (err) {
    return jsonNoStore({ ok: false, error: err instanceof Error ? err.message : "Not sent." }, 500);
  }
  return jsonNoStore({ ok: true, sentTo: gate.admin.email }, 200);
}

export async function handleSendBroadcast(request: Request, deps: InboxDeps): Promise<Response> {
  const gate = await requireAdmin(request, deps, true);
  if (!gate.ok) return gate.response;
  const parsed = BroadcastSchema.extend({ confirm: z.literal(true) }).safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success)
    return jsonNoStore(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Check the draft." },
      400
    );
  if (parsed.data.kind === "promotion" && deps.unsubscribeSecret.length < 16) {
    return jsonNoStore(
      { ok: false, error: "Set EMAIL_UNSUBSCRIBE_SECRET before sending promotions." },
      500
    );
  }
  if (!deps.broadcastLauncher) {
    return jsonNoStore({ ok: false, error: "Bulk sending is not available right now." }, 503);
  }
  const recipientCount = await countBroadcastRecipients(deps.db, parsed.data.kind);
  if (recipientCount === 0) {
    return jsonNoStore({ ok: false, error: "Nobody would receive this yet." }, 400);
  }
  const id = `bc_${crypto.randomUUID()}`;
  const now = (deps.nowFn ?? (() => new Date()))();
  await deps.db.insert(emailBroadcasts).values({
    id,
    kind: parsed.data.kind,
    subject: parsed.data.subject,
    body: parsed.data.body,
    status: "sending",
    recipientCount,
    createdBy: gate.admin.id,
    createdAt: now,
  });
  try {
    await deps.broadcastLauncher.create({ id, params: { broadcastId: id } });
  } catch {
    await deps.db
      .update(emailBroadcasts)
      .set({ status: "failed", finishedAt: now })
      .where(eq(emailBroadcasts.id, id));
    return jsonNoStore({ ok: false, error: "Sending could not start. Try again." }, 502);
  }
  return jsonNoStore({ ok: true, id, recipientCount }, 200);
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Uploads an image for use in an announcement or promotion; returns its public path. */
export async function handleUploadEmailAsset(request: Request, deps: InboxDeps): Promise<Response> {
  const gate = await requireAdmin(request, deps, true);
  if (!gate.ok) return gate.response;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string")
    return jsonNoStore({ ok: false, error: "Choose an image." }, 400);
  if (!IMAGE_TYPES.has(file.type))
    return jsonNoStore({ ok: false, error: "Use a PNG, JPEG, GIF or WebP image." }, 400);
  if (file.size > MAX_IMAGE_BYTES)
    return jsonNoStore({ ok: false, error: "Images must be 5 MB or smaller." }, 400);
  const id = crypto.randomUUID().replace(/-/g, "");
  const r2Key = `email-assets/${id}`;
  await deps.bucket.put(r2Key, new Uint8Array(await file.arrayBuffer()), {
    httpMetadata: { contentType: file.type },
  });
  await deps.db.insert(emailAssets).values({
    id,
    r2Key,
    contentType: file.type,
    sizeBytes: file.size,
    createdAt: (deps.nowFn ?? (() => new Date()))(),
  });
  return jsonNoStore({ ok: true, url: `/email-assets/${id}` }, 200);
}

// ── Public: images and unsubscribe ─────────────────────────────────────────

export async function handleServeEmailAsset(
  id: string,
  deps: Pick<InboxDeps, "db" | "bucket">
): Promise<Response> {
  if (!/^[a-f0-9]{32}$/.test(id)) return new Response("Not found", { status: 404 });
  const [asset] = await deps.db.select().from(emailAssets).where(eq(emailAssets.id, id)).limit(1);
  if (!asset || !IMAGE_TYPES.has(asset.contentType))
    return new Response("Not found", { status: 404 });
  const obj = await deps.bucket.get(asset.r2Key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(await obj.arrayBuffer(), {
    headers: {
      "content-type": asset.contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}

function unsubscribePage(title: string, message: string): Response {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f5f2;margin:0;padding:48px 16px;color:#1f2937"><div style="max-width:440px;margin:0 auto"><h1 style="font-size:22px;font-weight:600">${esc(title)}</h1><p style="line-height:1.6">${esc(message)}</p><p><a href="/account" style="color:#1e3a5f">Manage email settings</a></p></div></body></html>`,
    {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    }
  );
}

/** GET (link click) and POST (one-click from the mail app) both unsubscribe from promotions. */
export async function handleUnsubscribe(
  request: Request,
  deps: Pick<InboxDeps, "db" | "unsubscribeSecret" | "nowFn">
): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const userId =
    deps.unsubscribeSecret.length >= 16
      ? await verifyUnsubscribeToken(token, deps.unsubscribeSecret)
      : null;
  if (!userId)
    return unsubscribePage(
      "Link not valid",
      "This unsubscribe link is not valid. You can change your email settings from your account."
    );
  await unsubscribeFromPromotions(deps.db, userId, (deps.nowFn ?? (() => new Date()))());
  if (request.method === "POST") return new Response(null, { status: 204 });
  return unsubscribePage(
    "You are unsubscribed",
    "You will no longer get news and offers from Collate. Account emails such as receipts still arrive."
  );
}
