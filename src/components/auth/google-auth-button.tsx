"use client";

import type { MouseEvent } from "react";

/**
 * "Sign in with Google" / "Sign up with Google". A plain link: the server starts the Google flow
 * and comes back signed in, so no bot check is needed. On the sign-up page it only works once the
 * Terms box is ticked, and it carries that agreement to the server (needed to create an account).
 */
export function GoogleAuthButton({
  label,
  nextPath,
  termsAccepted,
  onTermsMissing,
}: {
  label: string;
  nextPath?: string;
  /** Sign-up page only: whether the Terms box is ticked. Leave out on the sign-in page. */
  termsAccepted?: boolean;
  /** Called instead of starting Google when the Terms box is not ticked. */
  onTermsMissing?: () => void;
}) {
  const params = new URLSearchParams();
  if (nextPath) params.set("next", nextPath);
  if (termsAccepted) params.set("terms", "accepted");
  const query = params.toString();
  const href = `/api/auth/google/start${query ? `?${query}` : ""}`;

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (termsAccepted === false) {
      e.preventDefault();
      onTermsMissing?.();
    }
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      className="w-full min-h-[44px] inline-flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-[var(--radius-sm)] border border-[var(--neutral-300)] bg-white text-sm font-medium text-[var(--neutral-900)] hover:bg-[var(--neutral-50)] hover:border-[var(--neutral-400)] transition-colors"
    >
      <svg viewBox="0 0 48 48" aria-hidden="true" className="w-[18px] h-[18px] shrink-0">
        <path
          fill="#FFC107"
          d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"
        />
        <path
          fill="#FF3D00"
          d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
        />
        <path
          fill="#4CAF50"
          d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
        />
        <path
          fill="#1976D2"
          d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z"
        />
      </svg>
      {label}
    </a>
  );
}
