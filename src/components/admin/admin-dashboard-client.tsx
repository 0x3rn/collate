"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { FormField } from "@/components/ui/field";
import { ModalCard } from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";

export interface AdminOverviewProps {
  circuitBreaker: {
    allowed: boolean;
    reason?: string;
    globalDailySpendUsd: number;
    globalKillSwitchActive: boolean;
  };
  allTimeLlmCostUsd: number;
  totalUsersCount: number;
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

interface BatchProgressState {
  campaignId: string;
  mode: "all" | "random_sample";
  creditsPerUser: number;
  reason: string;
  targetCount: number;
  creditedSoFar: number;
  skippedSoFar: number;
  batchesCompleted: number;
  nextCursorUserId: string | null;
  running: boolean;
  pausedOrErrored: boolean;
  errorMessage?: string;
}

export function AdminDashboardClient({ initial }: { initial: AdminOverviewProps }) {
  const router = useRouter();
  const toast = useToast();
  const [targetUserId, setTargetUserId] = useState(initial.users[0]?.id ?? "");
  const [refundCredits, setRefundCredits] = useState("10");
  const [refundReason, setRefundReason] = useState("");
  const [breakerReason, setBreakerReason] = useState("Manual operational pause");
  const [busy, setBusy] = useState(false);

  // Master batch-credit state (scales cleanly to 100k+ users via cursor-paginated 50-user batches)
  const [batchMode, setBatchMode] = useState<"all" | "random_sample">("all");
  const [batchCredits, setBatchCredits] = useState("10");
  const [batchSampleCount, setBatchSampleCount] = useState("25");
  const [batchReason, setBatchReason] = useState("");
  const [confirmBatchOpen, setConfirmBatchOpen] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgressState | null>(null);
  const stopBatchRef = useRef(false);

  async function toggleCircuitBreaker(paused: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/circuit-breaker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused, reason: breakerReason.trim() || "Admin toggle" }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? "Could not update circuit breaker.", "Circuit breaker error");
        return;
      }
      toast.success(
        paused ? "Global circuit breaker paused." : "Global circuit breaker resumed.",
        paused ? "Drafting paused" : "Drafting resumed"
      );
      router.refresh();
    } catch {
      toast.error("Network error updating circuit breaker.", "Connection error");
    } finally {
      setBusy(false);
    }
  }

  function handleOpenBatchConfirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const creditsNum = Number(batchCredits);
    if (!Number.isInteger(creditsNum) || creditsNum < 1 || creditsNum > 500) {
      toast.error("Enter a valid credit amount between 1 and 500.", "Invalid credit amount");
      return;
    }
    if (batchMode === "random_sample") {
      const sampleNum = Number(batchSampleCount);
      if (!Number.isInteger(sampleNum) || sampleNum < 1 || sampleNum > 100_000) {
        toast.error("Enter a valid random user count between 1 and 100,000.", "Invalid user count");
        return;
      }
    }
    if (batchReason.trim().length < 5) {
      toast.error(
        "Provide a short reason (at least 5 characters) for the audit log.",
        "Reason required"
      );
      return;
    }
    if (initial.totalUsersCount === 0) {
      toast.error("There are no registered users to credit yet.", "No users found");
      return;
    }
    setConfirmBatchOpen(true);
  }

  async function executeBatchLoop(seedState: BatchProgressState) {
    stopBatchRef.current = false;
    setConfirmBatchOpen(false);
    let state: BatchProgressState = {
      ...seedState,
      running: true,
      pausedOrErrored: false,
      errorMessage: undefined,
    };
    setBatchProgress(state);

    try {
      for (;;) {
        if (stopBatchRef.current) {
          state = { ...state, running: false, pausedOrErrored: true };
          setBatchProgress(state);
          toast.info(
            `Paused after ${state.batchesCompleted} batch${state.batchesCompleted === 1 ? "" : "es"} (${state.creditedSoFar.toLocaleString("en-US")} users credited). Click Resume to continue safely.`,
            "Batch grant paused"
          );
          router.refresh();
          return;
        }

        const remainingTarget =
          state.mode === "random_sample"
            ? Math.max(0, state.targetCount - state.creditedSoFar)
            : undefined;

        if (state.mode === "random_sample" && (remainingTarget ?? 0) <= 0) {
          break;
        }

        const res = await fetch("/api/admin/credit-batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            campaignId: state.campaignId,
            credits: state.creditsPerUser,
            reason: state.reason,
            mode: state.mode,
            batchSize: 50,
            ...(state.mode === "all" ? { cursorUserId: state.nextCursorUserId } : {}),
            ...(remainingTarget !== undefined ? { remainingTargetCount: remainingTarget } : {}),
          }),
        });

        const data = (await res.json()) as {
          ok: boolean;
          creditedInBatch?: number;
          skippedInBatch?: number;
          totalUsers?: number;
          nextCursorUserId?: string | null;
          done?: boolean;
          error?: string;
        };

        if (!res.ok || !data.ok) {
          state = {
            ...state,
            running: false,
            pausedOrErrored: true,
            errorMessage: data.error ?? "Batch credit request failed.",
          };
          setBatchProgress(state);
          toast.error(
            data.error ?? "Batch credit paused due to an error. You can safely resume.",
            "Batch grant interrupted"
          );
          return;
        }

        state = {
          ...state,
          targetCount:
            state.mode === "all" && typeof data.totalUsers === "number"
              ? data.totalUsers
              : state.targetCount,
          creditedSoFar: state.creditedSoFar + (data.creditedInBatch ?? 0),
          skippedSoFar: state.skippedSoFar + (data.skippedInBatch ?? 0),
          batchesCompleted: state.batchesCompleted + 1,
          nextCursorUserId: data.nextCursorUserId ?? null,
        };
        setBatchProgress(state);

        if (data.done) {
          break;
        }
      }

      setBatchProgress({ ...state, running: false, pausedOrErrored: false });
      setBatchReason("");
      toast.success(
        `Credited ${state.creditedSoFar.toLocaleString("en-US")} user${
          state.creditedSoFar === 1 ? "" : "s"
        } with +${state.creditsPerUser} credits each across ${state.batchesCompleted} batch${
          state.batchesCompleted === 1 ? "" : "es"
        }.`,
        "Batch credit complete"
      );
      router.refresh();
    } catch {
      setBatchProgress({
        ...state,
        running: false,
        pausedOrErrored: true,
        errorMessage: "Network error during batch execution.",
      });
      toast.error(
        "Network error interrupted the batch. Already-credited users are protected — click Resume to finish.",
        "Connection interrupted"
      );
    }
  }

  function startConfirmedBatchGrant() {
    const creditsNum = Number(batchCredits);
    const targetCount =
      batchMode === "random_sample"
        ? Math.min(initial.totalUsersCount, Number(batchSampleCount))
        : initial.totalUsersCount;
    const shortRand = Math.random().toString(36).slice(2, 8);
    const campaignId = `grant_${Date.now()}_${shortRand}`;

    void executeBatchLoop({
      campaignId,
      mode: batchMode,
      creditsPerUser: creditsNum,
      reason: batchReason.trim(),
      targetCount,
      creditedSoFar: 0,
      skippedSoFar: 0,
      batchesCompleted: 0,
      nextCursorUserId: null,
      running: true,
      pausedOrErrored: false,
    });
  }

  async function handleManualRefund(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const creditsNum = Number(refundCredits);
    if (!targetUserId || !Number.isInteger(creditsNum) || creditsNum < 1) {
      toast.error("Choose a user and enter a valid positive credit amount.", "Invalid amount");
      return;
    }
    if (refundReason.trim().length < 5) {
      toast.error(
        "Provide a short reason (at least 5 characters) for the audit log.",
        "Reason required"
      );
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
        toast.error(json.error ?? "Manual refund failed.", "Refund failed");
        return;
      }
      setRefundReason("");
      toast.success(
        `Granted ${creditsNum.toLocaleString("en-US")} credits. Updated balance: ${
          typeof json.balanceAfter === "number" ? json.balanceAfter.toLocaleString("en-US") : "—"
        }.`,
        "Credits granted"
      );
      router.refresh();
    } catch {
      toast.error("Network error while issuing manual refund.", "Connection error");
    } finally {
      setBusy(false);
    }
  }

  const previewBatchTargetCount =
    batchMode === "random_sample"
      ? Math.min(initial.totalUsersCount, Math.max(0, Number(batchSampleCount) || 0))
      : initial.totalUsersCount;
  const previewBatchCreditsNum = Math.max(0, Number(batchCredits) || 0);
  const batchPct =
    batchProgress && batchProgress.targetCount > 0
      ? Math.min(100, Math.round((batchProgress.creditedSoFar / batchProgress.targetCount) * 100))
      : 0;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)]">
          <p className="text-xs text-[var(--neutral-600)]">24h global drafting spend</p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--neutral-900)] mt-1">
            ${initial.circuitBreaker.globalDailySpendUsd.toFixed(4)}
          </p>
        </div>
        <div className="p-5 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)]">
          <p className="text-xs text-[var(--neutral-600)]">All-time logged drafting spend</p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--neutral-900)] mt-1">
            ${initial.allTimeLlmCostUsd.toFixed(4)}
          </p>
        </div>
        <div className="p-5 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)]">
          <p className="text-xs text-[var(--neutral-600)]">Circuit breaker status</p>
          <p
            className={`text-2xl font-semibold mt-1 ${
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
        <div className="space-y-1">
          <h2 className="text-xl font-medium">Global circuit breaker</h2>
          <p className="text-sm text-[var(--neutral-600)]">
            Pausing blocks all new chapter drafts, revisions, assignments, and topic checks without
            charging credits, while letting any runs already in progress finish cleanly.
          </p>
        </div>
        {!initial.circuitBreaker.allowed && initial.circuitBreaker.reason ? (
          <p className="text-xs font-medium text-[var(--error-text)] bg-[var(--error-bg)] border border-[var(--error-border)] rounded-[var(--radius-sm)] px-3.5 py-2.5">
            Active pause reason: {initial.circuitBreaker.reason}
          </p>
        ) : null}
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
            disabled={busy || !initial.circuitBreaker.allowed}
            onClick={() => toggleCircuitBreaker(true)}
          >
            Pause all drafting jobs
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || initial.circuitBreaker.allowed}
            onClick={() => toggleCircuitBreaker(false)}
          >
            Resume drafting jobs
          </Button>
        </div>
      </section>

      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-medium">Credit users in batches</h2>
          <p className="text-sm text-[var(--neutral-600)]">
            Grant credits to all registered accounts (or a random subset) in automatic 50-user
            batches for outages or promotions. Every batch is idempotent and safe to resume at
            100,000+ users.
          </p>
        </div>

        <form onSubmit={handleOpenBatchConfirm} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="batch-scope"
                className="block text-sm font-medium text-[var(--neutral-800)]"
              >
                Target users
              </label>
              <CustomSelect
                id="batch-scope"
                ariaLabel="Target users"
                value={batchMode}
                onChange={(v) => setBatchMode(v === "random_sample" ? "random_sample" : "all")}
                disabled={Boolean(batchProgress?.running)}
                options={[
                  {
                    value: "all",
                    label: `All users (${initial.totalUsersCount.toLocaleString("en-US")} accounts)`,
                    description: "Credits every user automatically in sequential 50-user batches",
                  },
                  {
                    value: "random_sample",
                    label: "Random subset of users",
                    description: "Randomly selects uncredited accounts up to your target count",
                  },
                ]}
              />
            </div>

            <FormField
              id="batch-credits"
              label="Credits per user"
              type="number"
              min={1}
              max={500}
              disabled={Boolean(batchProgress?.running)}
              value={batchCredits}
              onChange={(e) => setBatchCredits(e.target.value)}
            />
          </div>

          {batchMode === "random_sample" ? (
            <FormField
              id="batch-sample-count"
              label="Number of random users to credit"
              type="number"
              min={1}
              max={100000}
              disabled={Boolean(batchProgress?.running)}
              value={batchSampleCount}
              onChange={(e) => setBatchSampleCount(e.target.value)}
            />
          ) : null}

          <FormField
            id="batch-reason"
            label="Audit reason (outage, promo, or goodwill note)"
            type="text"
            placeholder="e.g. Service outage goodwill credit"
            disabled={Boolean(batchProgress?.running)}
            value={batchReason}
            onChange={(e) => setBatchReason(e.target.value)}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              disabled={Boolean(batchProgress?.running) || initial.totalUsersCount === 0}
              loading={Boolean(batchProgress?.running)}
              loadingLabel="Crediting batches..."
            >
              Credit users in batches
            </Button>

            {batchProgress?.running ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  stopBatchRef.current = true;
                }}
              >
                Stop after current batch
              </Button>
            ) : null}

            {batchProgress?.pausedOrErrored ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void executeBatchLoop(batchProgress)}
              >
                Resume remaining batches
              </Button>
            ) : null}
          </div>
        </form>

        {batchProgress ? (
          <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--neutral-700)] tabular-nums">
              <span className="font-medium text-[var(--neutral-900)]">
                Campaign {batchProgress.campaignId} ·{" "}
                {batchProgress.running
                  ? "Running"
                  : batchProgress.pausedOrErrored
                    ? "Paused"
                    : "Completed"}
              </span>
              <span>
                {batchProgress.creditedSoFar.toLocaleString("en-US")} /{" "}
                {batchProgress.targetCount.toLocaleString("en-US")} users ({batchPct}%) ·{" "}
                {batchProgress.batchesCompleted} batch
                {batchProgress.batchesCompleted === 1 ? "" : "es"}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-[var(--neutral-200)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent-600)] transition-all duration-200"
                style={{ width: `${batchPct}%` }}
              />
            </div>
            {batchProgress.errorMessage ? (
              <p className="text-xs text-[var(--error-text)]">{batchProgress.errorMessage}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <ModalCard
        open={confirmBatchOpen}
        onClose={() => setConfirmBatchOpen(false)}
        eyebrow="Bulk credit confirmation"
        title="Confirm batch credit grant"
        maxWidthClassName="max-w-[480px]"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setConfirmBatchOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={startConfirmedBatchGrant}>
              Confirm &amp; credit users
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
          You are about to grant{" "}
          <strong className="text-[var(--neutral-900)]">
            +{previewBatchCreditsNum.toLocaleString("en-US")} credits
          </strong>{" "}
          per account to{" "}
          <strong className="text-[var(--neutral-900)]">
            {batchMode === "random_sample"
              ? `${previewBatchTargetCount.toLocaleString("en-US")} randomly selected users`
              : `all ${previewBatchTargetCount.toLocaleString("en-US")} registered users`}
          </strong>{" "}
          (total:{" "}
          <strong className="text-[var(--neutral-900)] tabular-nums">
            {(previewBatchCreditsNum * previewBatchTargetCount).toLocaleString("en-US")} credits
          </strong>
          ).
        </p>
        <p className="text-xs text-[var(--neutral-600)]">
          Reason:{" "}
          <span className="font-medium text-[var(--neutral-800)]">{batchReason.trim()}</span>
        </p>
        <p className="text-xs text-[var(--neutral-500)]">
          Credits are applied in automatic 50-user batches with per-user idempotency keys, so no
          account can ever be credited twice for the same campaign.
        </p>
      </ModalCard>

      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-4">
        <h2 className="text-xl font-medium">Manual credit refund / adjustment</h2>
        <form onSubmit={handleManualRefund} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="refund-user"
                className="block text-sm font-medium text-[var(--neutral-800)]"
              >
                User
              </label>
              <CustomSelect
                id="refund-user"
                ariaLabel="User"
                value={targetUserId}
                onChange={setTargetUserId}
                placeholder="Select user"
                options={initial.users.map((u) => ({
                  value: u.id,
                  label: `${u.email} (${u.creditsBalance.toLocaleString("en-US")} credits)`,
                }))}
              />
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
        <h2 className="text-xl font-medium">Recent drafting jobs ({initial.recentJobs.length})</h2>
        <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 text-xs tabular-nums">
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
                {j.error ? `: ${j.error.slice(0, 90)}` : ""}
              </span>
              <span className="text-[var(--neutral-600)]">${j.costEstimateUsd.toFixed(5)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-3">
        <h2 className="text-xl font-medium">Recent payments ({initial.recentPayments.length})</h2>
        <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 text-xs tabular-nums">
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
