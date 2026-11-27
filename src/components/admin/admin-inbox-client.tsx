"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ModalCard } from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";
import { renderBroadcastHtml } from "@/lib/inbox/broadcast-format";

type Mailbox = "support" | "billing" | "disputes" | "general";
type BroadcastKind = "announcement" | "promotion";
type Tab = Mailbox | BroadcastKind;

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "support", label: "Support" },
  { id: "billing", label: "Billing" },
  { id: "disputes", label: "Disputes" },
  { id: "general", label: "General inquiry" },
  { id: "announcement", label: "Announcements" },
  { id: "promotion", label: "Promotions" },
];

interface ThreadSummary {
  id: string;
  subject: string;
  contactEmail: string;
  contactName: string | null;
  hasAccount: boolean;
  status: "open" | "closed";
  unread: boolean;
  lastMessageAt: string;
  preview: string;
  attachmentCount?: number;
}

interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  from: string;
  senderVerified: boolean;
  text: string;
  at: string;
  attachments: Array<{ id: string; filename: string; contentType: string; size: number }>;
}

interface ThreadDetail {
  thread: {
    id: string;
    mailbox: Mailbox;
    subject: string;
    contactEmail: string;
    contactName: string | null;
    status: "open" | "closed";
  };
  messages: ThreadMessage[];
}

