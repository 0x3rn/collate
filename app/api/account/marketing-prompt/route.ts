import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleRespondMarketingPrompt } from "@/lib/email/prefs-handlers";

export async function POST(request: Request): Promise<Response> {
  return handleRespondMarketingPrompt(request, buildWorkerAuthDeps(request));
}
