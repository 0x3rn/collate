import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { handleExportMyData, buildUserDataExportHtml } from "@/lib/account/data-export";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyCode,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import { grantPaymentCreditsIdempotent } from "@/lib/billing/ledger";
import type { EmailMessage } from "@/lib/email/mailer";
import type { BrowserRunPdfBinding } from "@/lib/pdf/render-pdf";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const APP = "https://collateresearch.app";

describe("Export my data", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let rendered: string[];
  let deps: HttpAuthDeps & { browser?: BrowserRunPdfBinding };

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
      fetchFn: (async () => Response.json({ success: true })) as typeof fetch,
      browser: {
        async quickAction(_a, o) {
          rendered.push(o.html);
          return new Response(new TextEncoder().encode("%PDF-1.7 x"), { status: 200 });
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

  async function account(email: string, name: string) {
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

  it("downloads a PDF of the signed-in user's own data only", async () => {
    const ada = await account("ada@uni.edu.ng", "Ada <b>Obi</b>");
    const bo = await account("bo@uni.edu.ng", "Bo Secret");
    await grantPaymentCreditsIdempotent(
      db,
      {
        provider: "paystack",
        providerReference: "psk_ada_1",
        userId: ada.userId,
        currency: "NGN",
        amountMinor: 3_500_000,
        creditsGranted: 100,
        eventType: "charge.success",
      },
      "{}"
    );
    await grantPaymentCreditsIdempotent(
      db,
      {
        provider: "paystack",
        providerReference: "psk_bo_secret",
        userId: bo.userId,
        currency: "NGN",
        amountMinor: 1_200_000,
        creditsGranted: 25,
        eventType: "charge.success",
      },
      "{}"
    );

    const res = await handleExportMyData(
      new Request(`${APP}/api/account/export`, { headers: { cookie: ada.cookie } }),
      deps
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="collate-my-data-\d{4}-\d{2}-\d{2}\.pdf"$/
    );
    const html = rendered[0]!;
    expect(html).toContain("ada@uni.edu.ng");
    expect(html).toContain("psk_ada_1");
    expect(html).toContain("NGN 35,000.00");
    expect(html).not.toContain("bo@uni.edu.ng");
    expect(html).not.toContain("psk_bo_secret");
    expect(html).not.toContain("Bo Secret");
    expect(html).not.toContain("<b>Obi</b>");
    expect(html).toContain("&#60;b&#62;Obi");
    expect(html).toContain("<span>Collate</span>");
    for (const section of [
      "Account",
      "Payments",
      "Credit history",
      "Projects and chapters",
      "Sign-ins",
    ]) {
      expect(html).toContain(`<h2>${section}</h2>`);
    }
  });

  it("requires sign-in and limits repeated exports", async () => {
    expect((await handleExportMyData(new Request(`${APP}/api/account/export`), deps)).status).toBe(
      401
    );
    const ada = await account("ada@uni.edu.ng", "Ada Obi");
    const get = () =>
      handleExportMyData(
        new Request(`${APP}/api/account/export`, { headers: { cookie: ada.cookie } }),
        deps
      );
    for (let i = 0; i < 5; i++) expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(429);
    expect(await buildUserDataExportHtml(db, "nobody", new Date())).toBeNull();
  });
});
