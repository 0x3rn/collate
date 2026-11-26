"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type AnalyticsConsentChoice,
  type EffectiveConsentStatus,
  isValidGaMeasurementId,
  OPEN_COOKIE_PREFERENCES_EVENT,
  resolveVisitorConsent,
  shouldLoadAnalytics,
  VISITOR_ACCEPT_STORAGE_KEY,
  VISITOR_CONSENT_COOKIE_NAME,
  VISITOR_DECLINE_SESSION_KEY,
} from "@/lib/privacy/cookie-consent";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

const GA_SCRIPT_ELEMENT_ID = "collate-ga4-script";
const VISITOR_ACCEPT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function readBrowserCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

function readVisitorPersistedAccepted(): boolean {
  if (readBrowserCookie(VISITOR_CONSENT_COOKIE_NAME) === "accepted") {
    return true;
  }
  try {
    return window.localStorage.getItem(VISITOR_ACCEPT_STORAGE_KEY) === "accepted";
  } catch {
    return false;
  }
}

function readVisitorDeclinedThisVisit(): boolean {
  try {
    return window.sessionStorage.getItem(VISITOR_DECLINE_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function writeVisitorAccepted(): void {
  const secureFlag =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${VISITOR_CONSENT_COOKIE_NAME}=accepted; Path=/; Max-Age=${VISITOR_ACCEPT_MAX_AGE_SECONDS}; SameSite=Lax${secureFlag}`;
  try {
    window.localStorage.setItem(VISITOR_ACCEPT_STORAGE_KEY, "accepted");
    window.sessionStorage.removeItem(VISITOR_DECLINE_SESSION_KEY);
  } catch {
    // Ignore storage quota or restricted-mode errors
  }
}

function writeVisitorDeclinedThisVisit(): void {
  document.cookie = `${VISITOR_CONSENT_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
  try {
    window.localStorage.removeItem(VISITOR_ACCEPT_STORAGE_KEY);
    window.sessionStorage.setItem(VISITOR_DECLINE_SESSION_KEY, "1");
  } catch {
    // Ignore restricted-mode errors
  }
}

function expireGoogleAnalyticsCookies(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const host = window.location.hostname;
  const domains = [host, `.${host}`];
  const parts = host.split(".");
  if (parts.length >= 2) {
    domains.push(`.${parts.slice(-2).join(".")}`);
  }

  for (const cookie of document.cookie.split(";")) {
    const eq = cookie.indexOf("=");
    const name = (eq >= 0 ? cookie.slice(0, eq) : cookie).trim();
    if (!name || (name !== "_ga" && !name.startsWith("_ga_") && name !== "_gid")) continue;
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
    for (const domain of domains) {
      document.cookie = `${name}=; Path=/; Domain=${domain}; Max-Age=0; SameSite=Lax`;
    }
  }
}

function ensureGtagInitialized(measurementId: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  window[`ga-disable-${measurementId}`] = false;
  window.dataLayer = window.dataLayer ?? [];
  if (typeof window.gtag !== "function") {
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer?.push(args);
    };
  }

  if (!document.getElementById(GA_SCRIPT_ELEMENT_ID)) {
    window.gtag("js", new Date());
    window.gtag("config", measurementId, {
      anonymize_ip: true,
      send_page_view: false,
    });

    const script = document.createElement("script");
    script.id = GA_SCRIPT_ELEMENT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
  }
}

function disableGtag(measurementId: string): void {
  if (typeof window === "undefined") return;
  window[`ga-disable-${measurementId}`] = true;
  expireGoogleAnalyticsCookies();
}

export function CookiePreferencesTrigger({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(OPEN_COOKIE_PREFERENCES_EVENT));
        }
      }}
      className={`text-left cursor-pointer hover:text-[var(--neutral-900)] hover:underline underline-offset-4 ${className}`}
    >
      Cookie preferences
    </button>
  );
}

