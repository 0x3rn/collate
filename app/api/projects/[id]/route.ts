import { env } from "cloudflare:workers";
import { handleDeleteProject } from "@/lib/account/delete-project";
import type { R2DeletableBucket } from "@/lib/account/delete-account";
import { handleGetProjectById } from "@/lib/auth/http-handlers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleGetProjectById(request, id, buildWorkerAuthDeps(request));
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleDeleteProject(request, id, {
    ...buildWorkerAuthDeps(request),
    bucket: env.FILES as unknown as R2DeletableBucket,
  });
}
