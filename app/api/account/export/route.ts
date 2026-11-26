import { env } from "cloudflare:workers";
import { handleExportMyData } from "@/lib/account/data-export";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import type { BrowserRunPdfBinding } from "@/lib/pdf/render-pdf";

export async function GET(request: Request): Promise<Response> {
  return handleExportMyData(request, {
    ...buildWorkerAuthDeps(request),
    browser: env.BROWSER as unknown as BrowserRunPdfBinding,
  });
}
