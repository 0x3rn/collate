import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import type { R2ReadWriteBucket } from "@/lib/export/http-handlers";
import {
  handleGetChapterReader,
  handleSaveChapterLightEdit,
} from "@/lib/writing/chapter-reader-handlers";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; chapterId: string }> }
): Promise<Response> {
  const { id, chapterId } = await context.params;
  return handleGetChapterReader(request, id, chapterId, {
    ...buildWorkerAuthDeps(request),
    bucket: env.FILES as unknown as R2ReadWriteBucket,
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; chapterId: string }> }
): Promise<Response> {
  const { id, chapterId } = await context.params;
  return handleSaveChapterLightEdit(request, id, chapterId, {
    ...buildWorkerAuthDeps(request),
    bucket: env.FILES as unknown as R2ReadWriteBucket,
  });
}
