import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleApproveChapter } from "@/lib/writing/http-handlers";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; chapterId: string }> }
): Promise<Response> {
  const { id, chapterId } = await context.params;
  return handleApproveChapter(request, id, chapterId, buildWorkerAuthDeps(request));
}
