import { handleServeEmailAsset } from "@/lib/inbox/http-handlers";
import { buildInboxDeps } from "@/lib/inbox/route-deps";

/** Public images used in announcements and promotions (mail apps load them without signing in). */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleServeEmailAsset(id, buildInboxDeps(request));
}
