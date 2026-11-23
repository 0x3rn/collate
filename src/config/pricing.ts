/**
 * Configurable credit pricing, sweep quotas, and spend-cap circuit breakers.
 * Calibrate credit pack prices from measured jobs_log cost-per-page before public launch.
 */
export interface CreditPack {
  id: string;
  label: string;
  credits: number;
  amountNgnKobo: number; // Minor units (kobo): e.g. 15_000 NGN = 1_500_000 kobo
  amountUsdCents: number; // Minor units (cents): e.g. $12.00 = 1200 cents
  description: string;
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  {
    id: "pack_starter_25",
    label: "Starter (25 credits)",
    credits: 25,
    amountNgnKobo: 750_000, // NGN 7,500
    amountUsdCents: 600, // $6.00
    description: "Covers assignments or a short 25-page research paper.",
  },
  {
    id: "pack_project_60",
    label: "Project (60 credits)",
    credits: 60,
    amountNgnKobo: 1_650_000, // NGN 16,500
    amountUsdCents: 1400, // $14.00
    description: "Covers a full 60-page undergraduate project or bachelor's thesis.",
  },
  {
    id: "pack_thesis_150",
    label: "Thesis (150 credits)",
    credits: 150,
    amountNgnKobo: 3_750_000, // NGN 37,500
    amountUsdCents: 3200, // $32.00
    description: "Covers a master's thesis or multiple research projects.",
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
  webhookReplayWindowSeconds: 300, // 5 minutes
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
