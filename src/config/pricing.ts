import type { ProjectType } from "@/db/schema";

/**
 * Configurable credit pricing, calculation engine, sweep quotas, and spend-cap circuit breakers.
 */
export interface CreditPack {
  id: string;
  label: string;
  credits: number;
  amountNgnKobo: number;
  amountUsdCents: number;
  description: string;
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  {
    id: "pack_starter_25",
    label: "Starter (25 credits)",
    credits: 25,
    amountNgnKobo: 1_000_000, // NGN 10,000
    amountUsdCents: 1000, // $10.00
    description: "Covers assignments or a short research paper up to 25 pages.",
  },
  {
    id: "pack_project_60",
    label: "Project (80 credits)",
    credits: 80,
    amountNgnKobo: 3_000_000, // NGN 30,000
    amountUsdCents: 2500, // $25.00
    description: "Covers a 40–70 page project or bachelor's thesis plus revision headroom.",
  },
  {
    id: "pack_thesis_150",
    label: "Thesis (180 credits)",
    credits: 180,
    amountNgnKobo: 6_000_000, // NGN 60,000
    amountUsdCents: 5000, // $50.00
    description: "Covers a full master's or doctoral thesis with generous revision capacity.",
  },
] as const;

export const BILLING_POLICY = {
  creditsPerPage: 1,
  minCreditsPerChapter: 2,
  freeFeasibilitySweepsPerUser: 3,
  paidFeasibilitySweepCredits: 2,
  spendCaps: {
    perUserDailyUsd: 25.0,
    globalDailyUsd: 250.0,
    maxConsecutiveFailedJobsBeforeTrip: 12,
  },
  webhookReplayWindowSeconds: 300,
} as const;

export function findCreditPack(packId: string): CreditPack | null {
  return CREDIT_PACKS.find((p) => p.id === packId) ?? null;
}

export function estimateChapterCredits(pageBudget: number | null | undefined): number {
  const pages = Math.max(1, pageBudget ?? 5);
  return Math.max(
    BILLING_POLICY.minCreditsPerChapter,
    Math.ceil(pages * BILLING_POLICY.creditsPerPage)
  );
}

export interface ProjectCreditEstimate {
  pages: number;
  baseCredits: number;
  recommendedRevisionBuffer: number;
  recommendedTotalCredits: number;
  recommendedPack: CreditPack;
}

/**
 * Transparent credit calculation system: 1 credit per target page (minimum 2 per run),
 * plus an optional 15% revision buffer recommendation.
 */
export function calculateProjectCreditEstimate(params: {
  workType: ProjectType;
  targetPages: number;
}): ProjectCreditEstimate {
  const safePages = Math.max(2, Math.min(300, Math.round(params.targetPages)));
  const baseCredits = Math.max(
    BILLING_POLICY.minCreditsPerChapter,
    Math.ceil(safePages * BILLING_POLICY.creditsPerPage)
  );
  const recommendedRevisionBuffer = Math.max(2, Math.ceil(baseCredits * 0.15));
  const recommendedTotalCredits = baseCredits + recommendedRevisionBuffer;

  const matchingPack =
    CREDIT_PACKS.find((p) => p.credits >= baseCredits) ?? CREDIT_PACKS[CREDIT_PACKS.length - 1]!;

  return {
    pages: safePages,
    baseCredits,
    recommendedRevisionBuffer,
    recommendedTotalCredits,
    recommendedPack: matchingPack,
  };
}
