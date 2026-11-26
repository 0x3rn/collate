import { describe, expect, it, vi } from "vitest";
import { emailAssetRoot, wrapEmailHtml } from "@/lib/email/layout";
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
  type CloudflareEmailBinding,
  createEmailSender,
  parseAddress,
} from "@/lib/email/mailer";

const sampleMessage = {
  to: "student@example.edu",
  subject: "Verify your Collate email address",
  text: "Your code is 123456",
  html: "<p>Verify</p>",
};

function fakeBinding() {
  const calls: Array<Parameters<CloudflareEmailBinding["send"]>[0]> = [];
  const binding: CloudflareEmailBinding = {
    async send(message) {
      calls.push(message);
      return { messageId: "cf_msg_1" };
    },
  };
  return { binding, calls };
}

describe("createEmailSender (Cloudflare Email Sending)", () => {
  it("sends through the binding with a parsed sender, reply-to and branded HTML", async () => {
    const { binding, calls } = fakeBinding();
    const sender = createEmailSender({
      EMAIL_PROVIDER: "cloudflare",
      EMAIL_FROM: "Collate <noreply@collateresearch.app>",
      EMAIL_REPLY_TO: "support@collateresearch.app",
      APP_URL: "https://collateresearch.app",
      binding,
    });
    const result = await sender.send(sampleMessage);
    expect(result).toEqual({ ok: true, provider: "cloudflare", messageId: "cf_msg_1" });
    expect(calls[0]).toMatchObject({
      from: { email: "noreply@collateresearch.app", name: "Collate" },
      to: "student@example.edu",
      subject: sampleMessage.subject,
      text: sampleMessage.text,
      replyTo: "support@collateresearch.app",
    });
    expect(calls[0]!.html).toContain('<img src="https://collateresearch.app/email/logo.png"');
    expect(calls[0]!.html).toContain("<p>Verify</p>");
  });

  it("uses the binding when EMAIL_PROVIDER is unset, and passes per-message sender and attachments", async () => {
    const { binding, calls } = fakeBinding();
    const sender = createEmailSender({ binding });
    await sender.send({
      ...sampleMessage,
      from: "Collate Support <support@collateresearch.app>",
      headers: { "In-Reply-To": "<abc@mail>" },
      attachments: [{ filename: "a.txt", content: "aGk=", type: "text/plain" }],
    });
    expect(calls[0]).toMatchObject({
      from: { email: "support@collateresearch.app", name: "Collate Support" },
      headers: { "In-Reply-To": "<abc@mail>" },
      attachments: [
        { filename: "a.txt", content: "aGk=", type: "text/plain", disposition: "attachment" },
      ],
    });
  });

  it("reports a failed send without throwing", async () => {
    const sender = createEmailSender({
      binding: {
        async send() {
          throw Object.assign(new Error("Sender domain not verified"), {
            code: "E_SENDER_NOT_VERIFIED",
          });
        },
      },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await sender.send(sampleMessage);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("E_SENDER_NOT_VERIFIED: Sender domain not verified");
    errSpy.mockRestore();
  });

  it("prints instead of sending with EMAIL_PROVIDER=console, even when a binding exists", async () => {
    const { binding, calls } = fakeBinding();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await createEmailSender({ EMAIL_PROVIDER: "console", binding }).send(
      sampleMessage
    );
    expect(result.provider).toBe("console");
    expect(calls).toHaveLength(0);
    logSpy.mockRestore();
  });

  it("falls back to printing when the binding is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await createEmailSender({ EMAIL_PROVIDER: "cloudflare" }).send(sampleMessage);
    expect(result.provider).toBe("console");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe("email content", () => {
  it("parses sender addresses", () => {
    expect(parseAddress("Collate <noreply@x.app>")).toEqual({
      email: "noreply@x.app",
      name: "Collate",
    });
    expect(parseAddress("noreply@x.app")).toEqual({ email: "noreply@x.app" });
  });

  it("puts the code in the subject and body, and escapes the user's name", () => {
    const email = buildVerificationEmail({
      name: "<script>x</script>",
      verifyUrl: "https://collateresearch.app/verify-email?token=t",
      code: "042913",
    });
    expect(email.subject).toBe("042913 is your Collate verification code");
    expect(email.text).toContain("042913");
    expect(email.html).toContain("042913");
    expect(email.html).not.toContain("<script>");
    expect(buildPasswordResetEmail({ name: "Ada", code: "111222" }).text).toContain(
      "expires in 10 minutes"
    );
  });

  it("wraps HTML once, with the logo as a PNG", () => {
    const once = wrapEmailHtml("<p>Hi</p>", { appUrl: "https://collateresearch.app/" });
    expect(once).toContain("https://collateresearch.app/email/logo.png");
    expect(once).not.toContain(".svg");
    expect(wrapEmailHtml(once)).toBe(once);
  });

  it("loads the logo from the public site when sent from a local server", () => {
    expect(emailAssetRoot("http://localhost:5173")).toBe("https://collateresearch.app");
    expect(emailAssetRoot("https://app.localhost")).toBe("https://collateresearch.app");
    expect(emailAssetRoot("http://collateresearch.app")).toBe("https://collateresearch.app");
    expect(emailAssetRoot("https://staging.collateresearch.app/")).toBe(
      "https://staging.collateresearch.app"
    );
    const local = wrapEmailHtml("<p>Hi</p>", { appUrl: "http://localhost:5173" });
    expect(local).toContain('<img src="https://collateresearch.app/email/logo.png"');
    expect(local).toContain('href="http://localhost:5173"'); // links still go to the app
  });
});
