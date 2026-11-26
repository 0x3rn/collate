import { handleGetThread } from "@/lib/inbox/http-handlers";
import { buildInboxDeps } from "@/lib/inbox/route-deps";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleGetThread(request, id, buildInboxDeps(request));
}
