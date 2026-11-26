import { handleUploadEmailAsset } from "@/lib/inbox/http-handlers";
import { buildInboxDeps } from "@/lib/inbox/route-deps";

export async function POST(request: Request): Promise<Response> {
  return handleUploadEmailAsset(request, buildInboxDeps(request));
}
