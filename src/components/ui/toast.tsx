"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ToastTone = "success" | "info" | "error";

export interface ToastActionLink {
  label: string;
  href: string;
}

export interface ToastMessage {
  id: string;
  tone: ToastTone;
  title?: string;
  message: string;
  action?: ToastActionLink;
  durationMs?: number;
}

export interface ToastInput {
  tone: ToastTone;
  title?: string;
  message: string;
  action?: ToastActionLink;
  durationMs?: number;
}

export interface ToastContextValue {
  notify: (input: ToastInput) => void;
  success: (message: string, title?: string, options?: Partial<ToastInput>) => void;
  info: (message: string, title?: string, options?: Partial<ToastInput>) => void;
  error: (message: string, title?: string, options?: Partial<ToastInput>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION_BY_TONE: Record<ToastTone, number> = {
  success: 6000,
  info: 6000,
  error: 8000,
};

const MAX_VISIBLE_TOASTS = 3;

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

function ToastCard({
  toast,
  onDismiss,
  defaultDurationMs,
}: {
  toast: ToastMessage;
  onDismiss: () => void;
  defaultDurationMs?: number;
}) {
  const [paused, setPaused] = useState(false);
  const effectiveDuration =
    toast.durationMs ?? defaultDurationMs ?? DEFAULT_DURATION_BY_TONE[toast.tone];

  useEffect(() => {
    if (paused || effectiveDuration <= 0) return;
    const timer = window.setTimeout(() => {
      onDismiss();
    }, effectiveDuration);
    return () => window.clearTimeout(timer);
  }, [toast.id, paused, effectiveDuration, onDismiss]);

  const style = TONE_STYLES[toast.tone];

  return (
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

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {toast.title ? (
          <p className="text-sm font-semibold text-[var(--neutral-900)] leading-snug m-0">
            {toast.title}
          </p>
        ) : null}
        <p className="text-sm text-[var(--neutral-700)] leading-relaxed m-0">{toast.message}</p>
        {toast.action ? (
          <div className="pt-0.5">
            <Link
              href={toast.action.href}
              onClick={onDismiss}
              className="text-sm font-medium text-[var(--accent-600)] hover:underline underline-offset-4"
            >
              {toast.action.label}
            </Link>
          </div>
        ) : null}
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
  );
}

const NOOP_TOAST_CONTEXT: ToastContextValue = {
  notify: () => {},
  success: () => {},
  info: () => {},
  error: () => {},
  dismiss: () => {},
  clear: () => {},
};

const ToastContext = createContext<ToastContextValue>(NOOP_TOAST_CONTEXT);

/**
 * App-wide editorial bottom-right toast notification provider.
 * Mount once in `app/layout.tsx` so all error, confirmation, and status toasts
 * share a single clean stack above modals (`z-[60]`) on Collate's warm cream surface.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => {
    setToasts([]);
  }, []);

  const notify = useCallback((input: ToastInput) => {
    const trimmedMessage = input.message.trim();
    if (!trimmedMessage) return;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const next: ToastMessage = {
      id,
      tone: input.tone,
      ...(input.title ? { title: input.title } : {}),
      message: trimmedMessage,
      ...(input.action ? { action: input.action } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    };

    setToasts((prev) => {
      // Replace any existing identical tone+message so rapid retries stay tidy.
      const deduped = prev.filter(
        (item) => !(item.tone === next.tone && item.message === next.message)
      );
      return [...deduped, next].slice(-MAX_VISIBLE_TOASTS);
    });
  }, []);

  const success = useCallback(
    (message: string, title?: string, options?: Partial<ToastInput>) => {
      notify({ ...options, tone: "success", title, message });
    },
    [notify]
  );

  const info = useCallback(
    (message: string, title?: string, options?: Partial<ToastInput>) => {
      notify({ ...options, tone: "info", title, message });
    },
    [notify]
  );

  const error = useCallback(
    (message: string, title = "Something went wrong", options?: Partial<ToastInput>) => {
      notify({ ...options, tone: "error", title, message });
    },
    [notify]
  );

  const value = useMemo<ToastContextValue>(
    () => ({ notify, success, info, error, dismiss, clear }),
    [notify, success, info, error, dismiss, clear]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted && toasts.length > 0 && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed bottom-5 right-4 left-4 sm:left-auto sm:right-5 z-[60] sm:w-[390px] flex flex-col gap-2.5 pointer-events-none">
              {toasts.map((item) => (
                <ToastCard key={item.id} toast={item} onDismiss={() => dismiss(item.id)} />
              ))}
            </div>,
            document.body
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

/**
 * Standalone single-toast primitive kept for isolated components/tests.
 */
export function Toast({
  toast,
  onDismiss,
  durationMs,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
  durationMs?: number;
}) {
  if (!toast || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed bottom-5 right-4 left-4 sm:left-auto sm:right-5 z-[60] sm:w-[390px] pointer-events-none">
      <ToastCard toast={toast} onDismiss={onDismiss} defaultDurationMs={durationMs} />
    </div>,
    document.body
  );
}
