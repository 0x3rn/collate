import { describe, expect, it } from "vitest";
import { formatStructuredLog } from "@/lib/observability/logger";
import { captureExceptionToSentry, parseSentryDsn } from "@/lib/observability/sentry";
import {
  buildPhase0SmokeHtml,
  hasPdfMagicHeader,
  renderHtmlToPdfAndStore,
  type BrowserRunPdfBinding,
  type R2WritableBucket,
} from "@/lib/pdf/render-pdf";
import { authorizeInternalRequest, timingSafeEqualString } from "@/lib/security/internal-auth";
import { runHelloSleepWorkflow } from "@/lib/workflows/hello-sleep-logic";

describe("Observability: structured logger and Sentry reporter", () => {
  it("scrubs secrets and sensitive keys from structured logs", () => {
    const entry = formatStructuredLog("error", "auth_failed", {
      requestId: "req_123",
      data: {
        apiKey: "super-secret",
        detail: "Rejected sk-ant-api03-SECRET999",
        nested: { authorization: "Bearer abc", safeCount: 3 },
      },
      now: new Date("2026-11-21T14:00:00.000Z"),
    });

    expect(entry.data?.apiKey).toBe("[REDACTED]");
    expect(entry.data?.detail).toContain("[REDACTED_ANTHROPIC_KEY]");
    expect(entry.data?.detail).not.toContain("SECRET999");
    expect((entry.data?.nested as Record<string, unknown>).authorization).toBe("[REDACTED]");
    expect((entry.data?.nested as Record<string, unknown>).safeCount).toBe(3);
  });

  it("parses valid Sentry DSNs and rejects malformed ones", () => {
    const parsed = parseSentryDsn("https://abc123@o456.ingest.us.sentry.io/789");
    expect(parsed).toEqual({
      envelopeUrl: "https://o456.ingest.us.sentry.io/api/789/envelope/",
      publicKey: "abc123",
      projectId: "789",
    });
    expect(parseSentryDsn("not-a-url")).toBeNull();
    expect(parseSentryDsn("")).toBeNull();
  });

  it("sends sanitized Sentry envelope and degrades cleanly when unconfigured", async () => {
    const noop = await captureExceptionToSentry(new Error("boom"), { dsn: "" });
    expect(noop).toEqual({ sent: false, reason: "sentry_dsn_not_configured" });

    let capturedBody = "";
    const mockFetch: typeof fetch = async (_url, init) => {
      capturedBody = String(init?.body ?? "");
      return new Response("{}", { status: 200 });
    };

    const res = await captureExceptionToSentry(new Error("Failure with sk-ant-LEAK123"), {
      dsn: "https://pub123@o1.ingest.sentry.io/42",
      environment: "staging",
      extra: { token: "hidden-token" },
      fetchFn: mockFetch,
    });

    expect(res.sent).toBe(true);
    expect(capturedBody).not.toContain("LEAK123");
    expect(capturedBody).not.toContain("hidden-token");
    expect(capturedBody).toContain("[REDACTED_ANTHROPIC_KEY]");
  });
});

describe("Internal smoke route authorization", () => {
  it("uses constant-time equality and fails closed in staging/prod without token", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("abc", "abcd")).toBe(false);

    const req = new Request("https://collate.example/api/internal/pdf-smoke", { method: "POST" });
    expect(authorizeInternalRequest(req, { APP_ENV: "staging" })).toMatchObject({
      authorized: false,
      status: 503,
    });
    expect(authorizeInternalRequest(req, { APP_ENV: "dev" })).toMatchObject({
      authorized: true,
      status: 200,
    });
  });

  it("accepts valid Bearer token and rejects wrong or missing tokens", () => {
    const env = { APP_ENV: "staging", INTERNAL_SMOKE_TOKEN: "top-secret-token" };

    const missing = new Request("https://collate.example/api/internal/pdf-smoke");
    expect(authorizeInternalRequest(missing, env).status).toBe(401);

    const wrong = new Request("https://collate.example/api/internal/pdf-smoke", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(authorizeInternalRequest(wrong, env).status).toBe(401);

    const valid = new Request("https://collate.example/api/internal/pdf-smoke", {
      headers: { authorization: "Bearer top-secret-token" },
    });
    expect(authorizeInternalRequest(valid, env)).toEqual({ authorized: true, status: 200 });
  });
});

