import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleCancelCheckout } from "@/lib/billing/http-handlers";

export async function POST(request: Request): Promise<Response> {
  return handleCancelCheckout(request, buildWorkerAuthDeps(request));
}
