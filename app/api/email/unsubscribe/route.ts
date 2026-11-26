import { handleUnsubscribe } from "@/lib/inbox/http-handlers";
import { buildInboxDeps } from "@/lib/inbox/route-deps";

/** Link in promotion emails (GET) and one-click unsubscribe from the mail app (POST). */
export async function GET(request: Request): Promise<Response> {
  return handleUnsubscribe(request, buildInboxDeps(request));
}

export async function POST(request: Request): Promise<Response> {
  return handleUnsubscribe(request, buildInboxDeps(request));
}
