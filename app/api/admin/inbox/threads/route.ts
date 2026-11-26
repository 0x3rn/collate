import { handleListThreads } from "@/lib/inbox/http-handlers";
import { buildInboxDeps } from "@/lib/inbox/route-deps";

export async function GET(request: Request): Promise<Response> {
  return handleListThreads(request, buildInboxDeps(request));
}
