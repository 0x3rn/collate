import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleCreateCheckout } from "@/lib/billing/http-handlers";

export async function POST(request: Request): Promise<Response> {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return handleCreateCheckout(request, {
    ...buildWorkerAuthDeps(request),
    paystackSecretKey: runtimeEnv.PAYSTACK_SECRET_KEY,
    polarAccessToken: runtimeEnv.POLAR_ACCESS_TOKEN,
    polarEnvironment: runtimeEnv.POLAR_ENVIRONMENT,
    polarProductIds: {
      pack_starter_25: runtimeEnv.POLAR_PRODUCT_ID_STARTER,
      pack_project_60: runtimeEnv.POLAR_PRODUCT_ID_PROJECT,
      pack_thesis_150: runtimeEnv.POLAR_PRODUCT_ID_THESIS,
    },
    stripeSecretKey: runtimeEnv.STRIPE_SECRET_KEY,
  });
}
