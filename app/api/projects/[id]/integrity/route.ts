import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleGetProjectIntegrity } from "@/lib/originality/http-handlers";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleGetProjectIntegrity(request, id, buildWorkerAuthDeps(request));
}
