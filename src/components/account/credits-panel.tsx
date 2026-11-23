"use client";

import { useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CREDIT_PACKS } from "@/config/pricing";
import { formatCreditLedgerType, formatShortDate } from "@/lib/ui/formatters";

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
      {/* Credit packs selector */}
      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--neutral-200)] pb-4">
          <div className="space-y-1">
            <h2 className="text-xl font-medium m-0">Buy credit packs</h2>
            <p className="text-sm text-[var(--neutral-600)] m-0">
              Credits stay in your account until you use them. If a chapter run fails, your credits
              are returned automatically.
            </p>
          </div>

          <div
            role="group"
            aria-label="Choose currency"
            className="inline-flex rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] p-1 shrink-0 w-fit"
          >
            <button
              type="button"
              onClick={() => setCurrency("ngn")}
              aria-pressed={currency === "ngn"}
              className={`min-h-[34px] px-3 py-1 rounded-[4px] text-xs font-semibold transition-colors cursor-pointer ${
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
              className={`min-h-[34px] px-3 py-1 rounded-[4px] text-xs font-semibold transition-colors cursor-pointer ${
                currency === "usd"
                  ? "bg-white text-[var(--neutral-900)] shadow-[var(--shadow-subtle)]"
                  : "text-[var(--neutral-600)] hover:text-[var(--neutral-900)]"
              }`}
            >
              USD ($)
            </button>
          </div>
        </div>

        {error ? <FormAlert tone="error">{error}</FormAlert> : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                className={`p-5 rounded-[var(--radius-md)] border flex flex-col justify-between gap-5 ${
                  featured
                    ? "bg-white border-[var(--accent-600)] shadow-[var(--shadow-subtle)]"
                    : "bg-[var(--neutral-50)] border-[var(--neutral-200)]"
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--neutral-900)] m-0">
                      {pack.label}
                    </p>
                    {featured ? (
                      <span className="px-2 py-0.5 text-[11px] font-semibold rounded-[var(--radius-sm)] bg-[var(--accent-100)] text-[var(--accent-600)]">
                        Popular
                      </span>
                    ) : null}
                  </div>
                  <p className="text-2xl font-semibold text-[var(--neutral-900)] tabular-nums m-0">
                    {formattedPrice}
                  </p>
                  <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
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

        <p className="text-xs text-[var(--neutral-500)] m-0 tabular-nums">
          Current balance: {balance} credits · Secure checkout via{" "}
          {currency === "ngn" ? "Paystack (Naira)" : "Stripe (USD)"}.
        </p>
      </section>

      {/* Plain-English credit history */}
      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--neutral-200)]">
          <h2 className="text-lg font-medium m-0">Credit history</h2>
        </div>

        {recentLedger.length === 0 ? (
          <div className="px-6 py-8 text-sm text-[var(--neutral-600)]">
            No credit activity yet. Purchases, chapter runs, and automatic refunds will appear here.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0">
            {recentLedger.map((item) => (
              <li
                key={item.id}
                className="px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
              >
                <div className="space-y-0.5 min-w-0">
                  <p className="font-medium text-[var(--neutral-900)] m-0">
                    {formatCreditLedgerType(item.entryType)}
                  </p>
                  <p className="text-xs text-[var(--neutral-600)] m-0">
                    {item.note ? `${item.note} · ` : ""}
                    {formatShortDate(item.createdAt)}
                  </p>
                </div>

                <div className="flex sm:flex-col items-baseline sm:items-end justify-between gap-2 sm:gap-0.5 tabular-nums shrink-0">
                  <span
                    className={
                      item.creditsDelta >= 0
                        ? "font-semibold text-[var(--success-text)]"
                        : "font-semibold text-[var(--neutral-900)]"
                    }
                  >
                    {item.creditsDelta > 0 ? `+${item.creditsDelta}` : item.creditsDelta} credits
                  </span>
                  <span className="text-xs text-[var(--neutral-500)]">
                    Balance: {item.balanceAfter}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
