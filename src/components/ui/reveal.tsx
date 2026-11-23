"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Reveal({
  children,
  delayMs = 0,
  className = "",
}: {
  children: ReactNode;
  delayMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [effectiveDelayMs, setEffectiveDelayMs] = useState(delayMs);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      setEffectiveDelayMs(0);
      setVisible(true);
      return;
    }

    // On narrow mobile screens cards stack vertically one-by-one, so artificial
    // stagger delays make cards appear late instead of gliding in right on scroll.
    const isNarrowViewport = window.innerWidth < 768;
    setEffectiveDelayMs(isNarrowViewport ? 0 : delayMs);

    // If the element is already within the viewport on mount, reveal cleanly on next frame.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.96) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.01, rootMargin: "0px 0px -24px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delayMs]);

  return (
    <div
      ref={ref}
      style={effectiveDelayMs > 0 ? { transitionDelay: `${effectiveDelayMs}ms` } : undefined}
      className={`reveal-base ${visible ? "reveal-visible" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
