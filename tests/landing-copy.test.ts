import { describe, expect, it } from "vitest";
import { calculateProjectCreditEstimate, CREDIT_PACKS } from "@/config/pricing";
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
  "workspace",
];

describe("Landing page copy quality, pricing & credit calculation", () => {
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

  it("matches exact $10/10k, $25/30k, $50/60k credit packs and calculates project credits accurately", () => {
    const summary = getPublicPricingSummary();
    expect(summary.packs).toHaveLength(CREDIT_PACKS.length);
    expect(summary.packs[0]).toMatchObject({
      credits: 25,
      ngnFormatted: "₦10,000",
      usdFormatted: "$10",
    });
    expect(summary.packs[1]).toMatchObject({
      credits: 80,
      featured: true,
      ngnFormatted: "₦30,000",
      usdFormatted: "$25",
    });
    expect(summary.packs[2]).toMatchObject({
      credits: 180,
      ngnFormatted: "₦60,000",
      usdFormatted: "$50",
    });

    const est = calculateProjectCreditEstimate({ workType: "project", targetPages: 55 });
    expect(est.baseCredits).toBe(55);
    expect(est.recommendedPack.id).toBe("pack_project_60");
  });
});
