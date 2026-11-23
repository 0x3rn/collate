import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleStartAssignment } from "@/lib/writing/http-handlers";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleStartAssignment(request, id, {
    ...buildWorkerAuthDeps(request),
    workflowLauncher: env.WRITE_CHAPTER_WORKFLOW,
  });
}
