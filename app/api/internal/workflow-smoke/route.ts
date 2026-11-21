import { env } from "cloudflare:workers";
import { logEvent } from "../../../../src/lib/observability/logger";
import { authorizeInternalRequest } from "../../../../src/lib/security/internal-auth";
import { HelloSleepPayloadSchema } from "../../../../src/lib/workflows/hello-sleep-logic";

export async function POST(request: Request): Promise<Response> {
  const auth = authorizeInternalRequest(request, {
    APP_ENV: env.APP_ENV,
    INTERNAL_SMOKE_TOKEN: (env as unknown as Record<string, string | undefined>)
      .INTERNAL_SMOKE_TOKEN,
  });
  if (!auth.authorized) {
    return Response.json({ ok: false, error: auth.reason }, { status: auth.status });
  }

  let rawBody: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      rawBody = JSON.parse(text);
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const parsed = HelloSleepPayloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }

  const instance = await env.HELLO_SLEEP_WORKFLOW.create({
    params: parsed.data,
  });

  logEvent("info", "workflow_smoke_started", {
    workflowId: instance.id,
    data: { label: parsed.data.label, sleepDuration: parsed.data.sleepDuration },
  });

  return Response.json(
    {
      ok: true,
      instanceId: instance.id,
      statusUrl: `/api/internal/workflow-smoke?id=${encodeURIComponent(instance.id)}`,
    },
    { status: 202 }
  );
}

export async function GET(request: Request): Promise<Response> {
  const auth = authorizeInternalRequest(request, {
    APP_ENV: env.APP_ENV,
    INTERNAL_SMOKE_TOKEN: (env as unknown as Record<string, string | undefined>)
      .INTERNAL_SMOKE_TOKEN,
  });
  if (!auth.authorized) {
    return Response.json({ ok: false, error: auth.reason }, { status: auth.status });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) {
    return Response.json({ ok: false, error: "Query param 'id' is required" }, { status: 400 });
  }

  const instance = await env.HELLO_SLEEP_WORKFLOW.get(id);
  const status = await instance.status();

  return Response.json({ ok: true, instanceId: id, status }, { status: 200 });
}
