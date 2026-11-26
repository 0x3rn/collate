"use client";

import { useEffect, useRef } from "react";

/**
 * Six-digit code entry. It is ONE real input (shown as six boxes), marked
 * autocomplete="one-time-code" with a numeric keyboard, so iPhone and Android offer the code
 * from Mail or Messages above the keyboard, and a pasted code fills every box at once.
 */
export function CodeInput({
  id,
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = true,
  label = "6-digit code",
  invalid = false,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
  invalid?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCompleted = useRef<string>("");

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (value.length === 6 && value !== lastCompleted.current) {
      lastCompleted.current = value;
      onComplete?.(value);
    }
    if (value.length < 6) lastCompleted.current = "";
  }, [value, onComplete]);

  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
  const activeIndex = Math.min(value.length, 5);

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-[var(--neutral-800)]">
        {label}
      </label>
      {/* Full width, so the first and last boxes line up with the button edges below. */}
      <div className="relative w-full" onClick={() => inputRef.current?.focus()}>
        <div aria-hidden="true" className="grid grid-cols-6 gap-2 sm:gap-3">
          {digits.map((digit, i) => (
            <div
              key={i}
              className={`h-14 rounded-[var(--radius-sm)] border bg-white grid place-items-center text-2xl font-semibold tabular-nums text-[var(--neutral-900)] transition-colors ${
                invalid
                  ? "border-[var(--error-border)]"
                  : i === activeIndex && !disabled
                    ? "border-[var(--accent-600)] ring-2 ring-[var(--accent-100)]"
                    : "border-[var(--neutral-300)]"
              }`}
            >
              {digit}
            </div>
          ))}
        </div>
        <input
          ref={inputRef}
          id={id}
          name="one-time-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-text text-[16px]"
        />
      </div>
    </div>
  );
}
