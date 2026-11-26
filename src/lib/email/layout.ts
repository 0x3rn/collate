/**
 * Branded wrapper for every outgoing email: logo, a readable centred column, and a short
 * footer. The logo is a PNG (public/email/logo.png) because Gmail and Outlook do not display SVG
 * images in email.
 */

export function escapeEmailHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function baseUrl(appUrl: string | undefined): string {
  let out = (appUrl ?? "").trim() || "https://collateresearch.app";
  while (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

const PUBLIC_SITE_URL = "https://collateresearch.app";

/**
 * Where mail apps fetch images from. Gmail and Outlook load images through their own servers, so
 * a localhost or plain-http address shows a broken image; those fall back to the public site.
 */
export function emailAssetRoot(appUrl: string | undefined): string {
  const root = baseUrl(appUrl);
  try {
    const url = new URL(root);
    const local = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)|\.(localhost|test|local)$/i.test(
      url.hostname
    );
    return url.protocol === "https:" && !local ? root : PUBLIC_SITE_URL;
  } catch {
    return PUBLIC_SITE_URL;
  }
}

export function isWrappedEmail(html: string): boolean {
  return /^\s*<!doctype html/i.test(html);
}

export function wrapEmailHtml(
  innerHtml: string,
  options: { appUrl?: string; preheader?: string; footerHtml?: string } = {}
): string {
  if (isWrappedEmail(innerHtml)) return innerHtml;
  const root = baseUrl(options.appUrl);
  const preheader = options.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeEmailHtml(options.preheader)}</div>`
    : "";
  const footer =
    options.footerHtml ??
    `Collate · <a href="${root}" style="color:#6b7280">${escapeEmailHtml(root.replace(/^https?:\/\//, ""))}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Collate</title>
</head>
<body style="margin:0;padding:0;background:#f6f5f2;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr>
          <td style="padding:0 4px 20px 4px;">
            <a href="${root}" style="text-decoration:none;">
              <img src="${emailAssetRoot(options.appUrl)}/email/logo.png" width="114" height="32" alt="Collate" style="display:block;border:0;height:32px;width:114px;">
            </a>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid #e5e2dc;border-radius:10px;padding:28px 28px 24px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;">
            ${innerHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 4px 0 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;">
            ${footer}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** A large, spaced verification code block for code emails. */
export function codeBlockHtml(code: string): string {
  return `<p style="margin:20px 0;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:#1e3a5f;">${escapeEmailHtml(code)}</p>`;
}

/** A button-style link that works in every mail client. */
export function buttonHtml(label: string, url: string): string {
  return `<p style="margin:22px 0;"><a href="${escapeEmailHtml(url)}" style="display:inline-block;background:#1e3a5f;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:8px;">${escapeEmailHtml(label)}</a></p>`;
}
