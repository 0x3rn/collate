/**
 * Centralized legal and compliance metadata used across Terms of Service,
 * Refund Policy, Privacy Policy, Acceptable Use Policy, and Cookie Policy.
 *
 * Update these values in one place whenever corporate entity details,
 * dedicated legal/privacy aliases, or governing jurisdiction change.
 */
export const LEGAL_CONFIG = {
  serviceName: "Collate",
  operatorName: "Collate",
  siteUrl: "https://collate.corstack.dev",
  effectiveDate: "November 24, 2026",
  lastUpdated: "November 24, 2026",
  supportEmail: "collate@corstack.dev",
  privacyEmail: "collate@corstack.dev",
  abuseEmail: "collate@corstack.dev",
  governingLaw: "the Federal Republic of Nigeria",
  venueLocation: "Lagos, Nigeria",
} as const;

export const LEGAL_NAV_ITEMS = [
  { href: "/terms", label: "Terms & Refund Policy" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/acceptable-use", label: "Acceptable Use" },
  { href: "/cookies", label: "Cookie Policy" },
] as const;
