import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleStripeWebhook } from "@/lib/billing/http-handlers";

export async function POST(request: Request): Promise<Response> {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return handleStripeWebhook(request, {
    ...buildWorkerAuthDeps(request),
    stripeWebhookSecret: runtimeEnv.STRIPE_WEBHOOK_SECRET,
  });
}
