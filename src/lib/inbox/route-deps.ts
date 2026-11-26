import "server-only";
import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { readMailboxConfig } from "./config";
import type { InboxDeps } from "./http-handlers";
import type { InboxBucket } from "./store";

/** Request settings plus the inbox storage, mailbox addresses and the bulk-send workflow. */
export function buildInboxDeps(request: Request): InboxDeps {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const str = (key: string) =>
    typeof runtimeEnv[key] === "string" ? (runtimeEnv[key] as string) : undefined;
  return {
    ...buildWorkerAuthDeps(request),
    bucket: runtimeEnv.FILES as InboxBucket,
    mailboxes: readMailboxConfig(runtimeEnv),
    adminEmails: str("ADMIN_EMAILS"),
    unsubscribeSecret: str("EMAIL_UNSUBSCRIBE_SECRET") || str("EXPORT_SIGNING_SECRET") || "",
    broadcastLauncher: runtimeEnv.BROADCAST_EMAIL_WORKFLOW as InboxDeps["broadcastLauncher"],
  };
}
