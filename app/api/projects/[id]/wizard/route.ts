import { buildWorkerAuthDeps } from "../../../../../src/lib/auth/route-deps";
import {
  handleGetWizardState,
  handleSaveWizardStep,
} from "../../../../../src/lib/wizard/http-handlers";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleGetWizardState(request, id, buildWorkerAuthDeps(request));
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return handleSaveWizardStep(request, id, buildWorkerAuthDeps(request));
}
