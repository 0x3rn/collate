import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleAdminSearchPayments } from "@/lib/billing/http-handlers";

export async function GET(request: Request): Promise<Response> {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return handleAdminSearchPayments(request, {
    ...buildWorkerAuthDeps(request),
    adminEmails: runtimeEnv.ADMIN_EMAILS,
  });
}
