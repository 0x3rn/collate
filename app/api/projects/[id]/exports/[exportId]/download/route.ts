import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleDownloadExport, type R2ReadWriteBucket } from "@/lib/export/http-handlers";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; exportId: string }> }
): Promise<Response> {
  const { id, exportId } = await context.params;
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return handleDownloadExport(request, id, exportId, {
    ...buildWorkerAuthDeps(request),
    bucket: env.FILES as unknown as R2ReadWriteBucket,
    signingSecret: runtimeEnv.EXPORT_SIGNING_SECRET,
  });
}
