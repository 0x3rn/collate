"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { computeScrollbarMetrics, computeScrollTopFromDrag } from "@/lib/ui/scrollbar";

const AUTO_HIDE_DELAY_MS = 850;
const HOVER_HIDE_DELAY_MS = 350;

/**
 * Replaces persistent classic OS scrollbars with an auto-hiding overlay thumb
 * that appears only while scrolling (or when intentionally hovered/dragged)
 * and fades away automatically when idle.
 */
export function AutoHideScrollbar() {
  const pathname = usePathname();
  const railRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);

  const hideTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const hoveringRef = useRef(false);
  const draggingRef = useRef(false);
  const dragStateRef = useRef({
    pointerId: -1,
    startY: 0,
    startScrollTop: 0,
    maxScrollTop: 0,
    maxThumbTop: 0,
  });
  const latestMetricsRef = useRef({
    scrollable: false,
    thumbHeight: 0,
    thumbTop: 0,
    maxScrollTop: 0,
    maxThumbTop: 0,
  });

  useEffect(() => {
    const nestedTimers = new Map<HTMLElement, number>();

    function clearHideTimer() {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    }

    function scheduleHide(delayMs: number) {
      clearHideTimer();
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        if (hoveringRef.current || draggingRef.current) return;
        const rail = railRef.current;
        if (rail) {
          rail.dataset.visible = "false";
        }
      }, delayMs);
    }

    function syncViewportScrollbar(reveal: boolean) {
      const rail = railRef.current;
      const thumb = thumbRef.current;
      if (!rail || !thumb) return;

      const scroller = document.scrollingElement || document.documentElement;
      const scrollTop = window.scrollY || scroller.scrollTop || 0;
      const clientHeight = window.innerHeight || scroller.clientHeight || 0;
      const scrollHeight = scroller.scrollHeight || 0;
      // Rail spans top: 6px to bottom: 6px -> 12px vertical inset
      const trackHeight = Math.max(0, rail.clientHeight || clientHeight - 12);

      const metrics = computeScrollbarMetrics({
        scrollTop,
        scrollHeight,
        clientHeight,
        trackHeight,
      });
      latestMetricsRef.current = metrics;

      if (!metrics.scrollable) {
        rail.dataset.scrollable = "false";
        rail.dataset.visible = "false";
        clearHideTimer();
        return;
      }

      rail.dataset.scrollable = "true";
      thumb.style.height = `${metrics.thumbHeight.toFixed(1)}px`;
      thumb.style.transform = `translate3d(0, ${metrics.thumbTop.toFixed(1)}px, 0)`;

      if (reveal) {
        rail.dataset.visible = "true";
        if (!hoveringRef.current && !draggingRef.current) {
          scheduleHide(AUTO_HIDE_DELAY_MS);
        }
      }
    }

    function scheduleSync(reveal: boolean) {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        syncViewportScrollbar(reveal);
      });
    }

    function handleWindowScroll() {
      scheduleSync(true);
    }

    function handleResize() {
      scheduleSync(false);
    }

    function handleCapturedScroll(event: Event) {
      const target = event.target;
      if (
        target === document ||
        target === document.documentElement ||
        target === document.body ||
        !(target instanceof HTMLElement)
      ) {
        return;
      }

      target.dataset.scrolling = "true";
      const existing = nestedTimers.get(target);
      if (existing !== undefined) {
        window.clearTimeout(existing);
      }
      const timeoutId = window.setTimeout(() => {
        delete target.dataset.scrolling;
        nestedTimers.delete(target);
      }, AUTO_HIDE_DELAY_MS);
      nestedTimers.set(target, timeoutId);
    }

    // Initial passive measurement (stays hidden until scrolled)
    syncViewportScrollbar(false);

    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });
    document.addEventListener("scroll", handleCapturedScroll, { passive: true, capture: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleSync(false);
      });
      resizeObserver.observe(document.documentElement);
      if (document.body) {
        resizeObserver.observe(document.body);
      }
    }

    return () => {
      window.removeEventListener("scroll", handleWindowScroll);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("scroll", handleCapturedScroll, { capture: true });
      resizeObserver?.disconnect();
      clearHideTimer();
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      for (const [el, timerId] of nestedTimers.entries()) {
        window.clearTimeout(timerId);
        delete el.dataset.scrolling;
      }
      nestedTimers.clear();
    };
  }, [pathname]);

  function handleRailPointerEnter() {
    if (!latestMetricsRef.current.scrollable) return;
    hoveringRef.current = true;
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    const rail = railRef.current;
    if (rail) {
      rail.dataset.visible = "true";
    }
  }

  function handleRailPointerLeave() {
    hoveringRef.current = false;
    if (draggingRef.current) return;
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      if (!hoveringRef.current && !draggingRef.current && railRef.current) {
        railRef.current.dataset.visible = "false";
      }
    }, HOVER_HIDE_DELAY_MS);
  }

  function handleRailPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !latestMetricsRef.current.scrollable) return;
    const rail = railRef.current;
    const thumb = thumbRef.current;
    if (!rail || !thumb) return;

    // Clicking on the track outside the thumb jumps cleanly to that position
    if (event.target === rail) {
      event.preventDefault();
      const rect = rail.getBoundingClientRect();
      const clickOffset = event.clientY - rect.top - latestMetricsRef.current.thumbHeight / 2;
      const ratio =
        latestMetricsRef.current.maxThumbTop > 0
          ? clickOffset / latestMetricsRef.current.maxThumbTop
          : 0;
      const targetScrollTop = Math.max(
        0,
        Math.min(
          latestMetricsRef.current.maxScrollTop,
          ratio * latestMetricsRef.current.maxScrollTop
        )
      );
      window.scrollTo({ top: targetScrollTop, behavior: "instant" as ScrollBehavior });
    }
  }

  function handleThumbPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !latestMetricsRef.current.scrollable) return;
    event.preventDefault();
    event.stopPropagation();

    const thumb = thumbRef.current;
    const rail = railRef.current;
    if (!thumb || !rail) return;

    draggingRef.current = true;
    rail.dataset.dragging = "true";
    rail.dataset.visible = "true";

    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    const scroller = document.scrollingElement || document.documentElement;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: window.scrollY || scroller.scrollTop || 0,
      maxScrollTop: latestMetricsRef.current.maxScrollTop,
      maxThumbTop: latestMetricsRef.current.maxThumbTop,
    };

    try {
      thumb.setPointerCapture(event.pointerId);
    } catch {
      // Ignore if synthetic pointer cannot be captured
    }
  }

  function handleThumbPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || event.pointerId !== dragStateRef.current.pointerId) return;
    event.preventDefault();

    const nextTop = computeScrollTopFromDrag({
      startScrollTop: dragStateRef.current.startScrollTop,
      deltaY: event.clientY - dragStateRef.current.startY,
      maxScrollTop: dragStateRef.current.maxScrollTop,
      maxThumbTop: dragStateRef.current.maxThumbTop,
    });
    window.scrollTo({ top: nextTop, behavior: "instant" as ScrollBehavior });
  }

  function endThumbDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || event.pointerId !== dragStateRef.current.pointerId) return;
    draggingRef.current = false;

    const rail = railRef.current;
    const thumb = thumbRef.current;
    if (rail) {
      delete rail.dataset.dragging;
    }
    if (thumb) {
      try {
        thumb.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore if capture was already released
      }
    }

    if (!hoveringRef.current) {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        if (!hoveringRef.current && !draggingRef.current && railRef.current) {
          railRef.current.dataset.visible = "false";
        }
      }, AUTO_HIDE_DELAY_MS);
    }
  }

  return (
    <div
      ref={railRef}
      aria-hidden="true"
      data-scrollable="false"
      data-visible="false"
      onPointerEnter={handleRailPointerEnter}
      onPointerLeave={handleRailPointerLeave}
      onPointerDown={handleRailPointerDown}
      className="auto-scrollbar-rail print:hidden"
    >
      <div
        ref={thumbRef}
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={endThumbDrag}
        onPointerCancel={endThumbDrag}
        className="auto-scrollbar-thumb"
      />
    </div>
  );
}
