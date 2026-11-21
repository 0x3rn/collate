export type LLMErrorCode =
  | "VALIDATION_ERROR"
  | "CONFIG_ERROR"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "BAD_RESPONSE"
  | "SPEND_CAP_EXCEEDED";

export interface LLMErrorOptions {
  code: LLMErrorCode;
  message: string;
  retryable: boolean;
  statusCode?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

export class LLMError extends Error {
  public readonly code: LLMErrorCode;
  public readonly retryable: boolean;
  public readonly statusCode?: number;
  public readonly retryAfterMs?: number;

  constructor(options: LLMErrorOptions) {
    super(sanitizeErrorMessage(options.message), { cause: options.cause });
    this.name = "LLMError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Removes credential-like tokens before errors are logged to D1 or surfaced in diagnostics.
 */
export function sanitizeErrorMessage(raw: string): string {
  const redacted = raw
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED_ANTHROPIC_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/x-api-key\s*[:=]\s*[^\s,;]+/gi, "x-api-key: [REDACTED]");

  return redacted.length > 1000 ? `${redacted.slice(0, 997)}...` : redacted;
}
