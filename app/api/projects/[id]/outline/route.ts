import { buildWorkerAuthDeps } from "../../../../../src/lib/auth/route-deps";
import { handleGetOutline, handleSaveOutline } from "../../../../../src/lib/outline/http-handlers";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleGetOutline(request, id, buildWorkerAuthDeps(request));
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleSaveOutline(request, id, buildWorkerAuthDeps(request));
}
