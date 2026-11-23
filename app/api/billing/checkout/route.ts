import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleCreateCheckout } from "@/lib/billing/http-handlers";

export async function POST(request: Request): Promise<Response> {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return handleCreateCheckout(request, {
    ...buildWorkerAuthDeps(request),
    paystackSecretKey: runtimeEnv.PAYSTACK_SECRET_KEY,
    stripeSecretKey: runtimeEnv.STRIPE_SECRET_KEY,
  });
}
