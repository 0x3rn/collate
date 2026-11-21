import type { InputHTMLAttributes } from "react";

export interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  helpText?: string;
  error?: string;
}

export function FormField({
  id,
  label,
  helpText,
  error,
  className = "",
  ...inputProps
}: FormFieldProps) {
  const helpId = helpText ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-[var(--neutral-800)]">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={`block w-full min-h-[44px] px-3.5 py-2.5 text-base bg-white text-[var(--neutral-900)] border rounded-[var(--radius-sm)] placeholder:text-[var(--neutral-400)] transition-colors duration-150 ${
          error
            ? "border-[var(--error-text)]"
            : "border-[var(--neutral-300)] hover:border-[var(--neutral-400)] focus:border-[var(--accent-600)]"
        } ${className}`}
        {...inputProps}
      />
      {helpText && !error ? (
        <p id={helpId} className="text-sm text-[var(--neutral-600)]">
          {helpText}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-[var(--error-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
