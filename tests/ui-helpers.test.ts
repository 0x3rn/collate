import { describe, expect, it } from "vitest";
import { PROJECT_STATUSES, PROJECT_TYPES } from "@/db/schema";
import { formatProjectStatus, formatProjectType, formatShortDate } from "@/lib/ui/formatters";

describe("UI presentation formatters", () => {
  it("provides plain human-readable labels for every project type", () => {
    for (const type of PROJECT_TYPES) {
      expect(formatProjectType(type).length).toBeGreaterThan(2);
    }
    expect(formatProjectType("research")).toBe("Research paper");
  });

  it("provides non-color-only text labels and semantic tones for every project status", () => {
    for (const status of PROJECT_STATUSES) {
      const display = formatProjectStatus(status);
      expect(display.label.length).toBeGreaterThan(2);
      expect(["neutral", "info", "success", "warning", "error"]).toContain(display.tone);
    }
  });

  it("formats UTC dates deterministically", () => {
    expect(formatShortDate(new Date("2026-11-21T15:00:00.000Z"))).toBe("21 Nov 2026");
  });
});
