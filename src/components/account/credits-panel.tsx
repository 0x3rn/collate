"use client";

import { useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CREDIT_PACKS } from "@/config/pricing";
import {
  formatCreditLedgerType,
  formatCredits,
  formatNumber,
  formatShortDate,
} from "@/lib/ui/formatters";

export interface LedgerEntryDisplay {
  id: string;
  entryType: string;
  creditsDelta: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

export function CreditsPanel({
  balance,
  recentLedger,
}: {
  balance: number;
  recentLedger: LedgerEntryDisplay[];
}) {
  const [currency, setCurrency] = useState<"ngn" | "usd">("ngn");
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(packId: string) {
    const provider = currency === "ngn" ? "paystack" : "stripe";
    setError(null);
    setBusyPackId(packId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, packId }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        checkoutUrl?: string;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.checkoutUrl) {
        setError(json.error ?? "Could not open checkout. Please try again.");
        return;
      }
      window.location.href = json.checkoutUrl;
    } catch {
      setError("Could not reach the payment page. Check your connection and try again.");
    } finally {
      setBusyPackId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Unified Hunter-style 3-column Credit Pack Matrix */}
      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden">
        <div className="px-6 py-4 bg-[var(--neutral-50)] border-b border-[var(--neutral-200)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h2 className="text-lg font-medium text-[var(--neutral-900)]">Credit packs</h2>
            <p className="text-xs text-[var(--neutral-600)]">
              One-time packs with no recurring subscription. Failed chapters are refunded in full.
            </p>
          </div>

          <div
            role="group"
            aria-label="Choose currency"
            className="inline-flex rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-100)] p-0.5 shrink-0 w-fit"
          >
            <button
              type="button"
              onClick={() => setCurrency("ngn")}
              aria-pressed={currency === "ngn"}
              className={`min-h-[32px] px-3 py-1 rounded-[5px] text-xs font-semibold transition-all cursor-pointer ${
                currency === "ngn"
                  ? "bg-white text-[var(--neutral-900)] shadow-[var(--shadow-subtle)]"
                  : "text-[var(--neutral-600)] hover:text-[var(--neutral-900)]"
              }`}
            >
              NGN (₦)
            </button>
            <button
              type="button"
              onClick={() => setCurrency("usd")}
              aria-pressed={currency === "usd"}
              className={`min-h-[32px] px-3 py-1 rounded-[5px] text-xs font-semibold transition-all cursor-pointer ${
                currency === "usd"
                  ? "bg-white text-[var(--neutral-900)] shadow-[var(--shadow-subtle)]"
                  : "text-[var(--neutral-600)] hover:text-[var(--neutral-900)]"
              }`}
            >
              USD ($)
            </button>
          </div>
        </div>

        {error ? (
          <div className="px-6 pt-5">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--neutral-200)]">
          {CREDIT_PACKS.map((pack, index) => {
            const featured = index === 1;
            const formattedPrice =
              currency === "ngn"
                ? `₦${(pack.amountNgnKobo / 100).toLocaleString("en-NG")}`
                : `$${(pack.amountUsdCents / 100).toFixed(0)}`;
            const providerLabel = currency === "ngn" ? "Pay with Paystack" : "Pay with Stripe";

            return (
              <div
                key={pack.id}
                className={`relative p-6 flex flex-col justify-between gap-6 ${
                  featured ? "bg-[var(--accent-100)]/25" : "bg-white"
                }`}
              >
                {featured ? (
                  <span
                    aria-hidden="true"
                    className="hidden md:block absolute top-0 left-0 right-0 h-[2px] bg-[var(--accent-600)]"
                  />
                ) : null}

                <div className="space-y-3">
                  <div className="min-h-[22px] flex items-center">
                    {featured ? (
                      <span className="px-2 py-0.5 text-[11px] font-semibold rounded-[4px] bg-[var(--accent-100)] text-[var(--accent-600)]">
                        Popular
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-[var(--neutral-500)]">
                        {index === 0 ? "Light use" : "Extended research"}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-[var(--neutral-900)]">{pack.label}</p>
                  <p
                    className="text-3xl font-medium text-[var(--neutral-900)] tabular-nums"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {formattedPrice}
                  </p>
                  <p className="text-sm text-[var(--neutral-600)] leading-relaxed">
                    {pack.description}
                  </p>
                </div>

                <Button
                  type="button"
                  variant={featured ? "primary" : "secondary"}
                  fullWidth
                  disabled={busyPackId !== null}
                  loading={busyPackId === pack.id}
                  loadingLabel="Opening checkout..."
                  onClick={() => startCheckout(pack.id)}
                >
                  {providerLabel}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="px-6 py-3 bg-[var(--neutral-50)] border-t border-[var(--neutral-200)] flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--neutral-500)] tabular-nums">
          <span>Current balance: {formatCredits(balance)}</span>
          <span>
            Secure checkout via {currency === "ngn" ? "Paystack (Naira)" : "Stripe (USD)"}
          </span>
        </div>
      </section>

      {/* Tabular Credit History Ledger */}
      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--neutral-200)]">
          <h2 className="text-lg font-medium text-[var(--neutral-900)]">Credit history</h2>
        </div>

        {recentLedger.length === 0 ? (
          <div className="px-6 py-8 text-sm text-[var(--neutral-600)]">
            No credit activity yet. Purchases, chapter runs, and automatic refunds will appear here.
          </div>
        ) : (
          <>
            <div className="hidden sm:grid sm:grid-cols-12 gap-4 px-6 py-2.5 bg-[var(--neutral-50)] border-b border-[var(--neutral-200)] text-[11px] font-semibold uppercase tracking-wider text-[var(--neutral-500)]">
              <div className="col-span-6">Activity</div>
              <div className="col-span-2">Date</div>
              <div className="col-span-2 text-right">Change</div>
              <div className="col-span-2 text-right">Balance</div>
            </div>
            <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0">
              {recentLedger.map((item) => (
                <li
                  key={item.id}
                  className="px-6 py-3.5 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 items-center text-sm hover:bg-[var(--neutral-50)] transition-colors"
                >
                  <div className="sm:col-span-6 min-w-0">
                    <p className="font-medium text-[var(--neutral-900)]">
                      {formatCreditLedgerType(item.entryType)}
                    </p>
                    {item.note ? (
                      <p className="text-xs text-[var(--neutral-500)] truncate mt-0.5">
                        {item.note}
                      </p>
                    ) : null}
                  </div>
                  <div className="sm:col-span-2 text-xs text-[var(--neutral-500)] tabular-nums">
                    {formatShortDate(item.createdAt)}
                  </div>
                  <div
                    className={`sm:col-span-2 sm:text-right font-semibold tabular-nums ${
                      item.creditsDelta >= 0
                        ? "text-[var(--success-text)]"
                        : "text-[var(--neutral-900)]"
                    }`}
                  >
                    {item.creditsDelta > 0
                      ? `+${formatNumber(item.creditsDelta)}`
                      : formatNumber(item.creditsDelta)}{" "}
                    credits
                  </div>
                  <div className="sm:col-span-2 sm:text-right text-xs text-[var(--neutral-600)] tabular-nums">
                    {formatNumber(item.balanceAfter)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
