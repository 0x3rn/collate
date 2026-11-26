import { handleListBroadcasts, handleSendBroadcast } from "@/lib/inbox/http-handlers";
import { buildInboxDeps } from "@/lib/inbox/route-deps";

export async function GET(request: Request): Promise<Response> {
  return handleListBroadcasts(request, buildInboxDeps(request));
}

export async function POST(request: Request): Promise<Response> {
  return handleSendBroadcast(request, buildInboxDeps(request));
}
