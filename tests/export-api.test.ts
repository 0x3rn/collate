import { asc, eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { syncCitationRegistryForProject } from "@/db/queries/citations";
import { createWizardDraftProject } from "@/db/queries/wizard";
import { chapters, chapterVersions, exportsTable, sources } from "@/db/schema";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyEmail,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import {
  handleCreateExport,
  handleDownloadExport,
  type R2ReadWriteBucket,
} from "@/lib/export/http-handlers";
import { signExportDownloadParams, verifyExportDownloadParams } from "@/lib/export/signed-urls";
import type { BrowserRunPdfBinding } from "@/lib/pdf/render-pdf";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

function createTestMailer() {
  const sent: EmailMessage[] = [];
  const mailer: EmailSender = {
    async send(msg) {
      sent.push(msg);
      return { ok: true, provider: "console", messageId: `m_${sent.length}` };
    },
  };
  return { sent, mailer };
}

function extractToken(text: string): string {
  const match = text.match(/token=([^\s&]+)/);
  if (!match?.[1]) throw new Error("No token");
  return decodeURIComponent(match[1]);
}

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595.28, 841.89]);
  return doc.save();
}

describe("Phase 9 — Signed Download URLs & PDF/DOCX Export HTTP API", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let authDeps: HttpAuthDeps;
  const now = new Date("2026-11-22T12:00:00.000Z");

  beforeEach(() => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);
    const mail = createTestMailer();
    sent = mail.sent;
    authDeps = {
      db,
      mailer: mail.mailer,
      appUrl: "https://collate.app",
      appEnv: "prod",
      turnstileSecretKey: "test-secret",
      nowFn: () => now,
      fetchFn: async () => Response.json({ success: true }),
    };
  });

  afterEach(() => {
    d1Ctx.close();
  });

  async function signUpCookie(name: string, email: string, password: string) {
    await handleSignUp(
      new Request("https://collate.app/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ name, email, password, turnstileToken: "ok" }),
      }),
      authDeps
    );
    const tok = extractToken(sent[sent.length - 1]!.text);
    await handleVerifyEmail(
      new Request("https://collate.app/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ token: tok }),
      }),
      authDeps
    );
    const res = await handleSignIn(
      new Request("https://collate.app/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ email, password, turnstileToken: "ok" }),
      }),
      authDeps
    );
    const json = (await res.json()) as { user: { id: string } };
    return {
      cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
      userId: json.user.id,
    };
  }

  it("verifies HMAC-signed download URLs and rejects tampered or expired tokens", async () => {
    const signed = await signExportDownloadParams({
      exportId: "exp_1",
      projectId: "prj_1",
      userId: "usr_1",
      secret: "super-secret-signing-key",
      nowMs: now.getTime(),
      ttlSeconds: 300,
    });

    expect(
      (
        await verifyExportDownloadParams({
          exportId: "exp_1",
          projectId: "prj_1",
          userId: "usr_1",
          exp: signed.exp,
          sig: signed.sig,
          secret: "super-secret-signing-key",
          nowMs: now.getTime() + 60_000,
        })
      ).valid
    ).toBe(true);

    expect(
      (
        await verifyExportDownloadParams({
          exportId: "exp_1",
          projectId: "prj_1",
          userId: "usr_1",
          exp: signed.exp,
          sig: `${signed.sig.slice(0, -2)}00`,
          secret: "super-secret-signing-key",
          nowMs: now.getTime() + 60_000,
        })
      ).valid
    ).toBe(false);

    expect(
      (
        await verifyExportDownloadParams({
          exportId: "exp_1",
          projectId: "prj_1",
          userId: "usr_1",
          exp: signed.exp,
          sig: signed.sig,
          secret: "super-secret-signing-key",
          nowMs: now.getTime() + 400_000,
        })
      ).valid
    ).toBe(false);
  });

  it("generates and downloads real PDF & DOCX exports via signed links and isolates users", async () => {
    const alice = await signUpCookie("Alice", "alice.exp@uni.edu", "quiet autumn paper press");
    const bob = await signUpCookie("Bob", "bob.exp@uni.edu", "steady coastal wooden pier");

    const draft = await createWizardDraftProject(db, alice.userId, "thesis", now);
    const projectId = draft.project.id;
    const ch1 = draft.chapters.find((c) => c.number === 1)!;

    await db.insert(sources).values({
      id: "src_e1",
      projectId,
      url: "https://doi.org/10.1000/e1",
      canonicalUrl: "https://doi.org/10.1000/e1",
      doi: "10.1000/e1",
      title: "Solar Microgrid Uptime Study",
      normalizedTitle: "solar microgrid uptime study",
      authorsJson: JSON.stringify(["Adaeze Okonkwo"]),
      year: 2024,
      venue: "Energy Policy",
      sourceType: "peer_reviewed",
      connectorName: "crossref",
      credibilityScore: 90,
      relevanceScore: 88,
      retrievedAt: now,
      createdAt: now,
    });
    await syncCitationRegistryForProject(db, projectId, now);

    const store = new Map<string, Uint8Array>();
    const bucket: R2ReadWriteBucket = {
      async put(key, val) {
        if (typeof val === "string") {
          store.set(key, new TextEncoder().encode(val));
        } else if (val instanceof Uint8Array) {
          store.set(key, val);
        } else if (val instanceof ArrayBuffer) {
          store.set(key, new Uint8Array(val));
        }
      },
      async get(key) {
        const bytes = store.get(key);
        if (!bytes) return null;
        return {
          async text() {
            return new TextDecoder().decode(bytes);
          },
          async arrayBuffer() {
            const copy = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(copy).set(bytes);
            return copy;
          },
        };
      },
    };

    const ch1Key = `chapters/${projectId}/${ch1.id}/v1.md`;
    await bucket.put(
      ch1Key,
      "# Chapter 1: Introduction\n\nRural clinic uptime improved significantly [@okonkwo2024]."
    );
    await db.insert(chapterVersions).values({
      id: "ver_e1",
      chapterId: ch1.id,
      version: 1,
      contentR2Key: ch1Key,
      wordCount: 15,
      pageCount: 1,
      createdBy: "ai",
      createdAt: now,
    });
    await db.update(chapters).set({ status: "ready" }).where(eq(chapters.id, ch1.id));

    const browser: BrowserRunPdfBinding = {
      async quickAction(_action, opts) {
        const pdf = await makePdf(opts.html.includes("Front Matter") ? 2 : 1);
        return new Response(new Uint8Array(pdf), { status: 200 });
      },
    };

    const deps = { ...authDeps, bucket, browser, signingSecret: "test-export-secret" };

    const pdfRes = await handleCreateExport(
      new Request(`https://collate.app/api/projects/${projectId}/exports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify({ scope: "full", format: "pdf" }),
      }),
      projectId,
      deps
    );
    expect(pdfRes.status).toBe(201);
    const pdfJson = (await pdfRes.json()) as {
      export: { id: string; pageCount: number; downloadUrl: string };
    };
    expect(pdfJson.export.pageCount).toBe(4);

    const dlRes = await handleDownloadExport(
      new Request(`https://collate.app${pdfJson.export.downloadUrl}`, {
        headers: { cookie: alice.cookie },
      }),
      projectId,
      pdfJson.export.id,
      deps
    );
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("content-type")).toBe("application/pdf");
    expect(dlRes.headers.get("content-disposition")).toContain(".pdf");
    const dlBytes = new Uint8Array(await dlRes.arrayBuffer());
    const parsedPdf = await PDFDocument.load(dlBytes);
    expect(parsedPdf.getPageCount()).toBe(4);

    const bobDl = await handleDownloadExport(
      new Request(`https://collate.app${pdfJson.export.downloadUrl}`, {
        headers: { cookie: bob.cookie },
      }),
      projectId,
      pdfJson.export.id,
      deps
    );
    expect(bobDl.status).toBe(403);

    const docxRes = await handleCreateExport(
      new Request(`https://collate.app/api/projects/${projectId}/exports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify({ scope: "full", format: "docx" }),
      }),
      projectId,
      deps
    );
    expect(docxRes.status).toBe(201);
    const docxJson = (await docxRes.json()) as { export: { id: string; downloadUrl: string } };
    const docxDl = await handleDownloadExport(
      new Request(`https://collate.app${docxJson.export.downloadUrl}`, {
        headers: { cookie: alice.cookie },
      }),
      projectId,
      docxJson.export.id,
      deps
    );
    expect(docxDl.status).toBe(200);
    const docxBytes = new Uint8Array(await docxDl.arrayBuffer());
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);

    // Upstream PDF rendering error returns structured masked 502 JSON (never unhandled throw)
    const failingBrowser: BrowserRunPdfBinding = {
      async quickAction() {
        return new Response('{"success":false,"errors":[{"code":"invalid_value"}]}', {
          status: 400,
        });
      },
    };
    const failedPdfRes = await handleCreateExport(
      new Request(`https://collate.app/api/projects/${projectId}/exports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify({ scope: "full", format: "pdf" }),
      }),
      projectId,
      { ...deps, browser: failingBrowser }
    );
    expect(failedPdfRes.status).toBe(502);
    const failedJson = (await failedPdfRes.json()) as { ok: boolean; error: string };
    expect(failedJson.ok).toBe(false);
    expect(failedJson.error).not.toContain("invalid_value");
    expect(failedJson.error).not.toContain("Browser Run");
  });

  it("replaces a re-export of the same chapter version and format instead of adding another", async () => {
    let clock = now.getTime();
    authDeps.nowFn = () => new Date(clock);
    const alice = await signUpCookie("Alice", "alice.dedupe@uni.edu", "quiet autumn paper press");
    const draft = await createWizardDraftProject(db, alice.userId, "thesis", now);
    const projectId = draft.project.id;
    const ch1 = draft.chapters.find((c) => c.number === 1)!;

    const store = new Map<string, Uint8Array>();
    const bucket: R2ReadWriteBucket = {
      async put(key, val) {
        store.set(
          key,
          typeof val === "string" ? new TextEncoder().encode(val) : (val as Uint8Array)
        );
      },
      async get(key) {
        const bytes = store.get(key);
        if (!bytes) return null;
        return {
          async text() {
            return new TextDecoder().decode(bytes);
          },
          async arrayBuffer() {
            const copy = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(copy).set(bytes);
            return copy;
          },
        };
      },
    };
    const addVersion = async (version: number, text: string) => {
      const key = `chapters/${projectId}/${ch1.id}/v${version}.md`;
      await bucket.put(key, text);
      await db.insert(chapterVersions).values({
        id: `ver_d${version}`,
        chapterId: ch1.id,
        version,
        contentR2Key: key,
        wordCount: 10,
        pageCount: 1,
        createdBy: version === 1 ? "ai" : "user",
        createdAt: new Date(clock),
      });
    };
    await addVersion(1, "# Chapter 1: Introduction\n\nFirst draft text.");
    await db.update(chapters).set({ status: "ready" }).where(eq(chapters.id, ch1.id));

    const browser: BrowserRunPdfBinding = {
      async quickAction() {
        return new Response(new Uint8Array(await makePdf(1)), { status: 200 });
      },
    };
    const deps = { ...authDeps, bucket, browser, signingSecret: "test-export-secret" };
    const exportOnce = async (body: Record<string, string>) => {
      clock += 60_000;
      const res = await handleCreateExport(
        new Request(`https://collate.app/api/projects/${projectId}/exports`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://collate.app",
            cookie: alice.cookie,
          },
          body: JSON.stringify(body),
        }),
        projectId,
        deps
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as { export: { id: string; downloadUrl: string } }).export;
    };
    const rows = () =>
      db
        .select()
        .from(exportsTable)
        .where(eq(exportsTable.projectId, projectId))
        .orderBy(asc(exportsTable.createdAt));
    const chapterDocx = { scope: "chapter", format: "docx", chapterId: ch1.id };

    // Same version, same format, exported twice: one entry, same id, newest date.
    const first = await exportOnce(chapterDocx);
    const second = await exportOnce(chapterDocx);
    expect(second.id).toBe(first.id);
    let all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.chapterVersion).toBe(1);
    expect(all[0]!.sourceKey).toBe(`${ch1.id}:1`);
    expect(all[0]!.createdAt.getTime()).toBe(clock);

    // The other format of the same version is a separate file.
    await exportOnce({ ...chapterDocx, format: "pdf" });
    expect(await rows()).toHaveLength(2);

    // After a Light edit saves version 2, the new version gets its own entry...
    await addVersion(2, "# Chapter 1: Introduction\n\nEdited text after light edit.");
    const v2 = await exportOnce(chapterDocx);
    expect(v2.id).not.toBe(first.id);
    all = await rows();
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.chapterVersion)).toEqual([1, 1, 2]);

    // ...and re-exporting version 2 does not add another.
    expect((await exportOnce(chapterDocx)).id).toBe(v2.id);
    expect(await rows()).toHaveLength(3);

    // Full manuscript exports follow the same rule and record no single chapter version.
    const full1 = await exportOnce({ scope: "full", format: "docx" });
    const full2 = await exportOnce({ scope: "full", format: "docx" });
    expect(full2.id).toBe(full1.id);
    all = await rows();
    expect(all).toHaveLength(4);
    expect(all.find((r) => r.id === full1.id)!.chapterVersion).toBeNull();

    // A link from the first export still downloads, and serves the replaced (newest) file.
    const dl = await handleDownloadExport(
      new Request(`https://collate.app${second.downloadUrl}`, {
        headers: { cookie: alice.cookie },
      }),
      projectId,
      first.id,
      deps
    );
    expect(dl.status).toBe(200);
    const served = new Uint8Array(await dl.arrayBuffer());
    const firstRow = (await rows()).find((r) => r.id === first.id)!;
    expect(served.byteLength).toBe(firstRow.sizeBytes);
    expect(store.size).toBe(2 + 4); // two chapter versions + four export files, no leftovers
  });
});
