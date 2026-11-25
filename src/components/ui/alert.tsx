import type { ReactNode } from "react";

export type AlertTone = "error" | "success" | "warning" | "info";

const TONE_STYLES: Record<AlertTone, string> = {
  error: "bg-[var(--error-bg)] text-[var(--error-text)] border-[var(--error-border)]",
  success: "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]",
  warning: "bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]",
  info: "bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]",
};

const TONE_LABELS: Record<AlertTone, string> = {
  error: "Error",
  success: "Confirmed",
  warning: "Notice",
  info: "Note",
};

export function FormAlert({
  tone,
  children,
  className = "",
  label,
}: {
  tone: AlertTone;
  children: ReactNode;
  className?: string;
  /** Overrides the tone's prefix ("Confirmed:", "Notice:"…); null hides it. */
  label?: string | null;
}) {
  const prefix = label === undefined ? TONE_LABELS[tone] : label;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`border rounded-[var(--radius-sm)] px-4 py-3 text-sm leading-relaxed ${TONE_STYLES[tone]} ${className}`}
    >
      {prefix ? <span className="font-semibold mr-1.5">{prefix}: </span> : null}
      {children}
    </div>
  );
}
