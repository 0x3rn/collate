export const ANALYTICS_CONSENT_CHOICES = ["accepted", "declined"] as const;
export type AnalyticsConsentChoice = (typeof ANALYTICS_CONSENT_CHOICES)[number];

export type EffectiveConsentStatus = AnalyticsConsentChoice | "prompt";

/** Signed-in users who decline analytics cookies are asked again after 7 days. */
export const SIGNED_IN_CONSENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** First-party cookie storing an anonymous visitor's explicit acceptance across visits. */
export const VISITOR_CONSENT_COOKIE_NAME = "collate_analytics_consent";

/** Session-only key for an anonymous visitor who declined (cleared when the visit/tab ends). */
export const VISITOR_DECLINE_SESSION_KEY = "collate_analytics_declined_visit";

/** Local-storage fallback alongside the visitor acceptance cookie so acceptance survives reloads. */
export const VISITOR_ACCEPT_STORAGE_KEY = "collate_analytics_accepted";

/** Custom browser event to reopen the cookie preference popup from footer/policy links. */
export const OPEN_COOKIE_PREFERENCES_EVENT = "collate:open-cookie-preferences";

const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{6,20}$/;

export function isValidGaMeasurementId(raw: string | null | undefined): string | null {
  const cleaned = raw?.trim().toUpperCase() ?? "";
  if (!cleaned) return null;
  return GA4_MEASUREMENT_ID_PATTERN.test(cleaned) ? cleaned : null;
}

export function resolveGaMeasurementId(
  runtimeEnv?: Record<string, unknown>,
  processEnv?: Record<string, string | undefined>
): string | null {
  const fromWorker =
    typeof runtimeEnv?.NEXT_PUBLIC_GA_MEASUREMENT_ID === "string"
      ? runtimeEnv.NEXT_PUBLIC_GA_MEASUREMENT_ID
      : undefined;
  return (
    isValidGaMeasurementId(fromWorker) ??
    isValidGaMeasurementId(processEnv?.NEXT_PUBLIC_GA_MEASUREMENT_ID)
  );
}

export interface SignedInConsentEvaluation {
  status: EffectiveConsentStatus;
  expired: boolean;
  expiresAt: Date | null;
}

/**
 * Evaluates a signed-in account's recorded cookie consent choice:
 * - Accepted is saved permanently on the account (never expires unless the user changes it).
 * - Declined expires and is discarded after 7 days so the user is asked again.
 */
export function resolveSignedInConsent(
  record: {
    choice: AnalyticsConsentChoice | null | undefined;
    recordedAt: Date | null | undefined;
  },
  now: Date = new Date()
): SignedInConsentEvaluation {
  if (!record.choice || !record.recordedAt) {
    return { status: "prompt", expired: false, expiresAt: null };
  }

  if (record.choice === "accepted") {
    return { status: "accepted", expired: false, expiresAt: null };
  }

  const ageMs = now.getTime() - record.recordedAt.getTime();
  if (ageMs >= SIGNED_IN_CONSENT_TTL_MS) {
    return { status: "prompt", expired: true, expiresAt: null };
  }

  return {
    status: "declined",
    expired: false,
    expiresAt: new Date(record.recordedAt.getTime() + SIGNED_IN_CONSENT_TTL_MS),
  };
}

/**
 * Evaluates an anonymous visitor's consent state:
 * - Accepted is remembered persistently unless the site loses track of the visitor (cleared cookies/storage).
 * - Declined is held only for the current visit so the popup returns on every subsequent visit.
 */
export function resolveVisitorConsent(input: {
  persistedAccepted: boolean;
  declinedThisVisit: boolean;
}): EffectiveConsentStatus {
  if (input.persistedAccepted) return "accepted";
  if (input.declinedThisVisit) return "declined";
  return "prompt";
}

export function shouldLoadAnalytics(
  status: EffectiveConsentStatus,
  measurementId: string | null | undefined
): boolean {
  return status === "accepted" && isValidGaMeasurementId(measurementId) !== null;
}

/**
 * Builds the global `gtag` queue stub expected by Google's gtag.js loader.
 *
 * CRITICAL: gtag.js checks entries in `dataLayer` using native `[object Arguments]`;
 * pushing a rest-parameter `Array` (`(...args) => dataLayer.push(args)`) causes gtag.js
 * to silently ignore every queued `js`, `config`, and `event` call and send zero hits.
 */
export function createGtagDispatcher(
  getDataLayer: () => unknown[] | undefined
): (...args: unknown[]) => void {
  return function gtag() {
    // eslint-disable-next-line prefer-rest-params
    getDataLayer()?.push(arguments);
  };
}
