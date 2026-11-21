function removeBlockTag(input: string, tagName: string): string {
  const lowerTagOpen = `<${tagName}`;
  const lowerTagClose = `</${tagName}>`;
  let out = "";
  let cursor = 0;

  while (cursor < input.length) {
    const lowerSlice = input.toLowerCase();
    const start = lowerSlice.indexOf(lowerTagOpen, cursor);
    if (start === -1) {
      out += input.slice(cursor);
      break;
    }
    const nextChar = lowerSlice[start + lowerTagOpen.length] ?? "";
    if (nextChar && !/[\s>/]/.test(nextChar)) {
      out += input.slice(cursor, start + lowerTagOpen.length);
      cursor = start + lowerTagOpen.length;
      continue;
    }

    out += input.slice(cursor, start);
    const end = lowerSlice.indexOf(lowerTagClose, start);
    if (end === -1) {
      break;
    }
    cursor = end + lowerTagClose.length;
  }

  return out;
}

function removeHtmlComments(input: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < input.length) {
    const start = input.indexOf("<!--", cursor);
    if (start === -1) {
      out += input.slice(cursor);
      break;
    }
    out += input.slice(cursor, start);
    const end = input.indexOf("-->", start + 4);
    if (end === -1) break;
    cursor = end + 3;
  }
  return out;
}

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|prior)\s+(rules|instructions?)/gi,
  /<\|im_start\|>|<\|im_end\|>|<\|system\|>/gi,
  /^\s*(system|assistant|developer)\s*:\s*/gim,
];

export function sanitizeUntrustedSourceText(text: string): string {
  let cleaned = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || code >= 32) {
      cleaned += text[i];
    }
  }

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[filtered-untrusted-directive]");
  }

  return cleaned
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractCleanTextFromHtml(rawHtml: string): {
  title: string | null;
  text: string;
  needsJsFallback: boolean;
} {
  let html = removeHtmlComments(rawHtml);

  const lowerHtml = html.toLowerCase();
  let title: string | null = null;
  const tStart = lowerHtml.indexOf("<title");
  if (tStart !== -1) {
    const tGt = lowerHtml.indexOf(">", tStart);
    const tEnd = lowerHtml.indexOf("</title>", tGt);
    if (tGt !== -1 && tEnd !== -1) {
      title =
        html
          .slice(tGt + 1, tEnd)
          .replace(/\s+/g, " ")
          .trim() || null;
    }
  }

  for (const tag of ["script", "style", "noscript", "svg", "nav", "footer", "aside", "iframe"]) {
    html = removeBlockTag(html, tag);
  }

  const withBreaks = html
    .replace(/<\/(p|div|section|article|h1|h2|h3|h4|h5|h6|li|tr|blockquote)>/gi, "\n\n")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

  const text = sanitizeUntrustedSourceText(withBreaks);

  const lower = rawHtml.toLowerCase();
  const hasSpaShell =
    lower.includes('id="root"') ||
    lower.includes('id="__next"') ||
    lower.includes("enable javascript");
  const needsJsFallback = text.length < 250 && hasSpaShell;

  return { title, text, needsJsFallback };
}
