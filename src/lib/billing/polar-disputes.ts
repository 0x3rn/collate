import { z } from "zod";
import type { AppDb } from "@/db/client";
import type { AdminNotifier } from "@/lib/notify/admin-alerts";
import { logEvent } from "@/lib/observability/logger";
import { applyPaymentReversal, type ReversalEvent, resolveDispute } from "./reversals";

/**
 * Polar sends no webhook for disputes (chargebacks), so the Worker checks Polar's dispute list
 * on a schedule. Open disputes take credits back and hold the account; won ones give the
 * credits back; lost and "prevented" ones (Polar refunded to stop the chargeback) keep them off.
 */

const DisputeSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: z.number().int().nonnegative(),
  tax_amount: z.number().int().nonnegative().nullish(),
  currency: z.string(),
  reason: z.string().nullish(),
  evidence_due_by: z.string().nullish(),
  order_id: z.string().nullish(),
});
const PageSchema = z.object({
  items: z.array(z.unknown()),
  pagination: z.object({ max_page: z.number().int() }).partial().optional(),
});

const OPEN = new Set(["early_warning", "needs_response", "under_review"]);
const MAX_PAGES = 10;

export interface PolarDisputeSyncResult {
  ok: boolean;
  checked: number;
  opened: number;
  resolved: number;
  error?: string;
}

export async function syncPolarDisputes(
  db: AppDb,
  deps: {
    accessToken?: string;
    apiBase: string;
    fetchFn?: typeof fetch;
    notifier?: AdminNotifier | null;
    now?: Date;
  }
): Promise<PolarDisputeSyncResult> {
  const token = deps.accessToken?.trim();
  if (!token) return { ok: false, checked: 0, opened: 0, resolved: 0, error: "no_token" };
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const ctx = { now: deps.now, notifier: deps.notifier };
  const result: PolarDisputeSyncResult = { ok: true, checked: 0, opened: 0, resolved: 0 };

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchFn(`${deps.apiBase}/v1/disputes/?limit=100&page=${page}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!res.ok) {
      logEvent("error", "billing.polar_dispute_sync_failed", { data: { status: res.status } });
      return { ...result, ok: false, error: `http_${res.status}` };
    }
    const body = PageSchema.safeParse(await res.json().catch(() => null));
    if (!body.success) return { ...result, ok: false, error: "bad_response" };

    for (const raw of body.data.items) {
      const parsed = DisputeSchema.safeParse(raw);
      if (!parsed.success || !parsed.data.order_id) continue;
      const d = parsed.data;
      result.checked++;
      const due = d.evidence_due_by ? new Date(d.evidence_due_by) : null;
      const event: ReversalEvent = {
        provider: "polar",
        kind: "dispute",
        providerReversalId: d.id,
        payment: { providerOrderId: d.order_id },
        amountMinor: d.amount + (d.tax_amount ?? 0),
        currency: d.currency,
        status: d.status,
        reason: d.reason ?? null,
        dueAt: due && !Number.isNaN(due.getTime()) ? due : null,
      };
      if (event.amountMinor <= 0) continue;

      if (OPEN.has(d.status)) {
        const r = await applyPaymentReversal(db, event, ctx);
        if (r.outcome === "applied") result.opened++;
      } else if (d.status === "won") {
        const r = await resolveDispute(
          db,
          { provider: "polar", providerDisputeId: d.id, result: "won", status: d.status },
          ctx
        );
        if (r.outcome === "resolved") result.resolved++;
      } else if (d.status === "lost" || d.status === "prevented") {
        await applyPaymentReversal(db, event, ctx);
        const r = await resolveDispute(
          db,
          { provider: "polar", providerDisputeId: d.id, result: "lost", status: d.status },
          ctx
        );
        if (r.outcome === "resolved") result.resolved++;
      }
    }

    const maxPage = body.data.pagination?.max_page ?? 1;
    if (page >= maxPage || body.data.items.length === 0) break;
  }
  return result;
}
