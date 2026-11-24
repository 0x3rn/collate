"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ROUTE_PROGRESS_START_EVENT, shouldTriggerRouteProgress } from "@/lib/ui/route-progress";

const PROGRESS_SAFETY_TIMEOUT_MS = 8000;
const COMPLETE_FADE_MS = 200;

type ProgressPhase = "idle" | "loading" | "completing";

function RouteProgressBarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString() ?? "";
  const [phase, setPhase] = useState<ProgressPhase>("idle");
  const lastLocationRef = useRef(`${pathname}?${searchKey}`);

  // Finish the bar smoothly whenever the committed route or query string updates
  useEffect(() => {
    const nextLocation = `${pathname}?${searchKey}`;
    if (nextLocation === lastLocationRef.current) return;
    lastLocationRef.current = nextLocation;

    setPhase((prev) => (prev === "loading" ? "completing" : prev));
  }, [pathname, searchKey]);

  // Clear after smooth completion fade
  useEffect(() => {
    if (phase !== "completing") return;
    const timeout = window.setTimeout(() => setPhase("idle"), COMPLETE_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [phase]);

  // Safety timeout so an interrupted or aborted transition never leaves the bar stuck
  useEffect(() => {
    if (phase !== "loading") return;
    const timeout = window.setTimeout(() => setPhase("idle"), PROGRESS_SAFETY_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [phase]);

  useEffect(() => {
    // Use capture phase so we run BEFORE Next.js / Vinext <Link>'s React onClick
    // calls event.preventDefault() to start client-side RSC navigation.
    function handleDocumentClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const targetEl = event.target instanceof Element ? event.target : null;
      const anchor = targetEl?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;

      const rawHref = anchor.getAttribute("href") ?? "";
      if (
        shouldTriggerRouteProgress({
          href: rawHref,
          target: anchor.getAttribute("target"),
          hasDownload: anchor.hasAttribute("download"),
          ariaDisabled: anchor.getAttribute("aria-disabled"),
          currentHref: window.location.href,
        })
      ) {
        setPhase("loading");
      }
    }

    function handleManualStart() {
      setPhase("loading");
    }

    function handlePopState() {
      const nextPath = window.location.pathname;
      const nextSearch = window.location.search.replace(/^\?/, "");
      if (nextPath !== pathname || nextSearch !== searchKey) {
        setPhase("loading");
      }
    }

    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener(ROUTE_PROGRESS_START_EVENT, handleManualStart);
    window.addEventListener("popstate", handlePopState);
    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener(ROUTE_PROGRESS_START_EVENT, handleManualStart);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [pathname, searchKey]);

  if (phase === "idle") return null;

  return (
    <div
      aria-hidden="true"
      data-route-progress={phase === "loading" ? "active" : "completing"}
      className={`fixed top-0 left-0 right-0 z-[100] h-[2px] bg-[var(--accent-100)] overflow-hidden pointer-events-none transition-opacity duration-200 ${
        phase === "completing" ? "opacity-0" : "opacity-100"
      }`}
    >
      <div
        className={
          phase === "completing"
            ? "h-full w-full bg-[var(--accent-600)] transition-all duration-150"
            : "h-full w-1/2 bg-[var(--accent-600)] route-progress-sweep"
        }
      />
    </div>
  );
}

/**
 * Global Oxford Slate Blue 2px top progress hairline rendered once in RootLayout.
 * Automatically activates for every internal link transition site-wide without
 * flashing full-page gray skeletons.
 */
export function RouteProgressBar() {
  return (
    <Suspense fallback={null}>
      <RouteProgressBarInner />
    </Suspense>
  );
}
