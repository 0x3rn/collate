import { describe, expect, it } from "vitest";
import { CREDIT_PACKS } from "@/config/pricing";
import {
  CITATION_SPECIMENS,
  getPublicPricingSummary,
  LANDING_FAQS,
  REFUSAL_RULES,
  WORKFLOW_STEPS,
  WORK_TYPE_OVERVIEWS,
} from "@/lib/marketing/landing-content";

const BANNED_BUZZWORDS = [
  "revolutionary",
  "game-changing",
  "cutting-edge",
  "next-gen",
  "seamless",
  "effortless",
  "frictionless",
  "leverage",
  "utilize",
  "synergy",
  "ecosystem",
  "holistic",
  "empower",
  "unlock",
  "supercharge",
  "elevate",
  "ai-powered",
  "best-in-class",
  "world-class",
  "industry-leading",
  "all-in-one",
];

const INTERNAL_TECH_JARGON = [
  "paystack",
  "stripe",
  "cloudflare",
  "n-gram",
  "two-pass",
  "backend",
  "json",
  "workers",
];

describe("Landing page copy quality, non-technical language & config sync", () => {
  it("contains zero banned marketing buzzwords and zero leaked internal tech jargon", () => {
    const allText = [
      ...WORK_TYPE_OVERVIEWS.flatMap((w) => [w.title, w.pageRange, w.bestFor, w.structureNote]),
      ...WORKFLOW_STEPS.flatMap((s) => [s.title, s.body]),
      ...CITATION_SPECIMENS.map((c) => c.label),
      ...REFUSAL_RULES.flatMap((r) => [r.willDo, r.wontDo]),
      ...LANDING_FAQS.flatMap((f) => [f.question, f.answer]),
    ]
      .join(" ")
      .toLowerCase();

    for (const buzz of BANNED_BUZZWORDS) {
      expect(allText, `Banned buzzword found: ${buzz}`).not.toContain(buzz);
    }

    for (const tech of INTERNAL_TECH_JARGON) {
      expect(allText, `Leaked technical jargon found: ${tech}`).not.toContain(tech);
    }
  });

  it("matches live CREDIT_PACKS pricing exactly with zero hardcoded drift", () => {
    const summary = getPublicPricingSummary();
    expect(summary.packs).toHaveLength(CREDIT_PACKS.length);
    expect(summary.packs[0]?.credits).toBe(CREDIT_PACKS[0]?.credits);
    expect(summary.packs[1]?.featured).toBe(true);
    expect(summary.packs[1]?.ngnFormatted).toContain("16,500");
    expect(summary.packs[2]?.usdFormatted).toBe("$32");
  });
});
