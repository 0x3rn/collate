import { LEGAL_CONFIG } from "@/lib/legal/config";

/**
 * Details kept with sign-ups, sign-ins, checkouts and downloads, so a payment dispute can be
 * answered with who did what, when, and from where. Never includes passwords or tokens.
 */
export const TERMS_VERSION = LEGAL_CONFIG.lastUpdated;

export interface RequestEvidence {
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  city: string | null;
}

export function evidenceFromValues(v: {
  ip?: string | null;
  userAgent?: string | null;
  country?: string | null;
  city?: string | null;
}): RequestEvidence {
  const clean = (s: string | null | undefined, max: number) =>
    s && s.trim() && s.trim() !== "unknown" ? s.trim().slice(0, max) : null;
  return {
    ip: clean(v.ip, 64),
    userAgent: clean(v.userAgent, 300),
    country: clean(v.country, 2),
    city: clean(v.city, 80),
  };
}

/** From a raw request: Cloudflare's client IP header and request.cf location. */
export function evidenceFromRequest(request: Request): RequestEvidence {
  const cf = (request as unknown as { cf?: { city?: unknown; country?: unknown } }).cf;
  return evidenceFromValues({
    ip: request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip"),
    userAgent: request.headers.get("user-agent"),
    country: typeof cf?.country === "string" ? cf.country : null,
    city: typeof cf?.city === "string" ? cf.city : null,
  });
}
