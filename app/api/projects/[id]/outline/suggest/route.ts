import { env } from "cloudflare:workers";
import type { AIGatewayEnv } from "@/lib/ai/call-llm";
import { buildWorkerAuthDeps } from "../../../../../../src/lib/auth/route-deps";
import { handleSuggestOutline } from "../../../../../../src/lib/outline/http-handlers";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const authDeps = buildWorkerAuthDeps(request);
  const runtimeEnv = env as unknown as AIGatewayEnv;
  return handleSuggestOutline(request, id, {
    ...authDeps,
    llmCtx: { db: authDeps.db, env: runtimeEnv },
  });
}
