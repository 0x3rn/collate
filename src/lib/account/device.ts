/**
 * Turns a browser user-agent string into a short device label ("Chrome on Windows",
 * "Safari on iPhone"). Deliberately small: no dependency, and only what the Active sessions list
 * needs. Unknown agents fall back to "Unknown browser".
 */

export interface DeviceInfo {
  browser: string;
  os: string;
  kind: "desktop" | "mobile" | "tablet";
  label: string;
}

function detectBrowser(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/CriOS\/|Chrome\//.test(ua) && !/Chromium\//.test(ua)) return "Chrome";
  if (/Chromium\//.test(ua)) return "Chromium";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  return "Unknown browser";
}

function detectOs(ua: string): { os: string; kind: DeviceInfo["kind"] } {
  if (/iPad/.test(ua)) return { os: "iPad", kind: "tablet" };
  if (/iPhone|iPod/.test(ua)) return { os: "iPhone", kind: "mobile" };
  if (/Android/.test(ua)) return { os: "Android", kind: /Mobile/.test(ua) ? "mobile" : "tablet" };
  if (/CrOS/.test(ua)) return { os: "ChromeOS", kind: "desktop" };
  if (/Windows NT/.test(ua)) return { os: "Windows", kind: "desktop" };
  if (/Mac OS X|Macintosh/.test(ua)) return { os: "macOS", kind: "desktop" };
  if (/Linux/.test(ua)) return { os: "Linux", kind: "desktop" };
  return { os: "Unknown device", kind: "desktop" };
}

export function describeDevice(userAgent: string | null | undefined): DeviceInfo {
  const ua = userAgent ?? "";
  const browser = detectBrowser(ua);
  const { os, kind } = detectOs(ua);
  const label =
    browser === "Unknown browser" && os === "Unknown device"
      ? "Unknown device"
      : `${browser} on ${os}`;
  return { browser, os, kind, label };
}

const COUNTRY_NAMES: Record<string, string> = {
  NG: "Nigeria",
  GH: "Ghana",
  KE: "Kenya",
  ZA: "South Africa",
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  DE: "Germany",
  FR: "France",
  IN: "India",
};

/** "Lagos, Nigeria"; country names come from Intl when available. */
export function describeLocation(city: string | null, country: string | null): string | null {
  let countryName: string | null = null;
  if (country) {
    try {
      countryName =
        new Intl.DisplayNames(["en"], { type: "region" }).of(country.toUpperCase()) ?? null;
    } catch {
      countryName = COUNTRY_NAMES[country.toUpperCase()] ?? country.toUpperCase();
    }
  }
  const parts = [city, countryName].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join(", ") : null;
}
