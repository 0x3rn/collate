import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import {
  emailAttachments,
  emailBroadcasts,
  emailMessages,
  emailThreads,
  notificationPreferences,
} from "@/db/schema";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyCode,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import {
  countBroadcastRecipients,
  createUnsubscribeToken,
  renderBroadcastHtml,
  sendBroadcastBatch,
  verifyUnsubscribeToken,
} from "@/lib/inbox/broadcast";
import { readMailboxConfig } from "@/lib/inbox/config";
import {
  handleDownloadAttachment,
  handleGetThread,
  handleListThreads,
  handleReplyToThread,
  handleSendBroadcast,
  handleServeEmailAsset,
  handleUnsubscribe,
  handleUploadEmailAsset,
  type InboxDeps,
} from "@/lib/inbox/http-handlers";
import {
  buildQuotedHistory,
  receiveInboundEmail,
  senderMatchesEnvelope,
  sendThreadReply,
  stripQuotedReply,
  type InboxBucket,
} from "@/lib/inbox/store";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const APP = "https://collateresearch.app";
const ADMIN = "boss@collateresearch.app";
const SECRET = "unsubscribe-secret-for-tests-0123456789";
const mailboxes = readMailboxConfig({});

function rawEmail(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
  inReplyTo?: string;
  attachment?: { name: string; type: string; base64: string };
}): string {
  const head = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Message-ID: ${opts.messageId}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`, `References: ${opts.inReplyTo}`] : []),
    "MIME-Version: 1.0",
  ];
  if (!opts.attachment) {
    return [...head, "Content-Type: text/plain; charset=utf-8", "", opts.body, ""].join("\r\n");
  }
  return [
    ...head,
    'Content-Type: multipart/mixed; boundary="b1"',
    "",
    "--b1",
    "Content-Type: text/plain; charset=utf-8",
    "",
    opts.body,
    "--b1",
    `Content-Type: ${opts.attachment.type}; name="${opts.attachment.name}"`,
    `Content-Disposition: attachment; filename="${opts.attachment.name}"`,
    "Content-Transfer-Encoding: base64",
    "",
    opts.attachment.base64,
    "--b1--",
    "",
  ].join("\r\n");
}

describe("admin email inbox", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let stored: Map<string, { bytes: Uint8Array; type?: string }>;
  let alerts: string[];
  let launched: string[];
  let deps: InboxDeps;

  beforeEach(() => {
    d1 = createInMemoryD1();
    d1.applyMigrations();
    db = createDb(d1.d1);
    sent = [];
    stored = new Map();
    alerts = [];
    launched = [];
    const mailer: EmailSender = {
      async send(m) {
        sent.push(m);
        return { ok: true, provider: "console" };
      },
    };
    const bucket: InboxBucket = {
      async put(key, value, options) {
        stored.set(key, {
          bytes: value instanceof Uint8Array ? value : new Uint8Array(value),
          type: options?.httpMetadata?.contentType,
        });
        return null;
      },
      async get(key) {
        const item = stored.get(key);
        if (!item) return null;
        return {
          arrayBuffer: async () => item.bytes.slice().buffer as ArrayBuffer,
          httpMetadata: { contentType: item.type },
        };
      },
    };
    deps = {
      db,
      mailer,
      appUrl: APP,
      appEnv: "prod",
      turnstileSecretKey: "t",
      fetchFn: async () => Response.json({ success: true }),
      bucket,
      mailboxes,
      adminEmails: ADMIN,
      unsubscribeSecret: SECRET,
      broadcastLauncher: {
        async create(opts) {
          launched.push(opts.params.broadcastId);
          return {};
        },
      },
    };
  });
  afterEach(() => d1.close());

  const post = (path: string, body: unknown, cookie = "", origin = APP) =>
    new Request(`${APP}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify(body),
    });
  const get = (path: string, cookie = "") => new Request(`${APP}${path}`, { headers: { cookie } });

  async function account(email: string): Promise<{ cookie: string; userId: string }> {
    const password = "quiet library oak shelf";
    const auth = deps as HttpAuthDeps;
    await handleSignUp(
      post("/api/auth/signup", {
        name: "Tester",
        email,
        password,
        turnstileToken: "x",
        acceptTerms: true,
      }),
      auth
    );
    const code = sent[sent.length - 1]!.text.match(/\b(\d{6})\b/)![1]!;
    await handleVerifyCode(post("/api/auth/verify-code", { email, code }), auth);
    const res = await handleSignIn(
      post("/api/auth/signin", { email, password, turnstileToken: "x" }),
      auth
    );
    const body = (await res.json()) as { user: { id: string } };
    return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]!, userId: body.user.id };
  }

  const receive = (raw: string, envelopeFrom: string, to = "support@collateresearch.app") =>
    receiveInboundEmail(
      { from: envelopeFrom, to, raw },
      {
        db,
        bucket: deps.bucket,
        mailboxes,
        notifier: { send: async (t) => (alerts.push(t), true) },
      }
    );

  it("stores a new support email with its attachment and sends an alert", async () => {
    const result = await receive(
      rawEmail({
        from: "Ada Obi <ada@gmail.com>",
        to: "support@collateresearch.app",
        subject: "My export <b>failed</b>",
        body: "Hello, the PDF did not download.",
        messageId: "<m1@gmail.com>",
        attachment: { name: "screen.png", type: "image/png", base64: "iVBORw0KGgo=" },
      }),
      "ada@gmail.com"
    );
    expect(result).toMatchObject({ mailbox: "support", isNewThread: true });
    const [thread] = await db.select().from(emailThreads);
    expect(thread).toMatchObject({
      contactEmail: "ada@gmail.com",
      contactName: "Ada Obi",
      unread: true,
    });
    const [att] = await db.select().from(emailAttachments);
    expect(att?.filename).toBe("screen.png");
    expect(stored.has(att!.r2Key)).toBe(true);
    expect(alerts[0]).toContain("Support");
    expect(alerts[0]).toContain("&lt;b&gt;failed&lt;/b&gt;"); // subject escaped for Telegram
  });

  it("threads replies by Message-ID and routes billing@ mail to the Billing tab", async () => {
    const first = await receive(
      rawEmail({
        from: "ada@gmail.com",
        to: "support@collateresearch.app",
        subject: "Help",
        body: "One",
        messageId: "<a1@gmail.com>",
      }),
      "ada@gmail.com"
    );
    const reply = await receive(
      rawEmail({
        from: "ada@gmail.com",
        to: "support@collateresearch.app",
        subject: "Something else entirely",
        body: "Two\n\nOn Mon, Collate wrote:\n> One",
        messageId: "<a2@gmail.com>",
        inReplyTo: "<a1@gmail.com>",
      }),
      "ada@gmail.com"
    );
    expect(reply.threadId).toBe(first.threadId);
    expect(reply.isNewThread).toBe(false);
    const msgs = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.threadId, first.threadId));
    expect(msgs.map((m) => m.textBody).sort()).toEqual(["One", "Two"]); // quoted part removed

    const billing = await receive(
      rawEmail({
        from: "ada@gmail.com",
        to: "billing@collateresearch.app",
        subject: "Refund",
        body: "x",
        messageId: "<b1@gmail.com>",
      }),
      "ada@gmail.com",
      "billing@collateresearch.app"
    );
    expect(billing.mailbox).toBe("billing");

    const dispute = await receive(
      rawEmail({
        from: "ada@gmail.com",
        to: "disputes@collateresearch.app",
        subject: "Chargeback inquiry",
        body: "Checking on a charge.",
        messageId: "<d1@gmail.com>",
      }),
      "ada@gmail.com",
      "disputes@collateresearch.app"
    );
    expect(dispute.mailbox).toBe("disputes");
    expect(alerts[alerts.length - 1]).toContain("Disputes");
  });

  it("keeps inline Gmail images and Apple Mail inline PDFs while ignoring tiny unnamed pixels", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF");
    const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
    const raw = [
      "From: Ada Obi <ada@gmail.com>",
      "To: support@collateresearch.app",
      "Subject: Payment receipt",
      "Message-ID: <inline-test@gmail.com>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="outer"',
      "",
      "--outer",
      'Content-Type: multipart/related; boundary="rel"',
      "",
      "--rel",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<p>See screenshot below:</p><img src="cid:ii_shot1">',
      "--rel",
      'Content-Type: image/png; name="receipt.png"',
      'Content-Disposition: inline; filename="receipt.png"',
      "Content-ID: <ii_shot1>",
      "Content-Transfer-Encoding: base64",
      "",
      b64(pngBytes),
      "--rel",
      "Content-Type: image/gif",
      "Content-Disposition: inline",
      "Content-ID: <pixel_1>",
      "Content-Transfer-Encoding: base64",
      "",
      b64(new Uint8Array([71, 73, 70, 56, 57, 97])), // 6-byte unnamed related pixel -> skipped
      "--rel--",
      "--outer",
      'Content-Type: application/pdf; name="bank-slip.pdf"',
      'Content-Disposition: inline; filename="bank-slip.pdf"',
      "Content-ID: <apple_pdf_1>",
      "Content-Transfer-Encoding: base64",
      "",
      b64(pdfBytes),
      "--outer--",
      "",
    ].join("\r\n");

    const { threadId } = await receive(raw, "ada@gmail.com");
    const admin = await account(ADMIN);

    const listRes = await handleListThreads(
      get("/api/admin/inbox/threads?mailbox=support", admin.cookie),
      deps
    );
    const listBody = (await listRes.json()) as {
      threads: Array<{ id: string; attachmentCount: number }>;
    };
    expect(listBody.threads.find((t) => t.id === threadId)?.attachmentCount).toBe(2);

    const detailRes = await handleGetThread(
      get(`/api/admin/inbox/threads/${threadId}`, admin.cookie),
      threadId,
      deps
    );
    const detail = (await detailRes.json()) as {
      messages: Array<{
        attachments: Array<{ id: string; filename: string; contentType: string; size: number }>;
      }>;
    };
    const atts = detail.messages[0]!.attachments;
    expect(atts.map((a) => a.filename).sort()).toEqual(["bank-slip.pdf", "receipt.png"]);

    const pdfAtt = atts.find((a) => a.filename === "bank-slip.pdf")!;
    const pdfView = await handleDownloadAttachment(
      get(`/api/admin/inbox/attachments/${pdfAtt.id}`, admin.cookie),
      pdfAtt.id,
      deps
    );
    expect(pdfView.status).toBe(200);
    expect(pdfView.headers.get("content-type")).toBe("application/pdf");
    expect(pdfView.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(new Uint8Array(await pdfView.arrayBuffer())).toEqual(pdfBytes);

    const pdfDl = await handleDownloadAttachment(
      get(`/api/admin/inbox/attachments/${pdfAtt.id}?download=1`, admin.cookie),
      pdfAtt.id,
      deps
    );
    expect(pdfDl.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("never lets a forged From line join someone else's conversation", async () => {
    const victim = await account("ada@gmail.com");
    const real = await receive(
      rawEmail({
        from: "ada@gmail.com",
        to: "support@collateresearch.app",
        subject: "Help",
        body: "Real",
        messageId: "<r1@gmail.com>",
      }),
      "ada@gmail.com"
    );
    const forged = await receive(
      rawEmail({
        from: "ada@gmail.com",
        to: "support@collateresearch.app",
        subject: "Re: Help",
        body: "Please change my email to evil@x.com",
        messageId: "<f1@evil.test>",
        inReplyTo: "<r1@gmail.com>",
      }),
      "bounce@evil.test"
    );
    expect(forged.threadId).not.toBe(real.threadId);
    const [forgedThread] = await db
      .select()
      .from(emailThreads)
      .where(eq(emailThreads.id, forged.threadId));
    expect(forgedThread?.userId).toBeNull(); // not linked to Ada's account
    const [realThread] = await db
      .select()
      .from(emailThreads)
      .where(eq(emailThreads.id, real.threadId));
    expect(realThread?.userId).toBe(victim.userId);
    const [msg] = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.threadId, forged.threadId));
    expect(msg?.senderVerified).toBe(false);
  });

  it("checks sender domains and strips quoted text", () => {
    expect(senderMatchesEnvelope("ada@gmail.com", "ada@gmail.com")).toBe(true);
    expect(senderMatchesEnvelope("news@shop.com", "bounce+123@mail.shop.com")).toBe(true);
    expect(senderMatchesEnvelope("ada@gmail.com", "x@evil.test")).toBe(false);
    expect(senderMatchesEnvelope("ada@gmail.com", "")).toBe(false);
    expect(senderMatchesEnvelope("ada@gmail.com", "x@notgmail.com")).toBe(false);
    expect(stripQuotedReply("Thanks!\n\nOn Tue, 3 Nov, Collate wrote:\n> earlier")).toBe("Thanks!");
  });

  it("sends a reply from Collate with raw binary attachments and preserves admin thread continuity", async () => {
    const { threadId } = await receive(
      rawEmail({
        from: "ada@gmail.com",
        to: "support@collateresearch.app",
        subject: "Help",
        body: "Hi",
        messageId: "<h1@gmail.com>",
      }),
      "ada@gmail.com"
    );
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const customMailer: EmailSender = {
      async send(m) {
        sent.push(m);
        return { ok: true, provider: "cloudflare", messageId: "cf_reply_1@collateresearch.app" };
      },
    };
    const res = await sendThreadReply(
      {
        threadId,
        text: "Here is the file.",
        files: [
          {
            filename: "guide.pdf",
            contentType: "application/pdf",
            bytes: pdfBytes,
          },
        ],
      },
      { db, bucket: deps.bucket, mailer: customMailer, mailboxes }
    );
    expect(res.ok).toBe(true);
    const mail = sent[sent.length - 1]!;
    expect(mail.to).toBe("ada@gmail.com");
    expect(mail.from).toBe("Collate <support@collateresearch.app>");
    expect(mail.subject).toBe("[Collate] Help");
    expect(mail.replyTo).toBe("support@collateresearch.app");
    // Outbound replies omit In-Reply-To/References so Gmail displays "Collate" instead of "me, Collate".
    expect(mail.headers).toBeUndefined();
    // The person’s message is quoted under the reply for context.
    expect(mail.text).toMatch(/^Here is the file\.\n\nOn .+ UTC, ada@gmail\.com wrote:\n> Hi$/);
    expect(mail.html).toContain('<blockquote class="gmail_quote"');
    // Attachments must be raw binary bytes (Uint8Array), not a base64 string.
    expect(mail.attachments?.[0]?.filename).toBe("guide.pdf");
    expect(mail.attachments?.[0]?.content).toBeInstanceOf(Uint8Array);
    expect(Array.from(mail.attachments?.[0]?.content as Uint8Array)).toEqual(Array.from(pdfBytes));

    const outbound = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.direction, "outbound"));
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.messageIdHeader).toBe("<cf_reply_1@collateresearch.app>");

    // Customer replying to Collate's email still threads back into the same admin conversation,
    // both by In-Reply-To (matching Cloudflare's Message-ID) and by normalized subject fallback.
    const followUp = await receive(
      rawEmail({
        from: "ada@gmail.com",
        to: "support@collateresearch.app",
        subject: "Re: [Collate] Help",
        body: "Got it, thanks!",
        messageId: "<h2@gmail.com>",
        inReplyTo: "<cf_reply_1@collateresearch.app>",
      }),
      "ada@gmail.com"
    );
    expect(followUp.threadId).toBe(threadId);
    expect(followUp.isNewThread).toBe(false);

    const followUpBySubjectOnly = await receive(
      rawEmail({
        from: "ada@gmail.com",
        to: "support@collateresearch.app",
        subject: "Re: [Collate] Help",
        body: "One more question.",
        messageId: "<h3@gmail.com>",
      }),
      "ada@gmail.com"
    );
    expect(followUpBySubjectOnly.threadId).toBe(threadId);
    expect(followUpBySubjectOnly.isNewThread).toBe(false);

    // Attachment-only reply works cleanly; empty text + no files is rejected.
    const fileOnly = await sendThreadReply(
      {
        threadId,
        text: "  ",
        files: [{ filename: "shot.png", contentType: "image/png", bytes: new Uint8Array([1, 2]) }],
      },
      { db, bucket: deps.bucket, mailer: customMailer, mailboxes }
    );
    expect(fileOnly.ok).toBe(true);

    const empty = await sendThreadReply(
      { threadId, text: "  ", files: [] },
      { db, bucket: deps.bucket, mailer: deps.mailer, mailboxes }
    );
    expect(empty).toMatchObject({ ok: false, status: 400 });
  });

  it("nests earlier messages newest first, escaping their text", () => {
    const q = buildQuotedHistory([
      { author: "Collate Support", at: new Date("2026-11-26T09:00:00Z"), text: "Sent it again." },
      {
        author: "Ada <ada@gmail.com>",
        at: new Date("2026-11-26T08:00:00Z"),
        text: "Where is my <receipt>?",
      },
    ]);
    expect(q.text).toBe(
      [
        "On Thu, 26 Nov 2026, 09:00 UTC, Collate Support wrote:",
        "> Sent it again.",
        ">",
        "> On Thu, 26 Nov 2026, 08:00 UTC, Ada <ada@gmail.com> wrote:",
        "> > Where is my <receipt>?",
      ].join("\n")
    );
    expect(q.html).not.toContain("<receipt>");
    expect(q.html).toContain("&lt;receipt&gt;");
    expect(q.html.indexOf("Sent it again")).toBeLessThan(q.html.indexOf("Where is my"));
    expect(buildQuotedHistory([])).toEqual({ text: "", html: "" });
  });

  it("only lets a verified admin use the inbox", async () => {
    const { threadId } = await receive(
      rawEmail({
        from: "ada@gmail.com",
        to: "support@collateresearch.app",
        subject: "Help",
        body: "Hi",
        messageId: "<p1@gmail.com>",
      }),
      "ada@gmail.com"
    );
    expect((await handleListThreads(get("/api/admin/inbox/threads"), deps)).status).toBe(401);

    const user = await account("student@uni.edu.ng");
    expect(
      (await handleListThreads(get("/api/admin/inbox/threads", user.cookie), deps)).status
    ).toBe(403);
    expect(
      (
        await handleGetThread(
          get(`/api/admin/inbox/threads/${threadId}`, user.cookie),
          threadId,
          deps
        )
      ).status
    ).toBe(403);

    const admin = await account(ADMIN);
    const list = await handleListThreads(
      get("/api/admin/inbox/threads?mailbox=support", admin.cookie),
      deps
    );
    const listBody = (await list.json()) as {
      threads: Array<{ id: string }>;
      unread: { support: number };
    };
    expect(listBody.threads.map((t) => t.id)).toEqual([threadId]);
    expect(listBody.unread.support).toBe(1);

    await handleGetThread(
      get(`/api/admin/inbox/threads/${threadId}`, admin.cookie),
      threadId,
      deps
    );
    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.id, threadId));
    expect(thread?.unread).toBe(false);

    // A reply from another site is refused even with the admin's cookie.
    const form = new FormData();
    form.set("text", "hi");
    const crossSite = new Request(`${APP}/api/admin/inbox/threads/${threadId}/reply`, {
      method: "POST",
      headers: { origin: "https://evil.test", cookie: admin.cookie },
      body: form,
    });
    expect((await handleReplyToThread(crossSite, threadId, deps)).status).toBe(403);
  });

  it("serves attachments that are not plain images as downloads only", async () => {
    await receive(
      rawEmail({
        from: "ada@gmail.com",
        to: "support@collateresearch.app",
        subject: "x",
        body: "x",
        messageId: "<x1@gmail.com>",
        attachment: {
          name: "page.html",
          type: "text/html",
          base64: btoa("<script>alert(1)</script>"),
        },
      }),
      "ada@gmail.com"
    );
    const [att] = await db.select().from(emailAttachments);
    const admin = await account(ADMIN);
    const res = await handleDownloadAttachment(
      get(`/api/admin/inbox/attachments/${att!.id}`, admin.cookie),
      att!.id,
      deps
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("renders the message format safely", () => {
    const html = renderBroadcastHtml(
      'Hi <script>alert(1)</script> **bold** [click](javascript:alert(1)) [site](https://collateresearch.app) ![x" onerror="y](https://img.test/a.png)',
      APP
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).not.toMatch(/ onerror="/);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://collateresearch.app/"');
  });

  it("signs unsubscribe links and turns off promotions", async () => {
    const ada = await account("ada@gmail.com");
    await db
      .insert(notificationPreferences)
      .values({ userId: ada.userId, emailMarketing: true, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { emailMarketing: true },
      });
    await account("bo@gmail.com");
    expect(await countBroadcastRecipients(db, "announcement")).toBe(2);
    expect(await countBroadcastRecipients(db, "promotion")).toBe(1);

    const token = await createUnsubscribeToken(ada.userId, SECRET);
    expect(await verifyUnsubscribeToken(token, SECRET)).toBe(ada.userId);
    expect(
      await verifyUnsubscribeToken(
        token.replace(/.$/, (c) => (c === "A" ? "B" : "A")),
        SECRET
      )
    ).toBeNull();
    expect(
      await verifyUnsubscribeToken(`someone_else.${token.split(".").pop()}`, SECRET)
    ).toBeNull();

    const bad = await handleUnsubscribe(get("/api/email/unsubscribe?token=nope"), deps);
    expect(await bad.text()).toContain("not valid");
    const res = await handleUnsubscribe(
      new Request(`${APP}/api/email/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: "POST",
      }),
      deps
    );
    expect(res.status).toBe(204);
    expect(await countBroadcastRecipients(db, "promotion")).toBe(0);
  });

  it("adds an unsubscribe link to promotions and refuses them without a secret", async () => {
    const r = [{ id: "u1", email: "a@b.com", name: "Ada" }];
    await sendBroadcastBatch(
      { kind: "promotion", subject: "Offer", body: "Half price", recipients: r },
      { mailer: deps.mailer, mailboxes, appUrl: APP, unsubscribeSecret: SECRET }
    );
    const mail = sent[sent.length - 1]!;
    expect(mail.headers?.["List-Unsubscribe"]).toMatch(
      /^<https:\/\/collateresearch\.app\/api\/email\/unsubscribe\?token=/
    );
    expect(mail.html).toContain("Unsubscribe");
    expect(mail.from).toContain("offers@collateresearch.app");
    await expect(
      sendBroadcastBatch(
        { kind: "promotion", subject: "Offer", body: "Half price", recipients: r },
        { mailer: deps.mailer, mailboxes, appUrl: APP, unsubscribeSecret: "" }
      )
    ).rejects.toThrow(/EMAIL_UNSUBSCRIBE_SECRET/);
  });

  it("starts a broadcast only with confirmation, from an admin", async () => {
    const admin = await account(ADMIN);
    const draft = { kind: "announcement", subject: "New feature", body: "We added Word export." };
    const noConfirm = await handleSendBroadcast(
      post("/api/admin/broadcasts", draft, admin.cookie),
      deps
    );
    expect(noConfirm.status).toBe(400);
    const user = await account("student@uni.edu.ng");
    const asUser = await handleSendBroadcast(
      post("/api/admin/broadcasts", { ...draft, confirm: true }, user.cookie),
      deps
    );
    expect(asUser.status).toBe(403);

    const ok = await handleSendBroadcast(
      post("/api/admin/broadcasts", { ...draft, confirm: true }, admin.cookie),
      deps
    );
    const body = (await ok.json()) as { id: string; recipientCount: number };
    expect(ok.status).toBe(200);
    expect(body.recipientCount).toBe(2);
    expect(launched).toEqual([body.id]);
    const [row] = await db.select().from(emailBroadcasts);
    expect(row?.status).toBe("sending");
  });

  it("accepts only real image uploads and serves them by id", async () => {
    const admin = await account(ADMIN);
    const upload = (file: File) => {
      const form = new FormData();
      form.set("file", file);
      return handleUploadEmailAsset(
        new Request(`${APP}/api/admin/email-assets`, {
          method: "POST",
          headers: { origin: APP, cookie: admin.cookie },
          body: form,
        }),
        deps
      );
    };
    const svg = await upload(
      new File(["<svg onload=alert(1)>"], "x.svg", { type: "image/svg+xml" })
    );
    expect(svg.status).toBe(400);
    const png = await upload(
      new File([new Uint8Array([137, 80, 78, 71])], "x.png", { type: "image/png" })
    );
    const { url } = (await png.json()) as { url: string };
    expect(url).toMatch(/^\/email-assets\/[a-f0-9]{32}$/);
    const served = await handleServeEmailAsset(url.split("/").pop()!, deps);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect((await handleServeEmailAsset("../../etc/passwd", deps)).status).toBe(404);
  });
});
