import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleAdminOverview } from "@/lib/billing/http-handlers";

export async function GET(request: Request): Promise<Response> {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return handleAdminOverview(request, {
    ...buildWorkerAuthDeps(request),
    adminEmails: runtimeEnv.ADMIN_EMAILS,
  });
}
