import { BODY_FONT_FACE, BRAND_FONT_FACES } from "./brand-fonts";

/**
 * Shared look for server-made PDFs (transaction records, data exports): the Collate logo and
 * wordmark at the top left, the site fonts, and a page-numbered footer. Every value passed in
 * as text is escaped by the helpers below.
 */

export const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const when = (d: Date | null | undefined) =>
  d
    ? d.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC"
    : "—";

export const money = (currency: string, minor: number) =>
  `${currency.toUpperCase()} ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** Label / value rows. */
export function rows(pairs: Array<[string, string]>): string {
  return `<table class="kv">${pairs
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join("")}</table>`;
}

/** A table with a header row; cells are escaped. */
export function grid(headers: string[], body: string[][], empty: string): string {
  if (body.length === 0) return `<p class="muted">${esc(empty)}</p>`;
  return `<table class="grid"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

// The Collate mark (same paths as the site logo), in Oxford Slate Blue.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="27" height="27" fill="none" aria-hidden="true"><path d="M 26.86 7.6 A 12.8 12.8 0 1 0 26.86 24.4 L 23.92 21.84 A 8.9 8.9 0 1 1 23.92 10.16 Z" fill="#1e3a5f"/><path d="M 24.21 11.47 A 6.9 6.9 0 1 0 24.21 20.53 L 21.64 18.3 A 3.5 3.5 0 1 1 21.64 13.7 Z" fill="#1e3a5f"/></svg>`;

const CSS = `
  ${BRAND_FONT_FACES}
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Plus Jakarta Sans", sans-serif; color: #26231f; font-size: 9.5pt; line-height: 1.55; }
  .top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 7px; }
  .brand svg { display: block; }
  .brand span { font-family: "Newsreader", serif; font-weight: 600; font-size: 17pt; line-height: 1; color: #171614; letter-spacing: -0.025em; }
  .meta { text-align: right; font-size: 8pt; color: #756f64; }
  .meta strong { display: block; font-family: "Newsreader", serif; font-weight: 600; color: #171614; font-size: 11pt; letter-spacing: -0.015em; }
  h1 { font-family: "Newsreader", serif; font-weight: 500; font-size: 18pt; letter-spacing: -0.015em; line-height: 1.2; margin: 0 0 4px 0; color: #171614; }
  .sub { color: #756f64; margin: 0 0 16px 0; }
  h2 { font-family: "Newsreader", serif; font-weight: 500; font-size: 13pt; letter-spacing: -0.015em; color: #171614; margin: 20px 0 6px 0; padding-bottom: 4px; border-bottom: 1px solid #e6e2da; break-after: avoid; }
  h3 { font-family: "Newsreader", serif; font-weight: 500; font-size: 11pt; color: #171614; margin: 12px 0 4px 0; break-after: avoid; }
  .statement { background: #f3f1ec; border-left: 3px solid #1e3a5f; padding: 10px 12px; text-align: justify; }
  table { width: 100%; border-collapse: collapse; break-inside: auto; }
  tr { break-inside: avoid; }
  .kv th { text-align: left; width: 150px; color: #756f64; font-weight: normal; vertical-align: top; padding: 3px 10px 3px 0; }
  .kv td { padding: 3px 0; }
  .grid { font-size: 8.5pt; }
  .grid th { text-align: left; color: #756f64; font-weight: normal; border-bottom: 1px solid #d2ccc0; padding: 4px 6px 4px 0; }
  .grid td { border-bottom: 1px solid #efece6; padding: 4px 6px 4px 0; vertical-align: top; }
  .nowrap { white-space: nowrap; }
  .ref { word-break: break-all; }
  .muted { color: #756f64; margin: 4px 0; }
  .ips { color: #575249; font-size: 8.5pt; margin-top: 6px; word-break: break-all; }
`;

/** A complete branded HTML document. `bodyHtml` must already be escaped/trusted markup. */
export function brandDocument(params: {
  documentTitle: string;
  generatedAt: Date;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(params.documentTitle)}</title>
<style>${CSS}</style></head><body>
<div class="top">
  <div class="brand">${LOGO_SVG}<span>Collate</span></div>
  <div class="meta"><strong>${esc(params.documentTitle)}</strong>Prepared ${esc(when(params.generatedAt))}<br>collateresearch.app</div>
</div>
${params.bodyHtml}
</body></html>`;
}

/** Page footer for Chromium's PDF footer template (it cannot see the page's fonts). */
export function brandFooter(label: string): string {
  return `<style>${BODY_FONT_FACE}</style><div style="font-family:&quot;Plus Jakarta Sans&quot;,sans-serif;font-size:7.5pt;color:#756f64;width:100%;padding:0 16mm;display:flex;justify-content:space-between;"><span>Collate · ${esc(label)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}
