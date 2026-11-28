import { and, desc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { AppDb } from "@/db/client";
import { paymentReversals, payments, retainedBillingRecords, users } from "@/db/schema";
import { listReversalsForPayments } from "./reversals";

/** One payment row for the admin list. */
export interface AdminPaymentRow {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  provider: string;
  providerReference: string;
  currency: string;
  amountMinor: number;
  creditsGranted: number;
  status: string;
  createdAt: string;
  openDispute: boolean;
  /** The customer deleted their account; this is the record kept afterwards. */
  accountDeleted: boolean;
}

export const ADMIN_PAYMENTS_LIMIT = 200;

/** Case-insensitive "contains", with %, _ and \ in the search treated as plain text. */
function contains(column: AnySQLiteColumn, q: string): SQL {
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`lower(${column}) LIKE lower(${pattern}) ESCAPE '\\'`;
}

/**
 * Newest payments, or every payment matching a search (customer email or name, payment
 * reference, Polar order id, or our payment id) however old it is.
 */
export async function loadAdminPayments(
  db: AppDb,
  options: { query?: string; limit?: number } = {}
): Promise<AdminPaymentRow[]> {
  const q = options.query?.trim() ?? "";
  const limit = options.limit ?? ADMIN_PAYMENTS_LIMIT;
  const base = db
    .select({ payment: payments, userEmail: users.email, userName: users.name })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.userId));
  const rows = q
    ? await base
        .where(
          or(
            contains(users.email, q),
            contains(users.name, q),
            contains(payments.providerReference, q),
            contains(payments.providerOrderId, q),
            eq(payments.id, q)
          )
        )
        .orderBy(desc(payments.createdAt))
        .limit(limit)
    : await base.orderBy(desc(payments.createdAt)).limit(limit);

  const reversals = await listReversalsForPayments(
    db,
    rows.map((r) => r.payment.id)
  );
  const open = new Set(
    reversals.filter((r) => r.kind === "dispute" && !r.resolvedAt).map((r) => r.paymentId)
  );
  const live = rows.map(({ payment: p, userEmail, userName }) => ({
    accountDeleted: false,
    id: p.id,
    userId: p.userId,
    userEmail,
    userName,
    provider: p.provider,
    providerReference: p.providerReference,
    currency: p.currency,
    amountMinor: p.amountMinor,
    creditsGranted: p.creditsGranted,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    openDispute: open.has(p.id),
  }));

  // Payments of deleted accounts, from the records kept for them.
  const keptBase = db.select().from(retainedBillingRecords);
  const keptRows = q
    ? await keptBase
        .where(
          or(
            contains(retainedBillingRecords.customerEmail, q),
            contains(retainedBillingRecords.customerName, q),
            contains(retainedBillingRecords.providerReference, q),
            contains(retainedBillingRecords.providerOrderId, q),
            eq(retainedBillingRecords.paymentId, q)
          )
        )
        .orderBy(desc(retainedBillingRecords.paidAt))
        .limit(limit)
    : await keptBase.orderBy(desc(retainedBillingRecords.paidAt)).limit(limit);
  const liveIds = new Set(live.map((p) => p.id));
  const kept = keptRows
    .filter((k) => !liveIds.has(k.paymentId))
    .map((k) => ({
      accountDeleted: true,
      id: k.paymentId,
      userId: k.userId,
      userEmail: k.customerEmail,
      userName: k.customerName,
      provider: k.provider,
      providerReference: k.providerReference,
      currency: k.currency,
      amountMinor: k.amountMinor,
      creditsGranted: k.credits,
      status: k.status,
      createdAt: k.paidAt.toISOString(),
      openDispute: k.openDispute,
    }));

  return [...live, ...kept].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

/** Count of payments with a dispute still open (shown as a warning on the admin page). */
export async function countOpenDisputes(db: AppDb): Promise<number> {
  const rows = await db
    .select({ id: paymentReversals.id })
    .from(paymentReversals)
    .where(and(eq(paymentReversals.kind, "dispute"), isNull(paymentReversals.resolvedAt)));
  return rows.length;
}
