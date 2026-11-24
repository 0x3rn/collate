import { buildWorkerAuthDeps } from "../../../../../src/lib/auth/route-deps";
import { handleUpdateProjectSettings } from "../../../../../src/lib/wizard/http-handlers";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleUpdateProjectSettings(request, id, buildWorkerAuthDeps(request));
}
