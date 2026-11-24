import { describe, expect, it, vi } from "vitest";
import { createEmailSender } from "@/lib/email/mailer";

describe("createEmailSender", () => {
  const sampleMessage = {
    to: "student@example.edu",
    subject: "Verify your Collate email address",
    text: "Click https://collate.corstack.dev/verify-email?token=abc",
    html: "<p>Verify</p>",
  };

  it("auto-selects Resend when EMAIL_PROVIDER is unset and RESEND_API_KEY is present", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const sender = createEmailSender({
      EMAIL_FROM: "Collate <collate@corstack.dev>",
      RESEND_API_KEY: "re_test_key_12345",
      fetchFn,
    });

    const result = await sender.send(sampleMessage);

    expect(result).toEqual({ ok: true, provider: "resend", messageId: "email_123" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer re_test_key_12345"
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: "Collate <collate@corstack.dev>",
      to: ["student@example.edu"],
      subject: sampleMessage.subject,
    });
  });

  it("honors explicit EMAIL_PROVIDER=console even when RESEND_API_KEY is set", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const sender = createEmailSender({
        EMAIL_PROVIDER: "console",
        EMAIL_FROM: "Collate <collate@corstack.dev>",
        RESEND_API_KEY: "re_test_key_12345",
        fetchFn,
      });

      const result = await sender.send(sampleMessage);

      expect(result.ok).toBe(true);
      expect(result.provider).toBe("console");
      expect(fetchFn).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledTimes(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("accepts case-insensitive EMAIL_PROVIDER=Resend and surfaces Resend rejection details without leaking the key", async () => {
    const secretKey = "re_super_secret_key_999";
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "validation_error",
          message: `Domain is not verified (echo ${secretKey})`,
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const sender = createEmailSender({
        EMAIL_PROVIDER: "Resend",
        EMAIL_FROM: "collate@corstack.dev",
        RESEND_API_KEY: secretKey,
        fetchFn,
      });

      const result = await sender.send(sampleMessage);

      expect(result.ok).toBe(false);
      expect(result.provider).toBe("resend");
      expect(result.error).toContain("HTTP 403");
      expect(result.error).toContain("validation_error");
      expect(result.error).not.toContain(secretKey);
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(String(errSpy.mock.calls[0]?.[0])).not.toContain(secretKey);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("handles network failures cleanly without throwing", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new Error("Connection reset"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const sender = createEmailSender({
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_test_key_12345",
        fetchFn,
      });

      const result = await sender.send(sampleMessage);

      expect(result.ok).toBe(false);
      expect(result.provider).toBe("resend");
      expect(result.error).toContain("Connection reset");
      expect(errSpy).toHaveBeenCalledTimes(1);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("warns and falls back to console when EMAIL_PROVIDER=resend but RESEND_API_KEY is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const sender = createEmailSender({
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "",
      });

      const result = await sender.send(sampleMessage);

      expect(result.ok).toBe(true);
      expect(result.provider).toBe("console");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
