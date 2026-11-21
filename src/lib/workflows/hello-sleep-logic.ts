import { z } from "zod";

const SLEEP_DURATION_REGEX = /^(\d+)\s+(second|seconds|minute|minutes|hour|hours)$/;

export type SleepDuration =
  `${number} ${"second" | "seconds" | "minute" | "minutes" | "hour" | "hours"}` | number;

export const SleepDurationSchema = z.union([
  z.number().int().positive(),
  z
    .string()
    .trim()
    .refine((val): val is Exclude<SleepDuration, number> => SLEEP_DURATION_REGEX.test(val), {
      message: "sleepDuration must be positive ms or '<n> second(s)|minute(s)|hour(s)'",
    }),
]);

export const HelloSleepPayloadSchema = z.object({
  label: z.string().trim().min(1).max(120).default("phase-0-smoke"),
  sleepDuration: SleepDurationSchema.default("1 minute"),
});

export type HelloSleepPayload = z.input<typeof HelloSleepPayloadSchema>;

export interface StartStepOutput {
  startedAt: string;
  startedMs: number;
}

export interface ResumeStepOutput {
  resumedAt: string;
  elapsedMs: number;
}

export interface HelloSleepResult {
  ok: true;
  label: string;
  sleepDuration: SleepDuration;
  startedAt: string;
  resumedAt: string;
  elapsedMs: number;
}

export interface HelloSleepSteps {
  recordStart(callback: () => Promise<StartStepOutput>): Promise<StartStepOutput>;
  sleep(duration: SleepDuration): Promise<void>;
  recordResume(callback: () => Promise<ResumeStepOutput>): Promise<ResumeStepOutput>;
}

/**
 * Pure workflow orchestration separated from Cloudflare's WorkflowEntrypoint class
 * so durable step ordering and state transitions can be tested directly in Vitest.
 */
export async function runHelloSleepWorkflow(
  rawPayload: unknown,
  steps: HelloSleepSteps,
  nowFn: () => Date = () => new Date()
): Promise<HelloSleepResult> {
  const parsed = HelloSleepPayloadSchema.parse(rawPayload ?? {});

  const started = await steps.recordStart(async () => {
    const now = nowFn();
    return { startedAt: now.toISOString(), startedMs: now.getTime() };
  });

  await steps.sleep(parsed.sleepDuration);

  const resumed = await steps.recordResume(async () => {
    const now = nowFn();
    return {
      resumedAt: now.toISOString(),
      elapsedMs: Math.max(0, now.getTime() - started.startedMs),
    };
  });

  return {
    ok: true,
    label: parsed.label,
    sleepDuration: parsed.sleepDuration,
    startedAt: started.startedAt,
    resumedAt: resumed.resumedAt,
    elapsedMs: resumed.elapsedMs,
  };
}
