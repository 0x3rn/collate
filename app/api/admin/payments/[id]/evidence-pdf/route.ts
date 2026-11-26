import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleAdminEvidencePdf } from "@/lib/billing/http-handlers";
import type { BrowserRunPdfBinding } from "@/lib/pdf/render-pdf";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return handleAdminEvidencePdf(request, id, {
    ...buildWorkerAuthDeps(request),
    adminEmails: runtimeEnv.ADMIN_EMAILS,
    browser: env.BROWSER as unknown as BrowserRunPdfBinding,
  });
}
