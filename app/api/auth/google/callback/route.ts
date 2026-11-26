import { handleGoogleCallback } from "@/lib/auth/google";
import { buildGoogleAuthDeps } from "@/lib/auth/route-deps";

export async function GET(request: Request): Promise<Response> {
  return handleGoogleCallback(request, buildGoogleAuthDeps(request));
}
