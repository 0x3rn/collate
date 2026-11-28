import handler from "vinext/server/app-router-entry";
import { createDb } from "@/db/client";
import { purgeExpiredRecords } from "@/lib/account/retention";
import { resolvePolarApiBaseUrl } from "@/lib/billing/http-handlers";
import { syncPolarDisputes } from "@/lib/billing/polar-disputes";
import { readMailboxConfig } from "@/lib/inbox/config";
import { type InboxBucket, receiveInboundEmail } from "@/lib/inbox/store";
import { createTelegramNotifier } from "@/lib/notify/admin-alerts";
import { logEvent } from "@/lib/observability/logger";
import { applySecurityHeaders, sanitizeIncomingRequest } from "@/lib/security/headers";

export { BroadcastEmailWorkflow } from "./workflows/broadcast-email";
export { HelloSleepWorkflow } from "./workflows/hello-sleep";
export { ResearchSweepWorkflow } from "./workflows/research-sweep";
export { WriteChapterWorkflow } from "./workflows/write-chapter";

/** What Cloudflare Email Routing hands the Worker for each incoming email. */
interface IncomingEmail {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
}

const MAX_INBOUND_BYTES = 25 * 1024 * 1024;

export default {
  /** Hourly: pick up new or changed Polar payment disputes. */
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const runtimeEnv = env as unknown as Record<string, string | undefined>;
    const result = await syncPolarDisputes(createDb(env.DB), {
      accessToken: runtimeEnv.POLAR_ACCESS_TOKEN,
      apiBase: resolvePolarApiBaseUrl(runtimeEnv.POLAR_ENVIRONMENT),
      notifier: createTelegramNotifier(runtimeEnv),
    });
    logEvent(result.ok ? "info" : "warn", "billing.polar_dispute_sync", { data: { ...result } });

    // Drop records of deleted accounts that have reached the end of their retention period.
    const purged = await purgeExpiredRecords(createDb(env.DB), new Date());
    if (purged.evidenceCleared || purged.recordsDeleted) {
      logEvent("info", "account.retention_purge", { data: { ...purged } });
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const cleanRequest = sanitizeIncomingRequest(request);
    const response = await handler.fetch(cleanRequest);
    const isProd = env.APP_ENV === "prod";
    return applySecurityHeaders(response, isProd);
  },

  /**
   * Incoming mail for support@, billing@, disputes@ and hello@ (routed here by Cloudflare Email Routing).
   * Each email is stored in the admin inbox tab for its address.
   */
  async email(message: IncomingEmail, env: Env): Promise<void> {
    if (message.rawSize > MAX_INBOUND_BYTES) {
      message.setReject("Message too large");
      return;
    }
    const runtimeEnv = env as unknown as Record<string, unknown>;
    try {
      // Buffer message.raw once before parsing (Cloudflare's raw stream is single-use).
      const rawBuffer = await new Response(message.raw).arrayBuffer();
      await receiveInboundEmail(
        { from: message.from, to: message.to, raw: rawBuffer },
        {
          db: createDb(env.DB),
          bucket: runtimeEnv.FILES as unknown as InboxBucket,
          mailboxes: readMailboxConfig(runtimeEnv),
          notifier: createTelegramNotifier(runtimeEnv as Record<string, string | undefined>),
        }
      );
    } catch (err) {
      logEvent("error", "inbound_email_failed", {
        data: { to: message.to, reason: err instanceof Error ? err.message : String(err) },
      });
      // Temporary failure: the sending server retries later instead of the mail being lost.
      throw err;
    }
    // Optional copy to a personal mailbox (must be a verified Email Routing destination).
    const copyTo =
      typeof runtimeEnv.EMAIL_FORWARD_COPY_TO === "string"
        ? runtimeEnv.EMAIL_FORWARD_COPY_TO.trim()
        : "";
    if (copyTo) {
      try {
        await message.forward(copyTo);
      } catch (err) {
        logEvent("warn", "inbound_email_copy_failed", {
          data: { reason: err instanceof Error ? err.message : String(err) },
        });
      }
    }
  },
};
