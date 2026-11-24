import { z } from "zod";

export const RenderPdfInputSchema = z.object({
  html: z.string().trim().min(1, "HTML content is required").max(2_000_000, "HTML exceeds 2MB cap"),
  r2Key: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9/._-]+$/, "Invalid R2 object key")
    .refine((key) => !key.includes(".."), "Path traversal is not allowed in R2 keys"),
  format: z
    .enum(["a4", "letter", "A4", "Letter"])
    .default("a4")
    .transform((v) => v.toLowerCase() as "a4" | "letter"),
  headerTemplate: z.string().optional(),
  footerTemplate: z.string().optional(),
});

export type RenderPdfInput = z.input<typeof RenderPdfInputSchema>;

export interface BrowserRunPdfBinding {
  quickAction(
    action: "pdf",
    options: {
      html: string;
      pdfOptions?: {
        format?: "a4" | "letter";
        printBackground?: boolean;
        displayHeaderFooter?: boolean;
        headerTemplate?: string;
        footerTemplate?: string;
        margin?: { top: string; right: string; bottom: string; left: string };
      };
    }
  ): Promise<Response>;
}

export interface R2WritableBucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    }
  ): Promise<unknown>;
}

export interface RenderPdfResult {
  r2Key: string;
  sizeBytes: number;
  sha256: string;
  contentType: "application/pdf";
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export function hasPdfMagicHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((byte, idx) => bytes[idx] === byte);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildPhase0SmokeHtml(generatedAtIso: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Collate — Phase 0 PDF Smoke Test</title>
    <style>
      @page { size: A4; margin: 25mm; }
      body { font-family: Georgia, "Times New Roman", serif; color: #18181b; line-height: 1.6; }
      h1 { font-size: 22pt; margin-bottom: 8pt; }
      p { font-size: 12pt; }
      .meta { margin-top: 24pt; padding-top: 12pt; border-top: 1px solid #d4d4d8; font-size: 10pt; color: #52525b; }
    </style>
  </head>
  <body>
    <h1>Collate PDF Engine Verification</h1>
    <p>This document was rendered server-side via Cloudflare Browser Run (/pdf) and stored in Cloudflare R2.</p>
    <div class="meta">Generated at (UTC): ${generatedAtIso}</div>
  </body>
</html>`;
}

/**
 * Renders HTML into a real PDF via Cloudflare Browser Run and persists it into R2.
 */
export async function renderHtmlToPdfAndStore(
  rawInput: RenderPdfInput,
  deps: {
    browser: BrowserRunPdfBinding;
    bucket: R2WritableBucket;
  }
): Promise<RenderPdfResult> {
  const input = RenderPdfInputSchema.parse(rawInput);

  const displayHeaderFooter = Boolean(input.headerTemplate || input.footerTemplate);
  const response = await deps.browser.quickAction("pdf", {
    html: input.html,
    pdfOptions: {
      format: input.format,
      printBackground: true,
      displayHeaderFooter,
      ...(input.headerTemplate ? { headerTemplate: input.headerTemplate } : {}),
      ...(input.footerTemplate ? { footerTemplate: input.footerTemplate } : {}),
      margin: {
        top: "25mm",
        right: "25mm",
        bottom: "25mm",
        left: "25mm",
      },
    },
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Browser Run /pdf failed (HTTP ${response.status}): ${errText.slice(0, 300)}`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!hasPdfMagicHeader(bytes)) {
    throw new Error("Browser Run /pdf returned invalid payload (missing %PDF- signature)");
  }

  const sha256 = await sha256Hex(bytes);

  await deps.bucket.put(input.r2Key, bytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: {
      sha256,
      renderer: "cloudflare-browser-run",
    },
  });

  return {
    r2Key: input.r2Key,
    sizeBytes: bytes.byteLength,
    sha256,
    contentType: "application/pdf",
  };
}
