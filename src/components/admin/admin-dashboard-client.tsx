"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";

export interface AdminOverviewProps {
  circuitBreaker: {
    allowed: boolean;
    reason?: string;
    globalDailySpendUsd: number;
    globalKillSwitchActive: boolean;
  };
  allTimeLlmCostUsd: number;
  users: Array<{ id: string; email: string; name: string; creditsBalance: number }>;
  recentJobs: Array<{
    id: string;
    step: string;
    model: string;
    status: string;
    costEstimateUsd: number;
    error: string | null;
    createdAt: string;
  }>;
  recentPayments: Array<{
    id: string;
    userId: string;
    provider: string;
    providerReference: string;
    currency: string;
    amountMinor: number;
    creditsGranted: number;
    status: string;
  }>;
}

export function AdminDashboardClient({ initial }: { initial: AdminOverviewProps }) {
  const router = useRouter();
  const [targetUserId, setTargetUserId] = useState(initial.users[0]?.id ?? "");
  const [refundCredits, setRefundCredits] = useState("10");
  const [refundReason, setRefundReason] = useState("");
  const [breakerReason, setBreakerReason] = useState("Manual operational pause");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function toggleCircuitBreaker(paused: boolean) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/circuit-breaker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused, reason: breakerReason.trim() || "Admin toggle" }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not update circuit breaker.");
        return;
      }
      setNotice(
        paused ? "Global AI circuit breaker paused." : "Global AI circuit breaker resumed."
      );
      router.refresh();
    } catch {
      setError("Network error updating circuit breaker.");
    } finally {
      setBusy(false);
    }
  }

  async function handleManualRefund(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const creditsNum = Number(refundCredits);
    if (!targetUserId || !Number.isInteger(creditsNum) || creditsNum < 1) {
      setError("Choose a user and enter a valid positive credit amount.");
      return;
    }
    if (refundReason.trim().length < 5) {
      setError("Provide a short reason (at least 5 characters) for the audit log.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/refund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetUserId,
          credits: creditsNum,
          reason: refundReason.trim(),
        }),
      });
      const json = (await res.json()) as { ok: boolean; balanceAfter?: number; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Manual refund failed.");
        return;
      }
      setRefundReason("");
      setNotice(`Granted ${creditsNum} credits. Updated balance: ${json.balanceAfter ?? "—"}.`);
      router.refresh();
    } catch {
      setError("Network error while issuing manual refund.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)]">
          <p className="text-xs text-[var(--neutral-600)] m-0">24h global AI spend</p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--neutral-900)] mt-1 m-0">
            ${initial.circuitBreaker.globalDailySpendUsd.toFixed(4)}
          </p>
        </div>
        <div className="p-5 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)]">
          <p className="text-xs text-[var(--neutral-600)] m-0">All-time logged AI spend</p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--neutral-900)] mt-1 m-0">
            ${initial.allTimeLlmCostUsd.toFixed(4)}
          </p>
        </div>
        <div className="p-5 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)]">
          <p className="text-xs text-[var(--neutral-600)] m-0">Circuit breaker status</p>
          <p
            className={`text-2xl font-semibold mt-1 m-0 ${
              initial.circuitBreaker.allowed
                ? "text-[var(--success-text)]"
                : "text-[var(--error-text)]"
            }`}
          >
            {initial.circuitBreaker.allowed ? "Open (active)" : "Paused"}
          </p>
        </div>
      </div>

      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-4">
        <h2 className="text-xl font-medium m-0">Global AI circuit breaker</h2>
        <FormField
          id="breaker-reason"
          label="Operational note"
          type="text"
          value={breakerReason}
          onChange={(e) => setBreakerReason(e.target.value)}
        />
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => toggleCircuitBreaker(true)}
          >
            Pause all AI jobs
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => toggleCircuitBreaker(false)}
          >
            Resume AI jobs
          </Button>
        </div>
      </section>

      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-4">
        <h2 className="text-xl font-medium m-0">Manual credit refund / adjustment</h2>
        <form onSubmit={handleManualRefund} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="refund-user"
                className="block text-sm font-medium text-[var(--neutral-800)]"
              >
                User
              </label>
              <select
                id="refund-user"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="block w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
              >
                {initial.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email} ({u.creditsBalance} credits)
                  </option>
                ))}
              </select>
            </div>
            <FormField
              id="refund-credits"
              label="Credits to grant"
              type="number"
              min={1}
              max={1000}
              value={refundCredits}
              onChange={(e) => setRefundCredits(e.target.value)}
            />
          </div>
          <FormField
            id="refund-reason"
            label="Audit reason"
            type="text"
            placeholder="e.g. Refund for failed chapter run"
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
          />
          <Button type="submit" loading={busy} loadingLabel="Applying refund...">
            Issue manual refund
          </Button>
        </form>
      </section>

      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-3">
        <h2 className="text-xl font-medium m-0">Recent AI jobs ({initial.recentJobs.length})</h2>
        <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0 text-xs tabular-nums">
          {initial.recentJobs.map((j) => (
            <li
              key={j.id}
              className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1"
            >
              <span>
                <strong>{j.step}</strong> ({j.model}) ·{" "}
                <span
                  className={
                    j.status === "failed"
                      ? "text-[var(--error-text)] font-semibold"
                      : "text-[var(--neutral-700)]"
                  }
                >
                  {j.status}
                </span>
                {j.error ? ` — ${j.error.slice(0, 90)}` : ""}
              </span>
              <span className="text-[var(--neutral-600)]">${j.costEstimateUsd.toFixed(5)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-3">
        <h2 className="text-xl font-medium m-0">
          Recent payments ({initial.recentPayments.length})
        </h2>
        <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0 text-xs tabular-nums">
          {initial.recentPayments.map((p) => (
            <li key={p.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>{p.provider.toUpperCase()}</strong> {p.providerReference} · {p.status}
              </span>
              <span>
                {p.currency} {(p.amountMinor / 100).toFixed(2)} ({p.creditsGranted} credits)
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
