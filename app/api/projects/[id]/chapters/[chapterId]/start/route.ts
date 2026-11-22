import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleStartChapter } from "@/lib/writing/http-handlers";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; chapterId: string }> }
): Promise<Response> {
  const { id, chapterId } = await context.params;
  return handleStartChapter(request, id, chapterId, {
    ...buildWorkerAuthDeps(request),
    workflowLauncher: env.WRITE_CHAPTER_WORKFLOW,
  });
}
