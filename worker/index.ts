import handler from "vinext/server/app-router-entry";
import { applySecurityHeaders, sanitizeIncomingRequest } from "@/lib/security/headers";

export { HelloSleepWorkflow } from "./workflows/hello-sleep";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cleanRequest = sanitizeIncomingRequest(request);
    const response = await handler.fetch(cleanRequest);
    const isProd = env.APP_ENV === "prod";
    return applySecurityHeaders(response, isProd);
  },
};
