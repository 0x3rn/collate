import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleAdminCircuitBreaker } from "@/lib/billing/http-handlers";

export async function POST(request: Request): Promise<Response> {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return handleAdminCircuitBreaker(request, {
    ...buildWorkerAuthDeps(request),
    adminEmails: runtimeEnv.ADMIN_EMAILS,
  });
}
