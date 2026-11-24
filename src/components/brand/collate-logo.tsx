/**
 * Standalone Collate brand emblem (logo-only SVG mark in Oxford Slate Blue `#1E3A5F`).
 * Always pair alongside native live typography — never use a logo+text image inside the UI.
 */
export function CollateLogo({
  className = "w-6 h-6",
  ariaHidden = true,
}: {
  className?: string;
  ariaHidden?: boolean;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden={ariaHidden || undefined}
      role={ariaHidden ? undefined : "img"}
      aria-label={ariaHidden ? undefined : "Collate"}
      className={className}
    >
      <path
        d="M 26.86 7.6 A 12.8 12.8 0 1 0 26.86 24.4 L 23.92 21.84 A 8.9 8.9 0 1 1 23.92 10.16 Z"
        fill="currentColor"
      />
      <path
        d="M 24.21 11.47 A 6.9 6.9 0 1 0 24.21 20.53 L 21.64 18.3 A 3.5 3.5 0 1 1 21.64 13.7 Z"
        fill="currentColor"
      />
    </svg>
  );
}
