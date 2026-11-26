import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleGetCookieConsent, handleSaveCookieConsent } from "@/lib/privacy/http-handlers";

export async function GET(request: Request): Promise<Response> {
  return handleGetCookieConsent(request, buildWorkerAuthDeps(request));
}

export async function POST(request: Request): Promise<Response> {
  return handleSaveCookieConsent(request, buildWorkerAuthDeps(request));
}
