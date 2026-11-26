import { handleChangePassword } from "@/lib/account/security";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";

export async function POST(request: Request): Promise<Response> {
  return handleChangePassword(request, buildWorkerAuthDeps(request));
}
