import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import type { R2WritableBucket } from "@/lib/pdf/render-pdf";
import { handleSaveChapterInstructions } from "@/lib/writing/http-handlers";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; chapterId: string }> }
): Promise<Response> {
  const { id, chapterId } = await context.params;
  return handleSaveChapterInstructions(request, id, chapterId, {
    ...buildWorkerAuthDeps(request),
    bucket: env.FILES as unknown as R2WritableBucket,
  });
}
