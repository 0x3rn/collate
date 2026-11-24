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
  const configuredProvider = env.EMAIL_PROVIDER?.trim().toLowerCase() ?? "";
  const apiKey = env.RESEND_API_KEY?.trim() ?? "";
  // Honor an explicit "console" override (e.g. local .dev.vars), but if EMAIL_PROVIDER is
  // omitted while RESEND_API_KEY is configured, default to Resend so live deploys do not
  // silently fall back to console logging.
  const provider = configuredProvider || (apiKey ? "resend" : "console");
  const from = env.EMAIL_FROM?.trim() || "Collate <no-reply@collate.local>";

  if (provider === "resend" && apiKey) {
    const fetchFn = env.fetchFn ?? globalThis.fetch;

    return {
      async send(message: EmailMessage): Promise<EmailSendResult> {
        let res: Response;
        try {
          res = await fetchFn("https://api.resend.com/emails", {
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
        } catch (err) {
          const reason = err instanceof Error ? err.message : "Network error";
          console.error(
            JSON.stringify({
              level: "error",
              event: "resend_email_network_error",
              to: message.to,
              subject: message.subject,
              error: reason.slice(0, 300),
            })
          );
          return { ok: false, provider: "resend", error: `Network error: ${reason}` };
        }

        if (!res.ok) {
          const rawBody = await res.text().catch(() => "");
          let detail = rawBody.slice(0, 200);
          try {
            const errJson = JSON.parse(rawBody) as { message?: string; name?: string };
            const parsed = [errJson.name, errJson.message].filter(Boolean).join(": ");
            if (parsed) detail = parsed;
          } catch {
            // Keep truncated plain-text response body
          }
          const safeDetail = detail.replaceAll(apiKey, "[REDACTED]").trim();
          const errorSummary = safeDetail
            ? `HTTP ${res.status} (${safeDetail})`
            : `HTTP ${res.status}`;
          console.error(
            JSON.stringify({
              level: "error",
              event: "resend_email_rejected",
              status: res.status,
              from,
              to: message.to,
              subject: message.subject,
              error: safeDetail || `HTTP ${res.status}`,
            })
          );
          return { ok: false, provider: "resend", error: errorSummary };
        }

        const json = (await res.json().catch(() => ({}))) as { id?: string };
        return { ok: true, provider: "resend", messageId: json.id };
      },
    };
  }

  if (provider === "resend" && !apiKey) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "email_provider_missing_api_key",
        provider: "resend",
        fallback: "console",
      })
    );
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
