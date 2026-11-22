import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "../../../../../src/lib/auth/route-deps";
import { handleUploadProjectDataset } from "../../../../../src/lib/writing/http-handlers";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleUploadProjectDataset(request, id, {
    ...buildWorkerAuthDeps(request),
    bucket: env.FILES,
  });
}
