"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type ToastTone = "success" | "info" | "error";

export interface ToastMessage {
  id: string;
  tone: ToastTone;
  title?: string;
  message: string;
}

const TONE_STYLES: Record<
  ToastTone,
  { iconBg: string; iconColor: string; role: "status" | "alert" }
> = {
  success: {
    iconBg: "bg-[var(--success-bg)] border-[var(--success-border)]",
    iconColor: "text-[var(--success-text)]",
    role: "status",
  },
  info: {
    iconBg: "bg-[var(--info-bg)] border-[var(--info-border)]",
    iconColor: "text-[var(--info-text)]",
    role: "status",
  },
  error: {
    iconBg: "bg-[var(--error-bg)] border-[var(--error-border)]",
    iconColor: "text-[var(--error-text)]",
    role: "alert",
  },
};

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === "success") {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        aria-hidden="true"
        className="w-4 h-4"
      >
        <path d="M5 10.5 8.5 14 15 6.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === "error") {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        aria-hidden="true"
        className="w-4 h-4"
      >
        <circle cx="10" cy="10" r="7.25" />
        <path d="M10 6.5v4.25m0 2.75h.01" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      aria-hidden="true"
      className="w-4 h-4"
    >
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 9v4.5m0-6.75h.01" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Restrained editorial bottom-right toast notification.
 * Auto-dismisses after `durationMs` (pausing while hovered or keyboard-focused)
 * and portals to `document.body` so page animations never trap `position: fixed`.
 */
export function Toast({
  toast,
  onDismiss,
  durationMs = 6000,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
  durationMs?: number;
}) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!toast || paused || durationMs <= 0) return;
    const timer = window.setTimeout(() => {
      onDismiss();
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [toast, paused, durationMs, onDismiss]);

  if (!toast || typeof document === "undefined") {
    return null;
  }

  const style = TONE_STYLES[toast.tone];

  return createPortal(
    <div className="fixed bottom-5 right-4 left-4 sm:left-auto sm:right-5 z-50 sm:w-[390px] pointer-events-none">
      <div
        role={style.role}
        aria-live={style.role === "alert" ? "assertive" : "polite"}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        className="toast-enter pointer-events-auto bg-[var(--neutral-50)] border border-[var(--neutral-200)] rounded-[var(--radius-md)] shadow-[0_12px_32px_rgba(24,24,27,0.1)] flex items-start gap-3 p-4"
      >
        <span
          className={`mt-0.5 w-7 h-7 rounded-[var(--radius-sm)] border grid place-items-center shrink-0 ${style.iconBg} ${style.iconColor}`}
        >
          <ToastIcon tone={toast.tone} />
        </span>

        <div className="flex-1 min-w-0 space-y-0.5">
          {toast.title ? (
            <p className="text-sm font-semibold text-[var(--neutral-900)] leading-snug m-0">
              {toast.title}
            </p>
          ) : null}
          <p className="text-sm text-[var(--neutral-700)] leading-relaxed m-0">{toast.message}</p>
        </div>

        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onDismiss}
          className="w-7 h-7 -mt-1 -mr-1 rounded-[var(--radius-sm)] grid place-items-center text-[var(--neutral-400)] hover:text-[var(--neutral-800)] hover:bg-[var(--neutral-100)] transition-colors cursor-pointer shrink-0"
        >
          ×
        </button>
      </div>
    </div>,
    document.body
  );
}
