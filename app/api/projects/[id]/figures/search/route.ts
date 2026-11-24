import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import { handleListProjectFigures, handleSearchProjectFigures } from "@/lib/research/figures-http";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleListProjectFigures(request, id, buildWorkerAuthDeps(request));
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleSearchProjectFigures(request, id, buildWorkerAuthDeps(request));
}
