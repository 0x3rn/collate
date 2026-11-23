"use client";

import { useState } from "react";
import { LinkButton } from "@/components/ui/button";

export interface PublicPackCard {
  id: string;
  label: string;
  credits: number;
  featured: boolean;
  ngnFormatted: string;
  usdFormatted: string;
  description: string;
}

export function PricingShowcase({
  packs,
  signedIn,
}: {
  packs: PublicPackCard[];
  signedIn: boolean;
}) {
  const [currency, setCurrency] = useState<"ngn" | "usd">("ngn");

  return (
    <div className="space-y-8">
      <div className="inline-flex items-center p-1 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-white">
        <button
          type="button"
          onClick={() => setCurrency("ngn")}
          className={`min-h-[38px] px-4 py-1.5 text-sm font-medium rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
            currency === "ngn"
              ? "bg-[var(--accent-600)] text-white"
              : "text-[var(--neutral-700)] hover:text-[var(--neutral-900)]"
          }`}
        >
          Nigerian Naira (₦)
        </button>
        <button
          type="button"
          onClick={() => setCurrency("usd")}
          className={`min-h-[38px] px-4 py-1.5 text-sm font-medium rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
            currency === "usd"
              ? "bg-[var(--accent-600)] text-white"
              : "text-[var(--neutral-700)] hover:text-[var(--neutral-900)]"
          }`}
        >
          US Dollars ($)
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        {packs.map((pack) => (
          <div
            key={pack.id}
            className={`bg-white rounded-[var(--radius-md)] p-6 sm:p-7 flex flex-col justify-between gap-6 border transition-shadow duration-200 hover:shadow-[var(--shadow-subtle)] ${
              pack.featured
                ? "border-[var(--accent-600)] ring-1 ring-[var(--accent-600)]"
                : "border-[var(--neutral-200)]"
            }`}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--accent-600)] m-0">{pack.label}</p>
                {pack.featured ? (
                  <span className="px-2.5 py-0.5 text-[11px] font-medium rounded-[var(--radius-sm)] bg-[var(--accent-100)] text-[var(--accent-600)]">
                    Most common
                  </span>
                ) : null}
              </div>

              <p
                className="text-3xl font-medium text-[var(--neutral-900)] tabular-nums m-0"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {currency === "ngn" ? pack.ngnFormatted : pack.usdFormatted}
              </p>

              <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
                {pack.description}
              </p>

              <ul className="pt-3 border-t border-[var(--neutral-200)] space-y-2 list-none p-0 m-0 text-xs text-[var(--neutral-700)]">
                <li>{pack.credits} writing credits (no expiry)</li>
                <li>Full PDF and Word (.docx) exports</li>
                <li>Automatic refund if a chapter fails</li>
              </ul>
            </div>

            <LinkButton
              href={signedIn ? "/account" : "/sign-up"}
              variant={pack.featured ? "primary" : "secondary"}
              fullWidth
            >
              {signedIn ? "Top up in account" : "Create account"}
            </LinkButton>
          </div>
        ))}
      </div>
    </div>
  );
}
