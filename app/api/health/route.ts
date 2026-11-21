import { buildHealthPayload } from "../../../src/lib/health";

export async function GET(): Promise<Response> {
  const payload = buildHealthPayload({
    appName: process.env.APP_NAME ?? "Collate",
    environment: process.env.APP_ENV ?? "dev",
  });

  return Response.json(payload, {
    status: 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}
