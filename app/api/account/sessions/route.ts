import { handleListSessions } from "@/lib/account/security";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";

export async function GET(request: Request): Promise<Response> {
  return handleListSessions(request, buildWorkerAuthDeps(request));
}
