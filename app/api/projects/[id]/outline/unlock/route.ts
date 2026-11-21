import { buildWorkerAuthDeps } from "../../../../../../src/lib/auth/route-deps";
import { handleUnlockOutline } from "../../../../../../src/lib/outline/http-handlers";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleUnlockOutline(request, id, buildWorkerAuthDeps(request));
}
