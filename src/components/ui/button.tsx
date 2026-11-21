import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent-600)] text-white border border-transparent hover:bg-[var(--accent-700)] disabled:opacity-60",
  secondary:
    "bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] hover:bg-[var(--neutral-100)] disabled:opacity-60",
  ghost:
    "bg-transparent text-[var(--neutral-700)] border border-transparent hover:bg-[var(--neutral-100)] hover:text-[var(--neutral-900)] disabled:opacity-60",
};

const BASE_CLASSES =
  "inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 text-[0.9375rem] font-medium rounded-[var(--radius-sm)] transition-colors duration-150 ease-out cursor-pointer disabled:cursor-not-allowed";

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
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading ? (loadingLabel ?? "Working...") : children}
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
