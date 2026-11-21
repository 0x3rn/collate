import { env } from "cloudflare:workers";
import { buildWorkerAuthDeps } from "../../../../../src/lib/auth/route-deps";
import {
  handleGetResearchStatus,
  handleStartResearchSweep,
} from "../../../../../src/lib/research/http-handlers";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleGetResearchStatus(request, id, buildWorkerAuthDeps(request));
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleStartResearchSweep(request, id, {
    ...buildWorkerAuthDeps(request),
    workflowLauncher: env.RESEARCH_SWEEP_WORKFLOW,
  });
}
