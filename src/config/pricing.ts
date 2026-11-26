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
    description: "Covers assignments or a short research paper up to 20 pages with revision room.",
  },
  {
    id: "pack_project_60",
    label: "Project (100 credits)",
    credits: 100,
    amountNgnKobo: 3_500_000, // NGN 35,000
    amountUsdCents: 3000, // $30.00
    description: "Covers a 40–80 page project or bachelor's thesis plus revision headroom.",
  },
  {
    id: "pack_thesis_150",
    label: "Thesis (200 credits)",
    credits: 200,
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
    failureTripWindowMinutes: 60,
    failureTripCooldownMinutes: 10,
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

export interface RevisionCreditOptions {
  totalSections?: number;
  selectedSectionsCount?: number;
}

/**
 * Computes transparent revision credit costs:
 * - Auto-detect / whole-chapter revision reserves the chapter's full credit estimate
 *   because auto-detect may touch every section in the chapter.
 * - Targeting specific section(s) feeds ONLY those section(s) to the AI and deducts
 *   a proportional share (strictly less than the full chapter when targeting a subset).
 */
export function estimateRevisionCredits(
  pageBudget: number | null | undefined,
  options?: RevisionCreditOptions
): number {
  const fullChapterCredits = estimateChapterCredits(pageBudget);
  const totalSections = options?.totalSections ?? 0;
  const selectedCount = options?.selectedSectionsCount ?? 0;

  if (totalSections > 1 && selectedCount > 0 && selectedCount < totalSections) {
    const proportional = Math.ceil((fullChapterCredits * selectedCount) / totalSections);
    return Math.max(1, Math.min(fullChapterCredits - 1, proportional));
  }

  return fullChapterCredits;
}

export function estimateSingleSectionRevisionCredits(
  pageBudget: number | null | undefined,
  totalSections: number
): number {
  return estimateRevisionCredits(pageBudget, {
    totalSections,
    selectedSectionsCount: 1,
  });
}

export function estimateAssignmentCredits(
  targetPages: number | null | undefined,
  questionCount: number
): number {
  const fallbackPages = Math.max(2, questionCount * 3);
  const pages = Math.max(1, targetPages ?? fallbackPages);
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
 * plus a 15% revision buffer used when selecting the best-fit credit pack so a 100-page
 * project recommends Thesis (200 credits) instead of running out of credits during revisions.
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
    CREDIT_PACKS.find((p) => p.credits >= recommendedTotalCredits) ??
    CREDIT_PACKS[CREDIT_PACKS.length - 1]!;

  return {
    pages: safePages,
    baseCredits,
    recommendedRevisionBuffer,
    recommendedTotalCredits,
    recommendedPack: matchingPack,
  };
}
