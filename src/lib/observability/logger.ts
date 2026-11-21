import { sanitizeErrorMessage } from "@/lib/ai/errors";

export type LogLevel = "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  event: string;
  timestamp: string;
  requestId?: string;
  workflowId?: string;
  projectId?: string;
  data?: Record<string, unknown>;
}

const SENSITIVE_KEY_PATTERN =
  /(secret|token|password|apikey|api_key|authorization|cookie|private)/i;

export function scrubSensitiveFields(input: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      clean[key] = "[REDACTED]";
      continue;
    }
    if (typeof value === "string") {
      clean[key] = sanitizeErrorMessage(value);
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      clean[key] = scrubSensitiveFields(value as Record<string, unknown>);
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

export function formatStructuredLog(
  level: LogLevel,
  event: string,
  meta: {
    requestId?: string;
    workflowId?: string;
    projectId?: string;
    data?: Record<string, unknown>;
    now?: Date;
  } = {}
): LogRecord {
  return {
    level,
    event,
    timestamp: (meta.now ?? new Date()).toISOString(),
    ...(meta.requestId ? { requestId: meta.requestId } : {}),
    ...(meta.workflowId ? { workflowId: meta.workflowId } : {}),
    ...(meta.projectId ? { projectId: meta.projectId } : {}),
    ...(meta.data ? { data: scrubSensitiveFields(meta.data) } : {}),
  };
}

export function logEvent(
  level: LogLevel,
  event: string,
  meta?: {
    requestId?: string;
    workflowId?: string;
    projectId?: string;
    data?: Record<string, unknown>;
  }
): LogRecord {
  const entry = formatStructuredLog(level, event, meta);
  const serialized = JSON.stringify(entry);
  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
  return entry;
}
