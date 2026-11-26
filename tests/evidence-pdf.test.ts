import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { handleSignIn, handleSignUp, handleVerifyCode } from "@/lib/auth/http-handlers";
import { renderEvidenceHtml } from "@/lib/billing/evidence-pdf";
import { buildDisputeEvidence } from "@/lib/billing/evidence-report";
import {
  type BillingHttpDeps,
  handleAdminEvidencePdf,
  handleAdminSearchPayments,
} from "@/lib/billing/http-handlers";
import { grantPaymentCreditsIdempotent } from "@/lib/billing/ledger";
import { applyPaymentReversal } from "@/lib/billing/reversals";
import type { EmailMessage } from "@/lib/email/mailer";
import type { BrowserRunPdfBinding } from "@/lib/pdf/render-pdf";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const APP = "https://collateresearch.app";

describe("evidence PDF and payment search", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let rendered: string[];
  let deps: BillingHttpDeps & { browser?: BrowserRunPdfBinding };

  beforeEach(() => {
    d1 = createInMemoryD1();
    d1.applyMigrations();
    db = createDb(d1.d1);
    sent = [];
    rendered = [];
    deps = {
      db,
      mailer: { send: async (m) => (sent.push(m), { ok: true, provider: "console" }) },
      appUrl: APP,
      appEnv: "prod",
      turnstileSecretKey: "t",
      adminEmails: "boss@collateresearch.app",
      fetchFn: (async () => Response.json({ success: true })) as typeof fetch,
      browser: {
        async quickAction(_action, options) {
          rendered.push(options.html);
          return new Response(new TextEncoder().encode("%PDF-1.7 fake"), { status: 200 });
        },
      },
    };
  });
  afterEach(() => d1.close());

  const post = (path: string, body: unknown) =>
    new Request(`${APP}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP },
      body: JSON.stringify(body),
    });
  const get = (path: string, cookie: string) =>
    new Request(`${APP}${path}`, { headers: { cookie } });

  async function account(email: string, name = "Ada Obi") {
    const password = "quiet library oak shelf";
    await handleSignUp(
      post("/api/auth/signup", { name, email, password, turnstileToken: "x", acceptTerms: true }),
      deps
    );
    const code = sent[sent.length - 1]!.text.match(/\b(\d{6})\b/)![1]!;
    await handleVerifyCode(post("/api/auth/verify-code", { email, code }), deps);
    const res = await handleSignIn(
      post("/api/auth/signin", { email, password, turnstileToken: "x" }),
      deps
    );
    const body = (await res.json()) as { user: { id: string } };
    return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]!, userId: body.user.id };
  }

  async function pay(userId: string, ref: string, at: string) {
    const r = await grantPaymentCreditsIdempotent(
      db,
      {
        provider: "paystack",
        providerReference: ref,
        userId,
        currency: "NGN",
        amountMinor: 3_500_000,
        creditsGranted: 100,
        eventType: "charge.success",
      },
      "{}",
      new Date(at)
    );
    return r.paymentId;
  }

  it("mentions earlier undisputed payments and later purchases", async () => {
    const ada = await account("ada@uni.edu.ng");
    await pay(ada.userId, "psk_a", "2026-09-01T10:00:00Z");
    const disputed = await pay(ada.userId, "psk_b", "2026-10-01T10:00:00Z");
    await pay(ada.userId, "psk_c", "2026-11-01T10:00:00Z");
    await applyPaymentReversal(db, {
      provider: "paystack",
      kind: "dispute",
      providerReversalId: "d_b",
      payment: { providerReference: "psk_b" },
      amountMinor: 3_500_000,
      currency: "NGN",
      status: "awaiting-merchant-feedback",
    });
    const ev = (await buildDisputeEvidence(db, disputed))!;
    expect(ev.otherPayments.map((x) => [x.reference, x.when, x.disputed])).toEqual([
      ["psk_a", "before", false],
      ["psk_c", "after", false],
    ]);
    expect(ev.summary).toContain("made 1 other payment that was not disputed");
    expect(ev.summary).toContain("chose to buy more credits 1 more time");
    // Nothing was used, so the statement must not claim the service was delivered.
    expect(ev.summary).not.toContain("delivered as described");
    expect(ev.summary).toContain("Section 5.7");
  });

  it("escapes customer text in the PDF and shows the Collate logo at the top", async () => {
    const eve = await account("eve@uni.edu.ng", `<script>alert(1)</script>`);
    const id = await pay(eve.userId, "psk_x", "2026-11-01T10:00:00Z");
    const html = renderEvidenceHtml((await buildDisputeEvidence(db, id))!, new Date());
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&#60;script&#62;");
    expect(html.indexOf('class="brand"')).toBeLessThan(html.indexOf("<h1>"));
    expect(html).toContain("<span>Collate</span>");
  });

  it("downloads the evidence as a PDF for admins only, and records the download", async () => {
    const ada = await account("ada@uni.edu.ng");
    const boss = await account("boss@collateresearch.app", "Boss");
    const id = await pay(ada.userId, "psk_1", "2026-11-01T10:00:00Z");
    const path = `/api/admin/payments/${id}/evidence-pdf`;

    expect((await handleAdminEvidencePdf(get(path, ada.cookie), id, deps)).status).toBe(403);
    expect((await handleAdminEvidencePdf(get(path, ""), id, deps)).status).toBe(401);
    expect((await handleAdminEvidencePdf(get(path, boss.cookie), "nope", deps)).status).toBe(404);

    const res = await handleAdminEvidencePdf(get(path, boss.cookie), id, deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="collate-transaction-record-psk_1-\d{4}-\d{2}-\d{2}\.pdf"$/
    );
    expect(new TextDecoder().decode(await res.arrayBuffer())).toMatch(/^%PDF-/);
    expect(rendered[0]).toContain("ada@uni.edu.ng");
    const [logged] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "admin.evidence_downloaded"));
    expect(logged?.entityId).toBe(id);

    const noBrowser = await handleAdminEvidencePdf(get(path, boss.cookie), id, {
      ...deps,
      browser: undefined,
    });
    expect(noBrowser.status).toBe(503);
  });

  it("finds payments of any age by email, name or reference", async () => {
    const ada = await account("ada@uni.edu.ng");
    const boss = await account("boss@collateresearch.app", "Boss");
    const old = await pay(ada.userId, "psk_old_2024", "2024-01-01T10:00:00Z");
    const search = async (q: string, cookie = boss.cookie) =>
      handleAdminSearchPayments(
        get(`/api/admin/payments?q=${encodeURIComponent(q)}`, cookie),
        deps
      );

    for (const q of ["ada@uni", "Ada Obi", "psk_old"]) {
      const body = (await (await search(q)).json()) as { payments: Array<{ id: string }> };
      expect(body.payments.map((p) => p.id)).toEqual([old]);
    }
    const none = (await (await search("nobody@x")).json()) as { payments: unknown[] };
    expect(none.payments).toEqual([]);
    // A % in the search is literal, not a wildcard that matches everything.
    const wild = (await (await search("%%")).json()) as { payments: unknown[] };
    expect(wild.payments).toEqual([]);
    expect((await search("a")).status).toBe(400);
    expect((await search("ada", ada.cookie)).status).toBe(403);
    const [u] = await db.select().from(users).where(eq(users.id, ada.userId));
    expect(u?.email).toBe("ada@uni.edu.ng");
  });
});
