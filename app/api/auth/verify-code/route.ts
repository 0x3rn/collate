import { handleVerifyCode } from "@/lib/auth/http-handlers";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";

export async function POST(request: Request): Promise<Response> {
  return handleVerifyCode(request, buildWorkerAuthDeps(request));
}
