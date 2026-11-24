import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent-600)] text-white border border-transparent hover:bg-[var(--accent-700)] active:translate-y-[0.5px] disabled:opacity-60",
  secondary:
    "bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] hover:bg-[var(--neutral-100)] hover:border-[var(--neutral-400)] active:translate-y-[0.5px] disabled:opacity-60",
  ghost:
    "bg-transparent text-[var(--neutral-700)] border border-transparent hover:bg-[var(--neutral-100)] hover:text-[var(--neutral-900)] disabled:opacity-60",
};

const BASE_CLASSES =
  "inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 text-sm font-medium rounded-[var(--radius-sm)] transition-all duration-150 ease-out cursor-pointer disabled:cursor-not-allowed";

export function SpinnerIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`animate-spin shrink-0 ${className}`}
    >
      <circle
        cx="10"
        cy="10"
        r="7.5"
        stroke="currentColor"
        strokeOpacity="0.24"
        strokeWidth="2.2"
      />
      <path
        d="M17.5 10a7.5 7.5 0 0 0-7.5-7.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}

export function Button({
  variant = "primary",
  fullWidth = false,
  loading = false,
  loadingLabel,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading ? (
        <>
          <SpinnerIcon className="w-4 h-4" />
          <span>{loadingLabel ?? "Working..."}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export interface LinkButtonProps {
  href: string;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

export function LinkButton({
  href,
  variant = "primary",
  fullWidth = false,
  className = "",
  children,
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
    >
      {children}
    </Link>
  );
}
