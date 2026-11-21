import { handleSignUp } from "../../../../src/lib/auth/http-handlers";
import { buildWorkerAuthDeps } from "../../../../src/lib/auth/route-deps";

export async function POST(request: Request): Promise<Response> {
  return handleSignUp(request, buildWorkerAuthDeps(request));
}
