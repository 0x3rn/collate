"use client";

import { useState } from "react";
import { LinkButton } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { calculateProjectCreditEstimate } from "@/config/pricing";
import type { ProjectType } from "@/db/schema";

export interface PublicPackCard {
  id: string;
  label: string;
  credits: number;
  featured: boolean;
  ngnFormatted: string;
  usdFormatted: string;
  description: string;
}

const DEFAULT_PAGES_BY_TYPE: Record<ProjectType, number> = {
  assignment: 12,
  research: 25,
  project: 55,
  thesis: 100,
};

export function PricingShowcase({
  packs,
  signedIn,
}: {
  packs: PublicPackCard[];
  signedIn: boolean;
}) {
  const [currency, setCurrency] = useState<"ngn" | "usd">("usd");
  const [workType, setWorkType] = useState<ProjectType>("project");
  const [pages, setPages] = useState<number>(55);

  const estimate = calculateProjectCreditEstimate({ workType, targetPages: pages });

  function handleWorkTypeChange(nextType: ProjectType) {
    setWorkType(nextType);
    setPages(DEFAULT_PAGES_BY_TYPE[nextType]);
  }

  return (
    <div className="space-y-8">
      {/* Interactive Credit Calculation Strip */}
      <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        <div className="lg:col-span-7 space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent-600)]">
              Credit calculator
            </p>
            <p className="text-sm text-[var(--neutral-700)]">
              Estimate how many credits your work needs (1 credit per page, plus headroom for
              revisions).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="calc-work-type"
                className="block text-xs font-medium text-[var(--neutral-700)]"
              >
                Work type
              </label>
              <CustomSelect<ProjectType>
                id="calc-work-type"
                ariaLabel="Work type"
                size="sm"
                value={workType}
                onChange={handleWorkTypeChange}
                buttonClassName="min-h-[44px] sm:min-h-[38px] bg-[var(--neutral-50)] hover:bg-white"
                options={[
                  { value: "project", label: "Project (40-70 pages)" },
                  { value: "research", label: "Research paper (15-40 pages)" },
                  { value: "thesis", label: "Thesis (50-300 pages)" },
                  { value: "assignment", label: "Assignment (2-6 pages / question)" },
                ]}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="calc-pages"
                className="block text-xs font-medium text-[var(--neutral-700)]"
              >
                Target pages ({pages})
              </label>
              <input
                id="calc-pages"
                type="range"
                min={2}
                max={200}
                value={pages}
                onChange={(e) => setPages(Number(e.target.value))}
                className="w-full h-10 accent-[var(--accent-600)] cursor-pointer"
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 p-4 sm:p-5 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)] space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-[var(--neutral-600)]">Estimated requirement</span>
            <span className="text-2xl font-semibold tabular-nums text-[var(--neutral-900)]">
              {estimate.baseCredits} credits
            </span>
          </div>
          <p className="text-xs text-[var(--neutral-600)] tabular-nums">
            Recommended with revision buffer: {estimate.recommendedTotalCredits} credits · Best fit:{" "}
            <strong className="text-[var(--accent-600)]">{estimate.recommendedPack.label}</strong>
          </p>
        </div>
      </div>

      {/* Currency toggle */}
      <div className="inline-flex items-center p-1 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-white">
        <button
          type="button"
          onClick={() => setCurrency("usd")}
          className={`min-h-[44px] sm:min-h-[40px] px-4 py-1.5 text-sm font-medium rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
            currency === "usd"
              ? "bg-[var(--accent-600)] text-white"
              : "text-[var(--neutral-700)] hover:text-[var(--neutral-900)]"
          }`}
        >
          US Dollars ($)
        </button>
        <button
          type="button"
          onClick={() => setCurrency("ngn")}
          className={`min-h-[44px] sm:min-h-[40px] px-4 py-1.5 text-sm font-medium rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
            currency === "ngn"
              ? "bg-[var(--accent-600)] text-white"
              : "text-[var(--neutral-700)] hover:text-[var(--neutral-900)]"
          }`}
        >
          Nigerian Naira (₦)
        </button>
      </div>

      {/* 3 Packs: stacked on phones, crisp 2-column horizontal rows on md tablet, spacious 3-column comparison grid on lg+ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 xl:gap-6 items-stretch">
        {packs.map((pack) => (
          <div
            key={pack.id}
            className={`bg-white rounded-[var(--radius-md)] p-6 sm:p-7 flex flex-col md:flex-row md:items-center lg:flex-col lg:items-stretch justify-between gap-6 border transition-shadow duration-200 hover:shadow-[var(--shadow-subtle)] ${
              pack.featured
                ? "border-[var(--accent-600)] ring-1 ring-[var(--accent-600)]"
                : "border-[var(--neutral-200)]"
            }`}
          >
            <div className="space-y-3 md:flex-1 lg:flex-none">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--accent-600)]">{pack.label}</p>
                {pack.featured ? (
                  <span className="shrink-0 whitespace-nowrap px-2.5 py-0.5 text-[11px] font-medium rounded-[var(--radius-sm)] bg-[var(--accent-100)] text-[var(--accent-600)]">
                    Most common
                  </span>
                ) : null}
              </div>

              <div className="space-y-0.5">
                <p
                  className="text-3xl font-medium text-[var(--neutral-900)] tabular-nums"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  {currency === "ngn" ? pack.ngnFormatted : pack.usdFormatted}
                </p>
                <p className="text-xs text-[var(--neutral-500)] tabular-nums">
                  {currency === "ngn"
                    ? `or ${pack.usdFormatted} USD`
                    : `or ${pack.ngnFormatted} NGN`}
                </p>
              </div>

              <p className="text-sm text-[var(--neutral-600)] leading-relaxed">
                {pack.description}
              </p>

              <ul className="pt-3 border-t border-[var(--neutral-200)] space-y-2 list-none p-0 text-xs text-[var(--neutral-700)]">
                <li>{pack.credits} writing credits (no expiry)</li>
                <li>Full PDF and Word (.docx) exports</li>
                <li>Automatic refund if a chapter fails</li>
              </ul>
            </div>

            <div className="md:w-48 lg:w-full shrink-0">
              <LinkButton
                href={signedIn ? "/billing" : "/sign-up"}
                variant={pack.featured ? "primary" : "secondary"}
                fullWidth
              >
                {signedIn ? "Top up credits" : "Create account"}
              </LinkButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
