"use client";

import { useState } from "react";
import { CheckoutTermsText, TermsCheckbox } from "@/components/legal/terms-checkbox";
import { Button } from "@/components/ui/button";
import { ModalCard } from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";
import { CREDIT_PACKS } from "@/config/pricing";
import { formatCreditLedgerType, formatNumber, formatShortDate } from "@/lib/ui/formatters";

export interface LedgerEntryDisplay {
  id: string;
  entryType: string;
  creditsDelta: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

export function CreditsPanel({ recentLedger }: { recentLedger: LedgerEntryDisplay[] }) {
  const toast = useToast();
  const [currency, setCurrency] = useState<"ngn" | "usd">("usd");
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  // The pack being bought: Buy opens this pop-up, and checkout loads only after the box is ticked.
  const [confirmPackId, setConfirmPackId] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const confirmPack = CREDIT_PACKS.find((p) => p.id === confirmPackId) ?? null;

  function formatPrice(pack: (typeof CREDIT_PACKS)[number]): string {
    return currency === "ngn"
      ? `₦${(pack.amountNgnKobo / 100).toLocaleString("en-NG")}`
      : `$${(pack.amountUsdCents / 100).toFixed(0)}`;
  }

  function openConfirm(packId: string) {
    setTermsAccepted(false);
    setConfirmPackId(packId);
  }

  async function startCheckout(packId: string) {
    if (!termsAccepted) return;
    const provider = currency === "ngn" ? "paystack" : "polar";
    setBusyPackId(packId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, packId, acceptTerms: true }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        reference?: string;
        checkoutUrl?: string;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.checkoutUrl) {
        setConfirmPackId(null);
        toast.error(
          json.error ?? "We couldn't open checkout right now. Please try again shortly.",
          "Checkout unavailable"
        );
        return;
      }
      if (json.reference) {
        try {
          window.sessionStorage.setItem("collate_pending_checkout_ref", json.reference);
        } catch {
          // Ignore restricted storage environments
        }
      }
      window.location.href = json.checkoutUrl;
    } catch {
      toast.error(
        "Could not reach the payment page. Check your connection and try again.",
        "Connection error"
      );
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
              onClick={() => setCurrency("usd")}
              aria-pressed={currency === "usd"}
              className={`min-h-[38px] sm:min-h-[34px] px-3 py-1 rounded-[5px] text-xs font-semibold transition-all cursor-pointer ${
                currency === "usd"
                  ? "bg-white text-[var(--neutral-900)] shadow-[var(--shadow-subtle)]"
                  : "text-[var(--neutral-600)] hover:text-[var(--neutral-900)]"
              }`}
            >
              USD ($)
            </button>
            <button
              type="button"
              onClick={() => setCurrency("ngn")}
              aria-pressed={currency === "ngn"}
              className={`min-h-[38px] sm:min-h-[34px] px-3 py-1 rounded-[5px] text-xs font-semibold transition-all cursor-pointer ${
                currency === "ngn"
                  ? "bg-white text-[var(--neutral-900)] shadow-[var(--shadow-subtle)]"
                  : "text-[var(--neutral-600)] hover:text-[var(--neutral-900)]"
              }`}
            >
              NGN (₦)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--neutral-200)]">
          {CREDIT_PACKS.map((pack, index) => {
            const featured = index === 1;
            const formattedPrice = formatPrice(pack);
            const buttonLabel = `Buy ${pack.credits} credits`;

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
                  onClick={() => openConfirm(pack.id)}
                >
                  {buttonLabel}
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      <ModalCard
        open={confirmPack !== null}
        onClose={() => busyPackId === null && setConfirmPackId(null)}
        eyebrow="Credit pack"
        title={confirmPack?.label ?? ""}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmPackId(null)}
              disabled={busyPackId !== null}
            >
              Cancel
            </Button>
            <Button
              onClick={() => confirmPack && void startCheckout(confirmPack.id)}
              disabled={!termsAccepted}
              loading={busyPackId !== null}
              loadingLabel="Opening checkout..."
            >
              Continue to checkout
            </Button>
          </div>
        }
      >
        {confirmPack ? (
          <div className="space-y-5">
            <dl className="divide-y divide-[var(--neutral-200)] border-b border-[var(--neutral-200)] text-sm">
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-[var(--neutral-600)]">Credits</dt>
                <dd className="text-[var(--neutral-900)] tabular-nums">{confirmPack.credits}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-[var(--neutral-600)]">Price</dt>
                <dd className="text-[var(--neutral-900)] tabular-nums">
                  {formatPrice(confirmPack)}
                </dd>
              </div>
            </dl>
            <TermsCheckbox id="checkout-terms" checked={termsAccepted} onChange={setTermsAccepted}>
              <CheckoutTermsText />
            </TermsCheckbox>
          </div>
        ) : null}
      </ModalCard>

      {/* Tabular Credit History Ledger */}
      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--neutral-200)]">
          <h2 className="text-lg font-medium text-[var(--neutral-900)]">Credit history</h2>
        </div>

        {recentLedger.length === 0 ? (
          <div className="px-6 py-8 text-sm text-[var(--neutral-600)]">
            No credit activity yet. Purchases, completed chapters, and refunds will appear here.
          </div>
        ) : (
          <>
            <div className="hidden sm:grid sm:grid-cols-12 gap-4 px-6 py-2.5 bg-[var(--neutral-50)] border-b border-[var(--neutral-200)] text-[11px] font-semibold uppercase tracking-wider text-[var(--neutral-500)]">
              <div className="col-span-6">Activity</div>
              <div className="col-span-2">Date</div>
              <div className="col-span-2 text-right">Change</div>
              <div className="col-span-2 text-right">Balance</div>
            </div>
            <ul className="divide-y divide-[var(--neutral-200)] list-none p-0">
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
