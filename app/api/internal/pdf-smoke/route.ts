import { env } from "cloudflare:workers";
import { logEvent } from "../../../../src/lib/observability/logger";
import {
  buildPhase0SmokeHtml,
  renderHtmlToPdfAndStore,
  type BrowserRunPdfBinding,
} from "../../../../src/lib/pdf/render-pdf";
import { authorizeInternalRequest } from "../../../../src/lib/security/internal-auth";

export async function POST(request: Request): Promise<Response> {
  const auth = authorizeInternalRequest(request, {
    APP_ENV: env.APP_ENV,
    INTERNAL_SMOKE_TOKEN: (env as unknown as Record<string, string | undefined>)
      .INTERNAL_SMOKE_TOKEN,
  });
  if (!auth.authorized) {
    return Response.json({ ok: false, error: auth.reason }, { status: auth.status });
  }

  const nowIso = new Date().toISOString();
  const r2Key = `smoke/phase-0-${Date.now()}.pdf`;

  const result = await renderHtmlToPdfAndStore(
    {
      html: buildPhase0SmokeHtml(nowIso),
      r2Key,
      format: "A4",
      headerTemplate:
        '<div style="font-size:8px;width:100%;text-align:right;padding-right:20mm;color:#71717a;">Collate Smoke Test</div>',
      footerTemplate:
        '<div style="font-size:8px;width:100%;text-align:center;color:#71717a;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    },
    {
      browser: env.BROWSER as unknown as BrowserRunPdfBinding,
      bucket: env.FILES,
    }
  );

  logEvent("info", "pdf_smoke_rendered", {
    data: { r2Key: result.r2Key, sizeBytes: result.sizeBytes },
  });

  return Response.json({ ok: true, ...result }, { status: 201 });
}
