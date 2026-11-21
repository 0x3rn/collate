import { describe, expect, it } from "vitest";
import { buildHealthPayload, HealthPayloadSchema } from "@/lib/health";

describe("buildHealthPayload", () => {
  it("returns a valid default payload", () => {
    const fixedDate = new Date("2026-11-21T12:00:00.000Z");
    const result = buildHealthPayload({ now: fixedDate });

    expect(result).toEqual({
      ok: true,
      app: "Collate",
      environment: "dev",
      phase: "0.1-foundations",
      timestamp: "2026-11-21T12:00:00.000Z",
    });
    expect(HealthPayloadSchema.safeParse(result).success).toBe(true);
  });

  it("accepts staging and prod environments", () => {
    expect(buildHealthPayload({ environment: "staging" }).environment).toBe("staging");
    expect(buildHealthPayload({ environment: "prod" }).environment).toBe("prod");
  });

  it("falls back safely to dev when environment is unknown", () => {
    expect(buildHealthPayload({ environment: "unknown-env" }).environment).toBe("dev");
  });

  it("trims whitespace and falls back to Collate for blank appName", () => {
    expect(buildHealthPayload({ appName: "   " }).app).toBe("Collate");
    expect(buildHealthPayload({ appName: "  Collate Staging  " }).app).toBe("Collate Staging");
  });

  it("throws explicitly on an invalid Date", () => {
    expect(() => buildHealthPayload({ now: new Date("not-a-date") })).toThrow(
      "Invalid Date supplied to buildHealthPayload"
    );
  });
});
