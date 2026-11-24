export const ROUTE_PROGRESS_START_EVENT = "collate:route-progress-start";

/**
 * Programmatically triggers the global top route progress bar (e.g. before router.push).
 */
export function startRouteProgress(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ROUTE_PROGRESS_START_EVENT));
}

export interface RouteProgressLinkInput {
  href: string;
  target?: string | null;
  hasDownload?: boolean;
  ariaDisabled?: string | null;
  currentHref: string;
}

/**
 * Returns true when clicking an anchor will initiate an in-app Next.js route transition
 * that should display the global top progress bar. Skips external URLs, same-route hash
 * jumps, file download links, disabled links, non-_self targets, and /api/ endpoints.
 */
export function shouldTriggerRouteProgress(input: RouteProgressLinkInput): boolean {
  const rawHref = input.href.trim();
  if (!rawHref) return false;
  if (input.hasDownload) return false;
  if (input.ariaDisabled?.trim().toLowerCase() === "true") return false;

  const target = input.target?.trim().toLowerCase();
  if (target && target !== "_self") return false;

  if (/^(?:mailto:|tel:|javascript:|blob:|data:)/i.test(rawHref)) {
    return false;
  }

  let currentUrl: URL;
  let nextUrl: URL;
  try {
    currentUrl = new URL(input.currentHref);
    nextUrl = new URL(rawHref, currentUrl);
  } catch {
    return false;
  }

  if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
    return false;
  }
  if (nextUrl.origin !== currentUrl.origin) {
    return false;
  }
  if (nextUrl.pathname.startsWith("/api/")) {
    return false;
  }
  if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search) {
    return false;
  }

  return true;
}