interface BroadcastRow {
  id: string;
  kind: BroadcastKind;
  subject: string;
  status: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readJson<T>(res: Response): Promise<T & { ok?: boolean; error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
}

function isInlinePreviewImage(contentType: string): boolean {
  return /^image\/(png|jpe?g|gif|webp)$/i.test(contentType.split(";")[0]?.trim() ?? "");
}

function isPdfAttachment(contentType: string, filename: string): boolean {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
}

export function AdminInboxClient({ addresses }: { addresses: Record<Tab, string> }) {
  const [tab, setTab] = useState<Tab>("support");
  const [unread, setUnread] = useState<Record<Mailbox, number>>({
    support: 0,
    billing: 0,
    disputes: 0,
    general: 0,
  });

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Email"
        className="flex gap-1 overflow-x-auto border-b border-[var(--neutral-200)] -mx-4 px-4 sm:mx-0 sm:px-0"
      >
        {TABS.map((t) => {
          const count = t.id in unread ? unread[t.id as Mailbox] : 0;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`shrink-0 inline-flex items-center gap-2 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
                active
                  ? "border-[var(--accent-600)] text-[var(--neutral-900)] font-medium"
                  : "border-transparent text-[var(--neutral-600)] hover:text-[var(--neutral-900)]"
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--accent-600)] text-white text-xs leading-5 text-center">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-[var(--neutral-500)] -mt-3">{addresses[tab]}</p>

      {tab === "support" || tab === "billing" || tab === "disputes" || tab === "general" ? (
        <MailboxView key={tab} mailbox={tab} onUnread={setUnread} />
      ) : (
        <BroadcastView key={tab} kind={tab} />
      )}
    </div>
  );
}

// ── Mailboxes ───────────────────────────────────────────────────────────────

function MailboxView({
  mailbox,
  onUnread,
}: {
  mailbox: Mailbox;
  onUnread: (counts: Record<Mailbox, number>) => void;
}) {
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/inbox/threads?mailbox=${mailbox}&status=${status}`, {
        cache: "no-store",
      });
      const data = await readJson<{ threads: ThreadSummary[]; unread: Record<Mailbox, number> }>(
        res
      );
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not load conversations.");
        return;
      }
      setThreads(data.threads);
      onUnread(data.unread);
    } catch {
      setError("Network error. Check your connection and try again.");
    }
  }, [mailbox, status, onUnread]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-5 items-start">
      <section
        className={`${selected ? "hidden lg:block" : ""} space-y-3`}
        aria-label="Conversations"
      >
        <div className="flex gap-1">
          {(["open", "closed", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 text-xs rounded-full border ${
                status === s
                  ? "bg-[var(--neutral-900)] text-white border-[var(--neutral-900)]"
                  : "border-[var(--neutral-300)] text-[var(--neutral-700)] hover:bg-[var(--neutral-100)]"
              }`}
            >
              {s === "open" ? "Open" : s === "closed" ? "Closed" : "All"}
            </button>
          ))}
        </div>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {threads === null && !error && (
          <p className="text-sm text-[var(--neutral-500)] py-6">Loading conversations…</p>
        )}
        {threads?.length === 0 && (
          <p className="text-sm text-[var(--neutral-500)] py-6">No conversations here.</p>
        )}
        <ul className="divide-y divide-[var(--neutral-200)] border-y border-[var(--neutral-200)]">
          {threads?.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setSelected(t.id)}
                className={`w-full text-left py-3 px-2 -mx-2 rounded-[var(--radius-sm)] hover:bg-[var(--neutral-100)] ${
                  selected === t.id ? "bg-[var(--neutral-100)]" : ""
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={`text-sm truncate ${t.unread ? "font-semibold text-[var(--neutral-900)]" : "text-[var(--neutral-800)]"}`}
                  >
                    {t.contactName || t.contactEmail}
                  </span>
                  <span className="text-xs text-[var(--neutral-500)] shrink-0">
                    {formatWhen(t.lastMessageAt)}
                  </span>
                </div>
                <p
                  className={`text-sm truncate ${t.unread ? "font-medium text-[var(--neutral-900)]" : "text-[var(--neutral-700)]"}`}
                >
                  {t.unread && (
                    <span
                      className="inline-block w-2 h-2 rounded-full bg-[var(--accent-600)] mr-1.5 align-middle"
                      aria-label="Unread"
                    />
                  )}
                  {t.subject}
                </p>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p className="text-xs text-[var(--neutral-500)] truncate">{t.preview}</p>
                  {t.attachmentCount && t.attachmentCount > 0 ? (
                    <span className="text-[11px] text-[var(--neutral-500)] shrink-0">
                      {t.attachmentCount} file{t.attachmentCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className={selected ? "" : "hidden lg:block"} aria-label="Conversation">
        {selected ? (
          <ThreadView
            key={selected}
            threadId={selected}
            onBack={() => setSelected(null)}
            onChanged={() => void load()}
          />
        ) : (
          <p className="text-sm text-[var(--neutral-500)] py-16 text-center border border-dashed border-[var(--neutral-300)] rounded-[var(--radius-md)]">
            Select a conversation.
          </p>
        )}
      </section>
    </div>
  );
}

function ThreadView({
  threadId,
  onBack,
  onChanged,
}: {
  threadId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/inbox/threads/${encodeURIComponent(threadId)}`, {
        cache: "no-store",
      });
      const data = await readJson<ThreadDetail>(res);
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not open this conversation.");
        return;
      }
      setDetail({ thread: data.thread, messages: data.messages });
      onChanged();
    } catch {
      setError("Network error. Check your connection and try again.");
    }
  }, [threadId, onChanged]);

  useEffect(() => {
    void load();
    // load is stable per thread; onChanged changes with the status filter and must not reload.
  }, [threadId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [detail?.messages.length]);

  async function send() {
    if (!text.trim() && files.length === 0) return;
    setSending(true);
    setSendError(null);
    try {
      const form = new FormData();
      form.set("text", text);
      for (const f of files) form.append("files", f);
      const res = await fetch(`/api/admin/inbox/threads/${encodeURIComponent(threadId)}/reply`, {
        method: "POST",
        body: form,
      });
      const data = await readJson<object>(res);
      if (!res.ok || !data.ok) {
        setSendError(data.error ?? "The reply was not sent. Try again.");
        return;
      }
      setText("");
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Reply sent.");
      await load();
    } catch {
      setSendError("Network error. The reply was not sent.");
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status: "open" | "closed") {
    const res = await fetch(`/api/admin/inbox/threads/${encodeURIComponent(threadId)}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await readJson<object>(res);
    if (!res.ok || !data.ok) {
      toast.error(data.error ?? "Could not update the conversation.");
      return;
    }
    toast.success(status === "closed" ? "Conversation closed." : "Conversation reopened.");
    await load();
  }

  if (error) return <FormAlert tone="error">{error}</FormAlert>;
  if (!detail) return <p className="text-sm text-[var(--neutral-500)] py-6">Loading…</p>;
  const { thread, messages } = detail;

  return (
    <div className="border border-[var(--neutral-200)] rounded-[var(--radius-md)] bg-white flex flex-col">
      <header className="flex items-start gap-3 px-4 py-3 border-b border-[var(--neutral-200)]">
        <button
          type="button"
          onClick={onBack}
          className="lg:hidden text-sm text-[var(--accent-700)] shrink-0 py-1"
        >
          Back
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-medium text-[var(--neutral-900)] [overflow-wrap:anywhere]">
            {thread.subject}
          </h2>
          <p className="text-xs text-[var(--neutral-500)] [overflow-wrap:anywhere]">
            {thread.contactName ? `${thread.contactName} · ` : ""}
            {thread.contactEmail}
          </p>
        </div>
        <Button
          variant="secondary"
          className="!min-h-[34px] !px-3 shrink-0"
          onClick={() => void setStatus(thread.status === "open" ? "closed" : "open")}
        >
          {thread.status === "open" ? "Close" : "Reopen"}
        </Button>
      </header>

      <div className="px-4 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
        {messages.map((m) => {
          const mine = m.direction === "outbound";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] sm:max-w-[75%] space-y-1.5 ${mine ? "items-end" : ""}`}>
                {(m.text || m.attachments.length === 0) && (
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${
                      mine
                        ? "bg-[var(--accent-600)] text-white rounded-br-md"
                        : "bg-[var(--neutral-100)] text-[var(--neutral-900)] rounded-bl-md"
                    }`}
                  >
                    {m.text || <span className="italic opacity-70">(no text)</span>}
                  </div>
                )}
                {m.attachments.length > 0 && (
                  <ul className={`flex flex-wrap gap-2 ${mine ? "justify-end" : ""}`}>
                    {m.attachments.map((a) => {
                      const viewUrl = `/api/admin/inbox/attachments/${encodeURIComponent(a.id)}`;
                      const downloadUrl = `${viewUrl}?download=1`;
                      const isImage = isInlinePreviewImage(a.contentType);
                      const isPdf = isPdfAttachment(a.contentType, a.filename);
                      if (isImage) {
                        return (
                          <li
                            key={a.id}
                            className="border border-[var(--neutral-200)] rounded-[var(--radius-sm)] bg-[var(--neutral-50)] overflow-hidden max-w-[260px]"
                          >
                            <a
                              href={viewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block bg-white"
                              title={`Open ${a.filename}`}
                            >
                              <img
                                src={viewUrl}
                                alt={a.filename}
                                loading="lazy"
                                className="max-h-[180px] w-full object-contain bg-[var(--neutral-50)]"
                              />
                            </a>
                            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs border-t border-[var(--neutral-200)]">
                              <span
                                className="truncate text-[var(--neutral-800)]"
                                title={a.filename}
                              >
                                {a.filename}
                              </span>
                              <span className="text-[var(--neutral-500)] shrink-0">
                                {formatSize(a.size)}
                              </span>
                              <a
                                href={downloadUrl}
                                download={a.filename}
                                className="text-[var(--accent-700)] underline underline-offset-2 shrink-0"
                              >
                                Download
                              </a>
                            </div>
                          </li>
                        );
                      }
                      return (
                        <li
                          key={a.id}
                          className="inline-flex items-center gap-2 text-xs border border-[var(--neutral-300)] bg-white rounded-[var(--radius-sm)] px-3 py-1.5 max-w-[320px]"
                        >
                          <span
                            className="truncate font-medium text-[var(--neutral-900)]"
                            title={a.filename}
                          >
                            {a.filename}
                          </span>
                          <span className="text-[var(--neutral-500)] shrink-0">
                            {formatSize(a.size)}
                          </span>
                          {isPdf && (
                            <a
                              href={viewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--accent-700)] underline underline-offset-2 shrink-0"
                            >
                              View
                            </a>
                          )}
                          <a
                            href={downloadUrl}
                            download={a.filename}
                            className="text-[var(--accent-700)] underline underline-offset-2 shrink-0"
                          >
                            Download
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className={`text-[11px] text-[var(--neutral-500)] ${mine ? "text-right" : ""}`}>
                  {mine ? "You" : m.from} · {formatWhen(m.at)}
                </p>
                {!mine && !m.senderVerified && (
                  <p className="text-[11px] text-[var(--error-text)]">
                    Sender not confirmed: this email may not really be from {m.from}. Do not change
                    account details because of it.
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-[var(--neutral-200)] p-3 space-y-2">
        {sendError && <FormAlert tone="error">{sendError}</FormAlert>}
        <label htmlFor="reply-text" className="sr-only">
          Reply
        </label>
        <textarea
          id="reply-text"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Reply to ${thread.contactName || thread.contactEmail}`}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--neutral-300)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-600)]"
        />
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="inline-flex items-center gap-1.5 text-xs border border-[var(--neutral-300)] rounded-full pl-3 pr-1 py-0.5"
              >
                <span className="truncate max-w-[180px]">{f.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                  className="w-5 h-5 rounded-full hover:bg-[var(--neutral-100)]"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm text-[var(--accent-700)] cursor-pointer hover:underline">
            Attach files
            <input
              ref={fileRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                setFiles((all) => [...all, ...picked].slice(0, 10));
              }}
            />
          </label>
          <Button
            onClick={() => void send()}
            loading={sending}
            loadingLabel="Sending"
            disabled={!text.trim() && files.length === 0}
          >
            Send reply
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Announcements and promotions ───────────────────────────────────────────

function BroadcastView({ kind }: { kind: BroadcastKind }) {
  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Record<BroadcastKind, number> | null>(null);
  const [history, setHistory] = useState<BroadcastRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"test" | "send" | "image" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/broadcasts", { cache: "no-store" });
    const data = await readJson<{
      audience: Record<BroadcastKind, number>;
      broadcasts: BroadcastRow[];
    }>(res);
    if (res.ok && data.ok) {
      setAudience(data.audience);
      setHistory(data.broadcasts.filter((b) => b.kind === kind));
    } else {
      setError(data.error ?? "Could not load past messages.");
    }
  }, [kind]);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  const previewHtml = useMemo(
    () => (origin && body.trim() ? renderBroadcastHtml(body, origin) : ""),
    [body, origin]
  );

  function wrapSelection(before: string, after = before, placeholder = "text") {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const chosen = body.slice(start, end) || placeholder;
    const next = body.slice(0, start) + before + chosen + after + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + chosen.length);
    });
  }

  function prefixLine(prefix: string) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const lineStart = body.lastIndexOf("\n", start - 1) + 1;
    setBody(body.slice(0, lineStart) + prefix + body.slice(lineStart));
    requestAnimationFrame(() => el.focus());
  }

  function insertAtCursor(snippet: string) {
    const el = bodyRef.current;
    const at = el ? el.selectionStart : body.length;
    setBody(body.slice(0, at) + snippet + body.slice(at));
  }

  function addLink() {
    const url = window.prompt("Link address (https://…)");
    if (!url) return;
    wrapSelection("[", `](${url.trim()})`, "link text");
  }

  async function uploadImage(file: File) {
    setBusy("image");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/admin/email-assets", { method: "POST", body: form });
      const data = await readJson<{ url: string }>(res);
      if (!res.ok || !data.ok) {
        setError(data.error ?? "The image was not uploaded.");
        return;
      }
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[[\]]/g, "");
      insertAtCursor(`\n\n![${alt}](${data.url})\n\n`);
    } catch {
      setError("Network error. The image was not uploaded.");
    } finally {
      setBusy(null);
      if (imageRef.current) imageRef.current.value = "";
    }
  }

  async function post(path: string, payload: object): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJson<{ sentTo?: string; recipientCount?: number }>(res);
      if (!res.ok || !data.ok) {
        setError(data.error ?? "That did not work. Try again.");
        return false;
      }
      if (data.sentTo) toast.success(`Test sent to ${data.sentTo}.`);
      if (data.recipientCount !== undefined)
        toast.success(`Sending to ${data.recipientCount} people.`);
      return true;
    } catch {
      setError("Network error. Try again.");
      return false;
    }
  }

  async function sendTest() {
    setBusy("test");
    await post("/api/admin/broadcasts/test", { kind, subject, body });
    setBusy(null);
  }

  async function sendAll() {
    setBusy("send");
    const ok = await post("/api/admin/broadcasts", { kind, subject, body, confirm: true });
    setBusy(null);
    setConfirmOpen(false);
    if (ok) {
      setSubject("");
      setBody("");
      await load();
    }
  }

  const count = audience?.[kind] ?? 0;
  const ready = subject.trim().length >= 3 && body.trim().length >= 10;
  const toolbarBtn =
    "min-w-[36px] h-9 px-2.5 text-sm rounded-[var(--radius-sm)] border border-[var(--neutral-300)] bg-white hover:bg-[var(--neutral-100)]";

  return (
    <div className="space-y-8">
      {audience && (
        <p className="text-sm text-[var(--neutral-600)]">
          Recipients:{" "}
          <strong className="text-[var(--neutral-900)]">
            {count.toLocaleString("en-US")} {count === 1 ? "account" : "accounts"}
          </strong>{" "}
          ({kind === "announcement" ? "verified accounts" : "opted-in subscribers"})
        </p>
      )}

      {error && <FormAlert tone="error">{error}</FormAlert>}

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="bc-subject" className="text-sm font-medium text-[var(--neutral-800)]">
              Subject
            </label>
            <input
              id="bc-subject"
              value={subject}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full min-h-[42px] rounded-[var(--radius-sm)] border border-[var(--neutral-300)] px-3 text-sm focus:outline-none focus:border-[var(--accent-600)]"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bc-body" className="text-sm font-medium text-[var(--neutral-800)]">
              Message
            </label>
            <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Formatting">
              <button
                type="button"
                className={`${toolbarBtn} font-bold`}
                onClick={() => wrapSelection("**")}
              >
                B
              </button>
              <button
                type="button"
                className={`${toolbarBtn} italic`}
                onClick={() => wrapSelection("*")}
              >
                I
              </button>
              <button type="button" className={toolbarBtn} onClick={() => prefixLine("## ")}>
                Heading
              </button>
              <button type="button" className={toolbarBtn} onClick={() => prefixLine("- ")}>
                List
              </button>
              <button type="button" className={toolbarBtn} onClick={addLink}>
                Link
              </button>
              <label className={`${toolbarBtn} inline-flex items-center cursor-pointer`}>
                {busy === "image" ? "Uploading…" : "Image"}
                <input
                  ref={imageRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="sr-only"
                  disabled={busy === "image"}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadImage(f);
                  }}
                />
              </label>
            </div>
            <textarea
              id="bc-body"
              ref={bodyRef}
              rows={14}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"Write your message..."}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--neutral-300)] px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:border-[var(--accent-600)]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void sendTest()}
              loading={busy === "test"}
              loadingLabel="Sending test"
              disabled={!ready || busy !== null}
            >
              Send a test to me
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={!ready || busy !== null || count === 0}
            >
              Send to {count} {count === 1 ? "person" : "people"}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-[var(--neutral-800)]">Preview</p>
          <div className="border border-[var(--neutral-200)] rounded-[var(--radius-md)] bg-[#f6f5f2] p-4 sm:p-6">
            <div className="bg-white rounded-[var(--radius-sm)] p-5 text-[15px] leading-relaxed text-[#1f2937] [overflow-wrap:anywhere]">
              <p className="text-sm text-[var(--neutral-500)] mb-3">
                Subject: <span className="text-[var(--neutral-900)]">{subject || "—"}</span>
              </p>
              <p className="mb-3.5">Hi Ada,</p>
              {previewHtml ? (
                // renderBroadcastHtml escapes everything and only emits a fixed set of tags.
                <div
                  className="[&_ul]:list-disc [&_a]:underline"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <p className="text-[var(--neutral-500)]">Your message appears here.</p>
              )}
              {kind === "promotion" && (
                <p className="mt-5 text-xs text-[var(--neutral-500)]">
                  You get this because you opted in to news and offers. <u>Unsubscribe</u>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <section className="space-y-3" aria-label="Sent before">
        <h2 className="text-base font-medium text-[var(--neutral-900)]">Sent before</h2>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--neutral-500)]">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--neutral-200)] border-y border-[var(--neutral-200)]">
            {history.map((b) => (
              <li
                key={b.id}
                className="py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
              >
                <span className="text-sm text-[var(--neutral-900)] [overflow-wrap:anywhere]">
                  {b.subject}
                </span>
                <span className="text-xs text-[var(--neutral-500)]">
                  {formatWhen(b.createdAt)} ·{" "}
                  {b.status === "sending"
                    ? `Sending (${b.sentCount} of ${b.recipientCount})`
                    : b.status === "failed"
                      ? "Did not start"
                      : `Sent to ${b.sentCount} of ${b.recipientCount}`}
                  {b.failedCount > 0 ? ` · ${b.failedCount} failed` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ModalCard
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={kind === "announcement" ? "Send this announcement?" : "Send this promotion?"}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void sendAll()}
              loading={busy === "send"}
              loadingLabel="Starting"
            >
              Send to {count} {count === 1 ? "person" : "people"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[var(--neutral-700)]">
          “{subject}” will be emailed to {count} {count === 1 ? "person" : "people"}. This cannot be
          stopped once it starts.
        </p>
      </ModalCard>
    </div>
  );
}
