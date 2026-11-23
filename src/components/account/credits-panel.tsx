"use client";

import { useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CREDIT_PACKS } from "@/config/pricing";

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
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(provider: "paystack" | "stripe", packId: string) {
    const key = `${provider}-${packId}`;
    setError(null);
    setBusyKey(key);
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
        setError(json.error ?? "Could not start checkout. Please try again.");
        return;
      }
      window.location.href = json.checkoutUrl;
    } catch {
      setError("Network error while connecting to payment provider.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--neutral-200)] pb-4">
        <div className="space-y-1">
          <h2 className="text-xl font-medium m-0">Credits and billing</h2>
          <p className="text-xs text-[var(--neutral-600)] m-0">
            Credits are reserved per chapter and refunded automatically if a chapter run fails.
          </p>
        </div>
        <span className="text-base font-semibold tabular-nums text-[var(--accent-600)]">
          {balance} credits available
        </span>
      </div>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {CREDIT_PACKS.map((pack) => (
          <div
            key={pack.id}
            className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] flex flex-col justify-between gap-4"
          >
            <div className="space-y-1.5">
              <p className="text-base font-semibold text-[var(--neutral-900)] m-0">{pack.label}</p>
              <p className="text-xs text-[var(--neutral-700)] tabular-nums m-0">
                NGN {(pack.amountNgnKobo / 100).toLocaleString()} · USD $
                {(pack.amountUsdCents / 100).toFixed(2)}
              </p>
              <p className="text-xs text-[var(--neutral-600)] m-0">{pack.description}</p>
            </div>
            <div className="space-y-2">
              <Button
                type="button"
                variant="primary"
                fullWidth
                disabled={busyKey !== null}
                loading={busyKey === `paystack-${pack.id}`}
                loadingLabel="Opening Paystack..."
                onClick={() => startCheckout("paystack", pack.id)}
              >
                Pay with Paystack (NGN)
              </Button>
              <Button
                type="button"
                variant="secondary"
                fullWidth
                disabled={busyKey !== null}
                loading={busyKey === `stripe-${pack.id}`}
                loadingLabel="Opening Stripe..."
                onClick={() => startCheckout("stripe", pack.id)}
              >
                Pay with Stripe (USD)
              </Button>
            </div>
          </div>
        ))}
      </div>

      {recentLedger.length > 0 ? (
        <div className="space-y-2 pt-2 border-t border-[var(--neutral-200)]">
          <h3 className="text-sm font-semibold text-[var(--neutral-900)] m-0">Recent ledger</h3>
          <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0 text-xs">
            {recentLedger.map((item) => (
              <li
                key={item.id}
                className="py-2 flex items-center justify-between gap-2 tabular-nums"
              >
                <span className="text-[var(--neutral-700)]">
                  <strong>{item.entryType}</strong>
                  {item.note ? ` · ${item.note}` : ""}
                </span>
                <span
                  className={
                    item.creditsDelta >= 0
                      ? "font-semibold text-[var(--success-text)]"
                      : "font-semibold text-[var(--neutral-800)]"
                  }
                >
                  {item.creditsDelta >= 0 ? `+${item.creditsDelta}` : item.creditsDelta} (bal:{" "}
                  {item.balanceAfter})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
