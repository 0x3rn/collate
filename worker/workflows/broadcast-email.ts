import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { createDb } from "@/db/client";
import { emailBroadcasts } from "@/db/schema";
import { type CloudflareEmailBinding, createEmailSender } from "@/lib/email/mailer";
import { listBroadcastRecipients, sendBroadcastBatch } from "@/lib/inbox/broadcast";
import { readMailboxConfig } from "@/lib/inbox/config";

export interface BroadcastPayload {
  broadcastId: string;
}

const BATCH_SIZE = 25;
const MAX_BATCHES = 400; // 10,000 recipients per broadcast

/**
 * Sends an announcement or promotion in batches of 25. Each batch is a durable step, so a
 * restart resumes after the last finished batch and nobody is emailed twice.
 */
export class BroadcastEmailWorkflow extends WorkflowEntrypoint<Env, BroadcastPayload> {
  async run(event: WorkflowEvent<BroadcastPayload>, step: WorkflowStep): Promise<{ sent: number }> {
    const runtimeEnv = this.env as unknown as Record<string, unknown>;
    const db = createDb(this.env.DB);
    const appUrl =
      (runtimeEnv.APP_URL as string | undefined)?.trim() || "https://collateresearch.app";
    const secret =
      (runtimeEnv.EMAIL_UNSUBSCRIBE_SECRET as string | undefined) ||
      (runtimeEnv.EXPORT_SIGNING_SECRET as string | undefined) ||
      "";
    const mailer = createEmailSender({
      EMAIL_PROVIDER: runtimeEnv.EMAIL_PROVIDER as string | undefined,
      EMAIL_FROM: runtimeEnv.EMAIL_FROM as string | undefined,
      APP_URL: appUrl,
      binding: (runtimeEnv.EMAIL as CloudflareEmailBinding | undefined) ?? null,
    });
    const mailboxes = readMailboxConfig(runtimeEnv);

    const broadcast = await step.do("load-broadcast", async () => {
      const [row] = await db
        .select()
        .from(emailBroadcasts)
        .where(eq(emailBroadcasts.id, event.payload.broadcastId))
        .limit(1);
      if (!row) throw new Error("Broadcast not found");
      return { id: row.id, kind: row.kind, subject: row.subject, body: row.body };
    });

    let afterId: string | undefined;
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const result = await step.do(
        `send-batch-${batch}`,
        { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" } },
        async () => {
          const recipients = await listBroadcastRecipients(db, broadcast.kind, {
            afterId,
            limit: BATCH_SIZE,
          });
          if (recipients.length === 0) return { done: true, lastId: null, sent: 0, failed: 0 };
          const counts = await sendBroadcastBatch(
            { kind: broadcast.kind, subject: broadcast.subject, body: broadcast.body, recipients },
            { mailer, mailboxes, appUrl, unsubscribeSecret: secret }
          );
          await db
            .update(emailBroadcasts)
            .set({
              sentCount: sql`${emailBroadcasts.sentCount} + ${counts.sent}`,
              failedCount: sql`${emailBroadcasts.failedCount} + ${counts.failed}`,
            })
            .where(eq(emailBroadcasts.id, broadcast.id));
          return {
            done: recipients.length < BATCH_SIZE,
            lastId: recipients[recipients.length - 1]!.id,
            ...counts,
          };
        }
      );
      total += result.sent;
      if (result.done || !result.lastId) break;
      afterId = result.lastId;
    }

    await step.do("finish", async () => {
      await db
        .update(emailBroadcasts)
        .set({ status: "sent", finishedAt: new Date() })
        .where(eq(emailBroadcasts.id, broadcast.id));
    });
    return { sent: total };
  }
}
