"use client";

import Link from "next/link";
import { forwardRef, type ReactNode } from "react";

/**
 * The required "I agree" tick box. Sign-up and checkout cannot go ahead without it, and the
 * server refuses the request too, so a recorded agreement always means the box was ticked.
 */
export const TermsCheckbox = forwardRef<
  HTMLInputElement,
  {
    id: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    error?: string | null;
    children: ReactNode;
  }
>(function TermsCheckbox({ id, checked, onChange, error, children }, ref) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-start gap-2.5 cursor-pointer select-none">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`mt-[2px] w-4 h-4 shrink-0 rounded-[3px] accent-[var(--accent-600)] cursor-pointer ${
            error ? "outline outline-2 outline-offset-2 outline-[var(--error-border)]" : ""
          }`}
        />
        <span className="text-xs text-[var(--neutral-700)] leading-relaxed">{children}</span>
      </label>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-[var(--error-text)] pl-[26px]">
          {error}
        </p>
      ) : null}
    </div>
  );
});

const linkClass = "underline underline-offset-2 text-[var(--neutral-900)]";

export function SignUpTermsText() {
  return (
    <>
      I agree to the{" "}
      <Link href="/terms" target="_blank" className={linkClass}>
        Terms of Service
      </Link>
      ,{" "}
      <Link href="/acceptable-use" target="_blank" className={linkClass}>
        Acceptable Use Policy
      </Link>
      , and{" "}
      <Link href="/privacy" target="_blank" className={linkClass}>
        Privacy Policy
      </Link>
      .
    </>
  );
}

export function CheckoutTermsText() {
  return (
    <>
      I agree to the{" "}
      <Link href="/terms" target="_blank" className={linkClass}>
        Terms of Service
      </Link>{" "}
      and{" "}
      <Link href="/terms#refund-policy" target="_blank" className={linkClass}>
        Refund Policy
      </Link>
      . Credits used on chapters can&rsquo;t be refunded.
    </>
  );
}