describe("HelloSleepWorkflow durable step sequence", () => {
  it("executes record-start, sleeps for 1 minute, and records resume", async () => {
    const trace: string[] = [];
    let tick = 1_700_000_000_000;

    const result = await runHelloSleepWorkflow(
      { label: "staging-check" },
      {
        async recordStart(fn) {
          trace.push("do:record-start");
          return fn();
        },
        async sleep(duration) {
          trace.push(`sleep:wait-durable-interval:${duration}`);
          tick += 60_000;
        },
        async recordResume(fn) {
          trace.push("do:record-resume");
          return fn();
        },
      },
      () => new Date(tick)
    );

    expect(trace).toEqual([
      "do:record-start",
      "sleep:wait-durable-interval:1 minute",
      "do:record-resume",
    ]);
    expect(result.ok).toBe(true);
    expect(result.label).toBe("staging-check");
    expect(result.sleepDuration).toBe("1 minute");
    expect(result.elapsedMs).toBe(60_000);
  });

  it("rejects invalid sleepDuration strings at runtime", async () => {
    await expect(
      runHelloSleepWorkflow(
        { sleepDuration: "forever" },
        {
          recordStart: (fn) => fn(),
          sleep: async () => {},
          recordResume: (fn) => fn(),
        }
      )
    ).rejects.toThrow();
  });
});

describe("Browser Run /pdf renderer and R2 storage", () => {
  const fakePdfBytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");

  it("renders valid PDF bytes and uploads to R2 with content-type and sha256", async () => {
    const stored = new Map<string, { size: number; contentType?: string }>();

    const mockBrowser: BrowserRunPdfBinding = {
      async quickAction(action, options) {
        expect(action).toBe("pdf");
        expect(options.pdfOptions?.format).toBe("a4");
        expect(options.html).toContain("Collate PDF Engine Verification");
        return new Response(fakePdfBytes, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      },
    };

    const mockBucket: R2WritableBucket = {
      async put(key, value, options) {
        const len = value instanceof Uint8Array ? value.byteLength : 0;
        stored.set(key, { size: len, contentType: options?.httpMetadata?.contentType });
      },
    };

    const res = await renderHtmlToPdfAndStore(
      {
        html: buildPhase0SmokeHtml("2026-11-21T14:00:00.000Z"),
        r2Key: "smoke/test-01.pdf",
        format: "A4",
      },
      { browser: mockBrowser, bucket: mockBucket }
    );

    expect(res.r2Key).toBe("smoke/test-01.pdf");
    expect(res.sizeBytes).toBe(fakePdfBytes.byteLength);
    expect(res.sha256).toHaveLength(64);
    expect(stored.get("smoke/test-01.pdf")).toEqual({
      size: fakePdfBytes.byteLength,
      contentType: "application/pdf",
    });
  });

  it("rejects corrupted non-PDF payloads and path traversal keys", async () => {
    expect(hasPdfMagicHeader(new TextEncoder().encode("<html>Not a PDF</html>"))).toBe(false);

    const badBrowser: BrowserRunPdfBinding = {
      async quickAction() {
        return new Response("<html>Error page</html>", { status: 200 });
      },
    };
    const mockBucket: R2WritableBucket = {
      async put() {
        throw new Error("Should not write invalid PDF to R2");
      },
    };

    await expect(
      renderHtmlToPdfAndStore(
        { html: "<p>Hello</p>", r2Key: "smoke/bad.pdf" },
        { browser: badBrowser, bucket: mockBucket }
      )
    ).rejects.toThrow("missing %PDF- signature");

    await expect(
      renderHtmlToPdfAndStore(
        { html: "<p>Hello</p>", r2Key: "../escape.pdf" },
        { browser: badBrowser, bucket: mockBucket }
      )
    ).rejects.toThrow();
  });
});
