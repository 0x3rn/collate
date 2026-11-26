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

    expect(allText, "Avoid em-dashes in public marketing copy").not.toContain("\u2014");
  });

  it("matches exact $10/10k, $30/35k, $50/60k credit packs and calculates project credits accurately", () => {
    const summary = getPublicPricingSummary();
    expect(summary.packs).toHaveLength(CREDIT_PACKS.length);
    expect(summary.packs[0]).toMatchObject({
      credits: 25,
      ngnFormatted: "₦10,000",
      usdFormatted: "$10",
    });
    expect(summary.packs[1]).toMatchObject({
      credits: 100,
      featured: true,
      ngnFormatted: "₦35,000",
      usdFormatted: "$30",
    });
    expect(summary.packs[2]).toMatchObject({
      credits: 200,
      ngnFormatted: "₦60,000",
      usdFormatted: "$50",
    });

    const est = calculateProjectCreditEstimate({ workType: "project", targetPages: 55 });
    expect(est.baseCredits).toBe(55);
    expect(est.recommendedTotalCredits).toBe(64);
    expect(est.recommendedPack.id).toBe("pack_project_60");

    // 100-page project needs 100 base credits + revision headroom (115 total) -> recommends Thesis (200 credits)
    const hundredPage = calculateProjectCreditEstimate({ workType: "project", targetPages: 100 });
    expect(hundredPage.baseCredits).toBe(100);
    expect(hundredPage.recommendedTotalCredits).toBe(115);
    expect(hundredPage.recommendedPack.id).toBe("pack_thesis_150");

    // Short 15-page assignment (15 + 3 = 18 credits) fits Starter (25 credits)
    const shortAssignment = calculateProjectCreditEstimate({
      workType: "assignment",
      targetPages: 15,
    });
    expect(shortAssignment.recommendedPack.id).toBe("pack_starter_25");

    // 25-page research paper needs revision headroom (25 + 4 = 29 credits) -> recommends Project (100 credits)
    const research25 = calculateProjectCreditEstimate({ workType: "research", targetPages: 25 });
    expect(research25.recommendedTotalCredits).toBe(29);
    expect(research25.recommendedPack.id).toBe("pack_project_60");
  });
});
