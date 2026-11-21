import { sanitizeErrorMessage } from "@/lib/ai/errors";
import { scrubSensitiveFields } from "./logger";

export interface ParsedSentryDsn {
  envelopeUrl: string;
  publicKey: string;
  projectId: string;
}

export function parseSentryDsn(dsn: string | undefined): ParsedSentryDsn | null {
  const trimmed = dsn?.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const publicKey = url.username;
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!publicKey || !projectId) return null;

  const basePath = segments.length > 0 ? `/${segments.join("/")}` : "";
  return {
    envelopeUrl: `${url.protocol}//${url.host}${basePath}/api/${projectId}/envelope/`,
    publicKey,
    projectId,
  };
}

export interface CaptureSentryOptions {
  dsn?: string;
  environment?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  fetchFn?: typeof fetch;
}

/**
 * Lightweight Cloudflare-Workers-native Sentry envelope sender.
 * Never throws or leaks secrets if Sentry is unreachable or unconfigured.
 */
export async function captureExceptionToSentry(
  error: unknown,
  options: CaptureSentryOptions = {}
): Promise<{ sent: boolean; eventId?: string; reason?: string }> {
  const parsed = parseSentryDsn(options.dsn);
  if (!parsed) {
    return { sent: false, reason: "sentry_dsn_not_configured" };
  }

  const errObj = error instanceof Error ? error : new Error(String(error));
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const timestamp = new Date().toISOString();

  const header = JSON.stringify({
    event_id: eventId,
    sent_at: timestamp,
    dsn: options.dsn,
  });

  const itemHeader = JSON.stringify({ type: "event" });
  const payload = JSON.stringify({
    event_id: eventId,
    timestamp,
    platform: "javascript",
    level: "error",
    environment: options.environment ?? "dev",
    tags: options.tags ?? {},
    extra: options.extra ? scrubSensitiveFields(options.extra) : {},
    exception: {
      values: [
        {
          type: errObj.name || "Error",
          value: sanitizeErrorMessage(errObj.message || "Unknown error"),
        },
      ],
    },
  });

  const envelope = `${header}\n${itemHeader}\n${payload}`;
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  try {
    const response = await fetchFn(parsed.envelopeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=collate-worker/0.4`,
      },
      body: envelope,
    });
    return response.ok
      ? { sent: true, eventId }
      : { sent: false, eventId, reason: `http_${response.status}` };
  } catch {
    return { sent: false, eventId, reason: "network_error" };
  }
}
