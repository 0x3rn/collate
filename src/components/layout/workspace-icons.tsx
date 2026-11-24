import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function OverviewIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="3" width="6" height="6" rx="1.2" />
      <rect x="11" y="3" width="6" height="4" rx="1.2" />
      <rect x="11" y="9" width="6" height="8" rx="1.2" />
      <rect x="3" y="11" width="6" height="6" rx="1.2" />
    </svg>
  );
}

export function ProjectsIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h3.4l1.6 1.8h6A1.5 1.5 0 0 1 17 7.3v7.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-9Z" />
    </svg>
  );
}

export function ExportsIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <path d="M5.5 2.75h6.25L15.5 6.5v10.25a.75.75 0 0 1-.75.75h-9.25a.75.75 0 0 1-.75-.75V3.5a.75.75 0 0 1 .75-.75Z" />
      <path d="M11.5 2.75V6.5h4" />
      <path d="M10 9.5v4.75m0 0-2-2m2 2 2-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BillingIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <rect x="2.75" y="4.5" width="14.5" height="11" rx="1.75" />
      <path d="M2.75 8.25h14.5" />
      <path d="M5.75 12.25h3.5" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <circle cx="10" cy="7" r="3" />
      <path d="M4.25 16.25a5.75 5.75 0 0 1 11.5 0" strokeLinecap="round" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <path d="M10 2.75 16 5v4.5c0 3.7-2.45 6.45-6 7.75-3.55-1.3-6-4.05-6-7.75V5l6-2.25Z" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
      {...props}
    >
      <path d="M10 4.5v11M4.5 10h11" strokeLinecap="round" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
      {...props}
    >
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
      {...props}
    >
      <path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" strokeLinecap="round" />
    </svg>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <path
        d="M8 16.5H4.75A1.25 1.25 0 0 1 3.5 15.25V4.75A1.25 1.25 0 0 1 4.75 3.5H8"
        strokeLinecap="round"
      />
      <path d="M12.5 13.5 16 10l-3.5-3.5M16 10H7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      {...props}
    >
      <path d="M15.5 10h-11m0 0 4-4m-4 4 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
      {...props}
    >
      <path d="M4.5 10h11m0 0-4-4m4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <circle cx="9" cy="9" r="5.25" />
      <path d="m13 13 3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <path d="M10 3.75v8.5m0 0-3-3m3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M4 14.25v1a1.25 1.25 0 0 0 1.25 1.25h9.5A1.25 1.25 0 0 0 16 15.25v-1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
      {...props}
    >
      <path d="m5.5 7.75 4.5 4.5 4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
