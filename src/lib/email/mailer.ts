export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSendResult {
  ok: boolean;
  provider: "console" | "resend";
  messageId?: string;
  error?: string;
}

/**
 * Swappable email transport interface (Section 3 of build plan).
 * Supports local console delivery during dev, Resend HTTP API, and future Cloudflare Email Service.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export function createEmailSender(env: {
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  fetchFn?: typeof fetch;
}): EmailSender {
  const provider = (env.EMAIL_PROVIDER ?? "console").trim().toLowerCase();
  const from = env.EMAIL_FROM?.trim() || "Collate <no-reply@collate.local>";

  if (provider === "resend" && env.RESEND_API_KEY?.trim()) {
    const apiKey = env.RESEND_API_KEY.trim();
    const fetchFn = env.fetchFn ?? globalThis.fetch;

    return {
      async send(message: EmailMessage): Promise<EmailSendResult> {
        const res = await fetchFn("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        });

        if (!res.ok) {
          return { ok: false, provider: "resend", error: `HTTP ${res.status}` };
        }
        const json = (await res.json().catch(() => ({}))) as { id?: string };
        return { ok: true, provider: "resend", messageId: json.id };
      },
    };
  }

  return {
    async send(message: EmailMessage): Promise<EmailSendResult> {
      console.log(
        JSON.stringify({
          level: "info",
          event: "dev_email_dispatched",
          to: message.to,
          subject: message.subject,
          previewText: message.text,
        })
      );
      return { ok: true, provider: "console", messageId: `dev_${crypto.randomUUID()}` };
    },
  };
}

export function buildVerificationEmail(params: {
  name: string;
  verifyUrl: string;
}): Omit<EmailMessage, "to"> {
  const safeName = params.name.trim() || "there";
  return {
    subject: "Verify your Collate email address",
    text: `Hi ${safeName},\n\nConfirm your email address to activate your Collate account:\n${params.verifyUrl}\n\nThis link expires in 24 hours. If you did not create an account, you can ignore this email.`,
    html: `<p>Hi ${safeName},</p><p>Confirm your email address to activate your Collate account:</p><p><a href="${params.verifyUrl}">Verify email address</a></p><p>This link expires in 24 hours. If you did not create an account, you can ignore this email.</p>`,
  };
}

export function buildPasswordResetEmail(params: {
  name: string;
  resetUrl: string;
}): Omit<EmailMessage, "to"> {
  const safeName = params.name.trim() || "there";
  return {
    subject: "Reset your Collate password",
    text: `Hi ${safeName},\n\nUse the link below to set a new password for your Collate account:\n${params.resetUrl}\n\nThis link expires in 1 hour and can only be used once. If you did not ask for a reset, you can ignore this email.`,
    html: `<p>Hi ${safeName},</p><p>Use the link below to set a new password for your Collate account:</p><p><a href="${params.resetUrl}">Reset password</a></p><p>This link expires in 1 hour and can only be used once. If you did not ask for a reset, you can ignore this email.</p>`,
  };
}
