import { buttonHtml, codeBlockHtml, escapeEmailHtml, wrapEmailHtml } from "./layout";

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded content. */
  content: string;
  type: string;
  disposition?: "attachment" | "inline";
  contentId?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Sender address; defaults to EMAIL_FROM. Must be on the onboarded sending domain. */
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  ok: boolean;
  provider: "console" | "cloudflare";
  messageId?: string;
  error?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/**
 * The Cloudflare Email Sending Worker binding (wrangler.jsonc: "send_email": [{ "name": "EMAIL" }]).
 * Only the structured form of send() is used.
 */
export interface CloudflareEmailBinding {
  send(message: {
    from: string | { email: string; name?: string };
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string;
    headers?: Record<string, string>;
    attachments?: Array<{
      content: string;
      filename: string;
      type: string;
      disposition: "attachment" | "inline";
      contentId?: string;
    }>;
  }): Promise<{ messageId?: string } | void>;
}

/** "Collate <noreply@x.app>" -> { email, name }; a bare address stays as is. */
export function parseAddress(raw: string): { email: string; name?: string } {
  const match = raw.match(/^\s*(?:"?([^"<]*?)"?\s*)?<\s*([^>]+)\s*>\s*$/);
  if (match) {
    const name = match[1]?.trim();
    return name ? { email: match[2]!.trim(), name } : { email: match[2]!.trim() };
  }
  return { email: raw.trim() };
}

function describeError(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    const message = (err as { message?: unknown }).message;
    return [typeof code === "string" ? code : null, typeof message === "string" ? message : null]
      .filter(Boolean)
      .join(": ")
      .slice(0, 300);
  }
  return String(err).slice(0, 300);
}

/**
 * Email transport. "cloudflare" sends through the Cloudflare Email Sending binding; "console"
 * logs instead (local development). Every HTML body is wrapped in the branded layout.
 */
export function createEmailSender(env: {
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  APP_URL?: string;
  binding?: CloudflareEmailBinding | null;
}): EmailSender {
  const configured = env.EMAIL_PROVIDER?.trim().toLowerCase() ?? "";
  const provider = configured || (env.binding ? "cloudflare" : "console");
  const defaultFrom = env.EMAIL_FROM?.trim() || "Collate <noreply@collateresearch.app>";
  const defaultReplyTo = env.EMAIL_REPLY_TO?.trim() || undefined;
  const wrap = (html: string) => wrapEmailHtml(html, { appUrl: env.APP_URL });

  if (provider === "cloudflare" && env.binding) {
    const binding = env.binding;
    return {
      async send(message: EmailMessage): Promise<EmailSendResult> {
        try {
          const result = await binding.send({
            from: parseAddress(message.from ?? defaultFrom),
            to: message.to,
            subject: message.subject,
            text: message.text,
            html: wrap(message.html),
            ...((message.replyTo ?? defaultReplyTo)
              ? { replyTo: message.replyTo ?? defaultReplyTo }
              : {}),
            ...(message.headers ? { headers: message.headers } : {}),
            ...(message.attachments?.length
              ? {
                  attachments: message.attachments.map((a) => ({
                    content: a.content,
                    filename: a.filename,
                    type: a.type,
                    disposition: a.disposition ?? "attachment",
                    ...(a.contentId ? { contentId: a.contentId } : {}),
                  })),
                }
              : {}),
          });
          return {
            ok: true,
            provider: "cloudflare",
            messageId:
              (result && "messageId" in result ? result.messageId : undefined) ?? undefined,
          };
        } catch (err) {
          const reason = describeError(err);
          console.error(
            JSON.stringify({
              level: "error",
              event: "cloudflare_email_send_failed",
              subject: message.subject,
              error: reason,
            })
          );
          return { ok: false, provider: "cloudflare", error: reason };
        }
      },
    };
  }

  if (provider === "cloudflare" && !env.binding) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "email_binding_missing",
        provider: "cloudflare",
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

function greeting(name: string): string {
  return `Hi ${name.trim() || "there"},`;
}

export function buildVerificationEmail(params: {
  name: string;
  verifyUrl: string;
  code: string;
}): Omit<EmailMessage, "to"> {
  return {
    subject: `${params.code} is your Collate verification code`,
    text: [
      greeting(params.name),
      "",
      `Your verification code is ${params.code}. It expires in 10 minutes.`,
      "",
      "Or confirm your email with this link (valid for 24 hours):",
      params.verifyUrl,
      "",
      "If you did not create a Collate account, you can ignore this email.",
    ].join("\n"),
    html: `<p>${escapeEmailHtml(greeting(params.name))}</p><p>Enter this code to confirm your email address. It expires in 10 minutes.</p>${codeBlockHtml(params.code)}<p>Or confirm with one click:</p>${buttonHtml("Verify email address", params.verifyUrl)}<p style="color:#6b7280;font-size:13px">If you did not create a Collate account, you can ignore this email.</p>`,
  };
}

export function buildPasswordResetEmail(params: {
  name: string;
  code: string;
}): Omit<EmailMessage, "to"> {
  return {
    subject: `${params.code} is your Collate password reset code`,
    text: [
      greeting(params.name),
      "",
      `Your password reset code is ${params.code}. It expires in 10 minutes and works once.`,
      "",
      "If you did not ask to reset your password, you can ignore this email. Your password stays the same.",
    ].join("\n"),
    html: `<p>${escapeEmailHtml(greeting(params.name))}</p><p>Enter this code to choose a new password. It expires in 10 minutes and works once.</p>${codeBlockHtml(params.code)}<p style="color:#6b7280;font-size:13px">If you did not ask to reset your password, you can ignore this email. Your password stays the same.</p>`,
  };
}

export function buildEmailChangeCodeEmail(params: {
  name: string;
  code: string;
  step: "confirm_current" | "confirm_new";
}): Omit<EmailMessage, "to"> {
  const intro =
    params.step === "confirm_current"
      ? "You asked to change the email address on your Collate account. Enter this code to confirm it is you."
      : "Enter this code to confirm this new email address for your Collate account.";
  return {
    subject: `${params.code} is your Collate confirmation code`,
    text: [
      greeting(params.name),
      "",
      intro,
      "",
      `Code: ${params.code} (expires in 10 minutes)`,
      "",
      "If you did not ask for this, ignore this email and consider changing your password.",
    ].join("\n"),
    html: `<p>${escapeEmailHtml(greeting(params.name))}</p><p>${escapeEmailHtml(intro)} It expires in 10 minutes.</p>${codeBlockHtml(params.code)}<p style="color:#6b7280;font-size:13px">If you did not ask for this, ignore this email and consider changing your password.</p>`,
  };
}

export function buildSecurityNoticeEmail(params: {
  name: string;
  subject: string;
  message: string;
}): Omit<EmailMessage, "to"> {
  return {
    subject: params.subject,
    text: [
      greeting(params.name),
      "",
      params.message,
      "",
      "If this was not you, reset your password straight away and contact support.",
    ].join("\n"),
    html: `<p>${escapeEmailHtml(greeting(params.name))}</p><p>${escapeEmailHtml(params.message)}</p><p style="color:#6b7280;font-size:13px">If this was not you, reset your password straight away and contact support.</p>`,
  };
}
