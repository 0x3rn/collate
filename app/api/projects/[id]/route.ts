import { handleGetProjectById } from "../../../../src/lib/auth/http-handlers";
import { buildWorkerAuthDeps } from "../../../../src/lib/auth/route-deps";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleGetProjectById(request, id, buildWorkerAuthDeps(request));
}
