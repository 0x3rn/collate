import { z } from "zod";

export const AppEnvSchema = z.enum(["dev", "staging", "prod"]);
export type AppEnv = z.infer<typeof AppEnvSchema>;

export const HealthPayloadSchema = z.object({
  ok: z.literal(true),
  app: z.string().min(1),
  environment: AppEnvSchema,
  phase: z.string().min(1),
  timestamp: z.string().datetime(),
});

export type HealthPayload = z.infer<typeof HealthPayloadSchema>;

export interface BuildHealthInput {
  appName?: string;
  environment?: string;
  now?: Date;
}

/**
 * Pure domain helper for /api/health.
 * Validates environment explicitly instead of trusting unvalidated runtime strings.
 */
export function buildHealthPayload(input: BuildHealthInput = {}): HealthPayload {
  const parsedEnv = AppEnvSchema.safeParse(input.environment ?? "dev");
  const environment: AppEnv = parsedEnv.success ? parsedEnv.data : "dev";

  const appName = input.appName?.trim() || "Collate";
  const now = input.now ?? new Date();

  if (Number.isNaN(now.getTime())) {
    throw new Error("Invalid Date supplied to buildHealthPayload");
  }

  return HealthPayloadSchema.parse({
    ok: true,
    app: appName,
    environment,
    phase: "0.1-foundations",
    timestamp: now.toISOString(),
  });
}
