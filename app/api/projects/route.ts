import { handleListProjects } from "../../../src/lib/auth/http-handlers";
import { buildWorkerAuthDeps } from "../../../src/lib/auth/route-deps";
import { handleCreateProjectDraft } from "../../../src/lib/wizard/http-handlers";

export async function GET(request: Request): Promise<Response> {
  return handleListProjects(request, buildWorkerAuthDeps(request));
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateProjectDraft(request, buildWorkerAuthDeps(request));
}
