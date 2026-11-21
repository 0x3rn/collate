export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bytesA = enc.encode(a);
  const bytesB = enc.encode(b);

  const maxLen = Math.max(bytesA.length, bytesB.length);
  let diff = bytesA.length ^ bytesB.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0;
}

export interface InternalAuthResult {
  authorized: boolean;
  status: 200 | 401 | 503;
  reason?: string;
}

/**
 * Protects internal smoke-test and operational routes.
 * Fails closed in staging/prod when INTERNAL_SMOKE_TOKEN is not configured.
 */
export function authorizeInternalRequest(
  request: Request,
  env: { APP_ENV?: string; INTERNAL_SMOKE_TOKEN?: string }
): InternalAuthResult {
  const configuredToken = env.INTERNAL_SMOKE_TOKEN?.trim();
  const appEnv = env.APP_ENV ?? "dev";

  if (!configuredToken) {
    if (appEnv === "dev") {
      return { authorized: true, status: 200 };
    }
    return {
      authorized: false,
      status: 503,
      reason: "INTERNAL_SMOKE_TOKEN is not configured for this environment",
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) {
    return { authorized: false, status: 401, reason: "Missing Bearer authorization header" };
  }

  const provided = header.slice(prefix.length).trim();
  if (!provided || !timingSafeEqualString(provided, configuredToken)) {
    return { authorized: false, status: 401, reason: "Invalid authorization token" };
  }

  return { authorized: true, status: 200 };
}
