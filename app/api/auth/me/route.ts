import { handleGetMe } from "../../../../src/lib/auth/http-handlers";
import { buildWorkerAuthDeps } from "../../../../src/lib/auth/route-deps";

export async function GET(request: Request): Promise<Response> {
  return handleGetMe(request, buildWorkerAuthDeps(request));
}
