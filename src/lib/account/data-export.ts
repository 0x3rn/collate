import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  accounts,
  auditLog,
  chapters,
  chapterVersions,
  creditLedger,
  payments,
  projects,
  users,
} from "@/db/schema";
import { isAllowedOrigin, jsonNoStore, readSessionTokenFromRequest } from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getSessionFromToken } from "@/lib/auth/service";
import { getUserNotificationPrefs } from "@/lib/email/notifications";
import { logEvent } from "@/lib/observability/logger";
import { brandDocument, brandFooter, esc, grid, money, rows, when } from "@/lib/pdf/brand-document";
import { type BrowserRunPdfBinding, renderHtmlToPdfBytes } from "@/lib/pdf/render-pdf";
import { formatCreditLedgerType } from "@/lib/ui/formatters";
import { describeDevice, describeLocation } from "./device";

/**
 * "Export my data": everything Collate keeps about the signed-in user, as a branded PDF.
 * Only ever the caller's own account; no other user's data is read.
 */

type Meta = {
  ip?: string | null;
  userAgent?: string | null;
  city?: string | null;
  country?: string | null;
  format?: string;
  scope?: string;
};
const meta = (json: string | null): Meta => {
  try {
    return json ? (JSON.parse(json) as Meta) : {};
  } catch {
    return {};
  }
};
const device = (m: Meta) => (m.userAgent ? describeDevice(m.userAgent).label : "—");
const place = (m: Meta) =>
  (m.city || m.country ? describeLocation(m.city ?? null, m.country ?? null) : null) ?? "—";
const yesNo = (v: boolean) => (v ? "On" : "Off");

const STATUS_LABELS: Record<string, string> = {
  succeeded: "Paid",
  pending: "Not completed",
  failed: "Failed",
  refunded: "Refunded",
};

export async function buildUserDataExportHtml(
  db: AppDb,
  userId: string,
  generatedAt: Date
): Promise<string | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;

  const signInMethods = await db
    .select({ providerId: accounts.providerId })
    .from(accounts)
    .where(eq(accounts.userId, user.id));
  const methods = [
    ...(signInMethods.some((a) => a.providerId === "credential") ? ["Email and password"] : []),
    ...(signInMethods.some((a) => a.providerId === "google") ? ["Google"] : []),
  ];
  const prefs = await getUserNotificationPrefs(db, user.id);

  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.userId, user.id))
    .orderBy(desc(payments.createdAt));
  const ledger = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, user.id))
    .orderBy(desc(creditLedger.createdAt));

  const projectRows = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.createdAt));
  const projectIds = projectRows.map((p) => p.id);
  const chapterRows = projectIds.length
    ? await db.select().from(chapters).where(inArray(chapters.projectId, projectIds))
    : [];
  const versionRows = chapterRows.length
    ? await db
        .select()
        .from(chapterVersions)
        .where(
          inArray(
            chapterVersions.chapterId,
            chapterRows.map((c) => c.id)
          )
        )
    : [];
  const words = new Map<string, number | null>();
  for (const v of [...versionRows].sort((a, b) => a.version - b.version)) {
    words.set(v.chapterId, v.wordCount ?? null);
  }

  const activity = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actorUserId, user.id),
        or(
          eq(auditLog.action, "auth.signin"),
          eq(auditLog.action, "auth.signin_google"),
          eq(auditLog.action, "export.downloaded")
        )
      )
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(500);
  const signIns = activity.filter((a) => a.action !== "export.downloaded");
  const downloads = activity.filter((a) => a.action === "export.downloaded");

  const projectSections = projectRows
    .map((p) => {
      const list = chapterRows
        .filter((c) => c.projectId === p.id)
        .sort((a, b) => a.number - b.number)
        .map((c) => [
          `Chapter ${c.number}: ${c.title}`,
          c.status.replace(/_/g, " "),
          words.get(c.id) ? words.get(c.id)!.toLocaleString("en-US") : "—",
          when(c.finishedAt),
        ]);
      return `<h3>${esc(p.title)}</h3>
<p class="muted">Started ${esc(when(p.createdAt))}</p>
${grid(["Chapter", "Status", "Words", "Completed"], list, "No chapters yet.")}`;
    })
    .join("");

  const bodyHtml = `<h1>${esc(user.name)}</h1>
<p class="sub">${esc(user.email)} · Your data as of ${esc(when(generatedAt))}</p>

<h2>Account</h2>
${rows([
  ["Name", user.name],
  ["Email", user.email],
  ["Email confirmed", user.emailVerified ? "Yes" : "No"],
  ["Member since", when(user.createdAt)],
  ["Sign-in methods", methods.join(", ") || "—"],
  ["Credit balance", `${user.creditsBalance} credits`],
])}

<h2>Email updates</h2>
${rows([
  ["Chapter ready", yesNo(prefs.emailChapterReady)],
  ["Needs your review", yesNo(prefs.emailNeedsAttention)],
  ["Project finished", yesNo(prefs.emailProjectComplete)],
  ["Payment receipts", yesNo(prefs.emailReceipts)],
  ["News and offers", yesNo(prefs.emailMarketing)],
])}

<h2>Payments</h2>
${grid(
  ["Date", "Amount", "Credits", "Status", "Reference"],
  paymentRows.map((p) => [
    when(p.createdAt),
    money(p.currency, p.amountMinor),
    String(p.creditsGranted),
    STATUS_LABELS[p.status] ?? p.status,
    p.providerReference,
  ]),
  "No payments."
)}

<h2>Credit history</h2>
${grid(
  ["Date", "Activity", "Change", "Balance", "Note"],
  ledger.map((l) => [
    when(l.createdAt),
    formatCreditLedgerType(l.entryType),
    `${l.creditsDelta > 0 ? "+" : ""}${l.creditsDelta}`,
    String(l.balanceAfter),
    l.note ?? "",
  ]),
  "No credit activity."
)}

<h2>Projects and chapters</h2>
${projectSections || `<p class="muted">No projects.</p>`}

<h2>Downloads</h2>
${grid(
  ["Date", "File", "Device", "Location"],
  downloads.map((d) => {
    const m = meta(d.metadataJson);
    return [
      when(d.createdAt),
      `${m.scope === "full" ? "Full document" : "Chapter"} (${(m.format ?? "").toUpperCase()})`,
      device(m),
      place(m),
    ];
  }),
  "No downloads."
)}

<h2>Sign-ins</h2>
${grid(
  ["Date", "Method", "IP address", "Device", "Location"],
  signIns.map((s) => {
    const m = meta(s.metadataJson);
    return [
      when(s.createdAt),
      s.action === "auth.signin_google" ? "Google" : "Email and password",
      m.ip ?? "—",
      device(m),
      place(m),
    ];
  }),
  "No sign-ins recorded."
)}`;

  return brandDocument({ documentTitle: "Your data", generatedAt, bodyHtml });
}

