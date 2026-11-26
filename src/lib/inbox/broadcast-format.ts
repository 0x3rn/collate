import { escapeEmailHtml } from "@/lib/email/layout";

/**
 * The safe formatting language used by announcements and promotions (also used by the composer
 * preview in the browser, so this file has no server dependencies):
 *   **bold**  *italic*  [link text](https://…)  ![image description](https://… or /email-assets/…)
 *   "## " heading, "- " list item, blank line between paragraphs.
 * Everything else is escaped, so the result can never contain scripts or arbitrary HTML.
 */

export function safeUrl(raw: string, appUrl: string): string | null {
  const url = raw.trim();
  if (url.startsWith("/email-assets/")) return `${appUrl.replace(/\/+$/, "")}${url}`;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function inline(text: string, appUrl: string): string {
  let out = escapeEmailHtml(text);
  // Images, then links, on the escaped text (brackets and parentheses are not escaped).
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) => {
    const href = safeUrl(url.replaceAll("&amp;", "&"), appUrl);
    return href
      ? `<img src="${escapeEmailHtml(href)}" alt="${alt}" style="display:block;max-width:100%;height:auto;border:0;border-radius:6px;margin:12px 0;">`
      : alt;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const href = safeUrl(url.replaceAll("&amp;", "&"), appUrl);
    return href ? `<a href="${escapeEmailHtml(href)}" style="color:#1e3a5f;">${label}</a>` : label;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return out;
}

export function renderBroadcastHtml(body: string, appUrl: string): string {
  const blocks = body
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*-\s+/.test(l))) {
        return `<ul style="padding-left:20px;margin:0 0 14px 0;">${lines
          .map((l) => `<li style="margin:4px 0;">${inline(l.replace(/^\s*-\s+/, ""), appUrl)}</li>`)
          .join("")}</ul>`;
      }
      if (lines.length === 1 && /^##\s+/.test(lines[0]!)) {
        return `<h2 style="font-size:18px;margin:18px 0 8px 0;color:#111827;">${inline(lines[0]!.replace(/^##\s+/, ""), appUrl)}</h2>`;
      }
      return `<p style="margin:0 0 14px 0;">${lines.map((l) => inline(l, appUrl)).join("<br>")}</p>`;
    })
    .join("");
}

export function renderBroadcastText(body: string, appUrl: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string) => (alt ? `[Image: ${alt}]` : ""))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
      const href = safeUrl(url, appUrl);
      return href ? `${label} (${href})` : label;
    })
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/^##\s+/gm, "")
    .trim();
}
