import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleCreateExport, type R2ReadWriteBucket } from "@/lib/export/http-handlers";
import type { BrowserRunPdfBinding } from "@/lib/pdf/render-pdf";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return handleCreateExport(request, id, {
    ...buildWorkerAuthDeps(request),
    bucket: env.FILES as unknown as R2ReadWriteBucket,
    browser: env.BROWSER as unknown as BrowserRunPdfBinding,
    signingSecret: runtimeEnv.EXPORT_SIGNING_SECRET,
  });
}