/** GET /api/account/export: the signed-in user's own data as a PDF download. */
export async function handleExportMyData(
  request: Request,
  deps: HttpAuthDeps & { browser?: BrowserRunPdfBinding }
): Promise<Response> {
  if (request.headers.get("origin") && !isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }
  const now = (deps.nowFn ?? (() => new Date()))();
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, deps.appEnv === "prod"),
    deps.nowFn
  );
  if (!session) return jsonNoStore({ ok: false, error: "Sign in to export your data." }, 401);

  const limit = await consumeAuthRateLimit(
    deps.db,
    "dataExport",
    `user:${session.user.id}`,
    now.getTime()
  );
  if (!limit.allowed) {
    return jsonNoStore(
      { ok: false, error: "You have exported your data a few times recently. Try again later." },
      429
    );
  }
  if (!deps.browser) {
    return jsonNoStore(
      { ok: false, error: "Export is not available right now. Try again soon." },
      503
    );
  }

  const html = await buildUserDataExportHtml(deps.db, session.user.id, now);
  if (!html) return jsonNoStore({ ok: false, error: "Account not found." }, 404);

  let bytes: Uint8Array;
  try {
    bytes = await renderHtmlToPdfBytes(html, deps.browser, {
      footerTemplate: brandFooter("Your data · Confidential"),
    });
  } catch (err) {
    logEvent("error", "account.data_export_failed", {
      data: { userId: session.user.id, reason: err instanceof Error ? err.message : String(err) },
    });
    return jsonNoStore({ ok: false, error: "The export could not be made. Try again." }, 502);
  }

  await deps.db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: session.user.id,
    action: "account.data_exported",
    entityType: "user",
    entityId: session.user.id,
    metadataJson: null,
    createdAt: now,
  });

  return new Response(bytes.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="collate-my-data-${now.toISOString().slice(0, 10)}.pdf"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