export function CookieConsentAnalytics({ measurementId }: { measurementId?: string | null }) {
  const pathname = usePathname();
  const validMeasurementId = isValidGaMeasurementId(measurementId);
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState<EffectiveConsentStatus>("declined");
  const [forceOpen, setForceOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastTrackedPathRef = useRef<string | null>(null);

  const syncConsentState = useCallback(async () => {
    try {
      const res = await fetch("/api/account/cookie-consent", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as {
          ok?: boolean;
          signedIn?: boolean;
          status?: EffectiveConsentStatus;
        };
        if (data.ok && data.signedIn) {
          setSignedIn(true);
          setStatus(data.status ?? "prompt");
          setReady(true);
          return;
        }
      }
    } catch {
      // Fall back to anonymous visitor check when network fails
    }

    setSignedIn(false);
    setStatus(
      resolveVisitorConsent({
        persistedAccepted: readVisitorPersistedAccepted(),
        declinedThisVisit: readVisitorDeclinedThisVisit(),
      })
    );
    setReady(true);
  }, []);

  useEffect(() => {
    if (!validMeasurementId) return;
    void syncConsentState();
  }, [validMeasurementId, pathname, syncConsentState]);

  useEffect(() => {
    if (!validMeasurementId) return;
    function handleOpenPreferences() {
      setForceOpen(true);
    }
    window.addEventListener(OPEN_COOKIE_PREFERENCES_EVENT, handleOpenPreferences);
    return () => {
      window.removeEventListener(OPEN_COOKIE_PREFERENCES_EVENT, handleOpenPreferences);
    };
  }, [validMeasurementId]);

  useEffect(() => {
    if (!validMeasurementId || !ready) return;

    if (shouldLoadAnalytics(status, validMeasurementId)) {
      ensureGtagInitialized(validMeasurementId);
      const cleanPath = pathname || "/";
      if (lastTrackedPathRef.current !== cleanPath && typeof window.gtag === "function") {
        lastTrackedPathRef.current = cleanPath;
        window.gtag("event", "page_view", {
          page_path: cleanPath,
          page_title: document.title,
        });
      }
    } else {
      lastTrackedPathRef.current = null;
      disableGtag(validMeasurementId);
    }
  }, [validMeasurementId, ready, status, pathname]);

  async function handleChoice(choice: AnalyticsConsentChoice) {
    setSaving(true);
    try {
      if (signedIn) {
        const res = await fetch("/api/account/cookie-consent", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ choice }),
        });
        if (!res.ok) {
          // Even if persistence fails transiently, honor the user's choice for this view
          setStatus(choice);
          setForceOpen(false);
          return;
        }
      } else if (choice === "accepted") {
        writeVisitorAccepted();
      } else {
        writeVisitorDeclinedThisVisit();
      }

      setStatus(choice);
      setForceOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!validMeasurementId || !ready) return null;

  const isVisible = forceOpen || status === "prompt";
  if (!isVisible) return null;

  return (
    <aside
      role="dialog"
      aria-label="Cookie preferences"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[calc(100%-2rem)] sm:max-w-[540px] z-40 rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-white p-4 sm:p-5 shadow-[0_14px_34px_-12px_rgba(24,24,27,0.18)]"
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-[var(--neutral-900)]">Cookie preferences</p>
          <p className="text-xs sm:text-[0.8125rem] text-[var(--neutral-600)] leading-relaxed">
            Collate uses essential cookies for sign-in and security. With your permission, we also
            use optional cookies to understand site traffic and improve the product. By accepting,
            you agree to our{" "}
            <Link
              href="/cookies"
              className="font-medium text-[var(--accent-700)] underline underline-offset-2 hover:text-[var(--accent-600)]"
            >
              Cookie policy
            </Link>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            className="!min-h-[36px] !px-3.5 text-xs"
            onClick={() => void handleChoice("declined")}
          >
            Decline
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={saving}
            loadingLabel="Saving..."
            className="!min-h-[36px] !px-3.5 text-xs"
            onClick={() => void handleChoice("accepted")}
          >
            Accept analytics
          </Button>
        </div>
      </div>
    </aside>
  );
}
