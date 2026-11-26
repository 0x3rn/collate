import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { users } from "@/db/schema";
import { grantPaymentCreditsIdempotent } from "@/lib/billing/ledger";
import { syncPolarDisputes } from "@/lib/billing/polar-disputes";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Polar dispute check", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let disputes: Array<Record<string, unknown>>;
  let requests: string[];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    requests.push(`${url} ${(init?.headers as Record<string, string>).authorization}`);
    return Response.json({
      items: disputes,
      pagination: { total_count: disputes.length, max_page: 1 },
    });
  }) as typeof fetch;

  beforeEach(async () => {
    d1 = createInMemoryD1();
    d1.applyMigrations();
    db = createDb(d1.d1);
    disputes = [];
    requests = [];
    const now = new Date("2026-11-26T10:00:00Z");
    await db.insert(users).values({
      id: "usr_bo",
      email: "bo@uni.edu.ng",
      emailVerified: true,
      name: "Bo",
      createdAt: now,
      updatedAt: now,
    });
    await grantPaymentCreditsIdempotent(
      db,
      {
        provider: "polar",
        providerReference: "chk_9",
        providerOrderId: "ord_9",
        userId: "usr_bo",
        currency: "USD",
        amountMinor: 3000,
        creditsGranted: 100,
        eventType: "order.paid",
      },
      "{}",
      now
    );
  });
  afterEach(() => d1.close());

  const user = async () => (await db.select().from(users).where(eq(users.id, "usr_bo")))[0]!;
  const dispute = (status: string) => ({
    id: "dsp_9",
    status,
    amount: 2800,
    tax_amount: 200,
    currency: "usd",
    reason: "product_not_received",
    evidence_due_by: "2026-12-03T00:00:00Z",
    order_id: "ord_9",
  });
  const run = () =>
    syncPolarDisputes(db, { accessToken: "polar_tok", apiBase: "https://api.polar.sh", fetchFn });

  it("needs a token", async () => {
    expect(await syncPolarDisputes(db, { apiBase: "x", fetchFn })).toMatchObject({
      ok: false,
      error: "no_token",
    });
  });

  it("holds the account when a dispute opens, once, and restores it when won", async () => {
    disputes = [dispute("needs_response")];
    expect(await run()).toMatchObject({ ok: true, checked: 1, opened: 1 });
    expect(requests[0]).toBe("https://api.polar.sh/v1/disputes/?limit=100&page=1 Bearer polar_tok");
    let u = await user();
    expect(u.creditsBalance).toBe(0);
    expect(u.billingHoldReason).not.toBeNull();

    disputes = [dispute("under_review")];
    expect(await run()).toMatchObject({ opened: 0 });

    disputes = [dispute("won")];
    expect(await run()).toMatchObject({ resolved: 1 });
    u = await user();
    expect(u.creditsBalance).toBe(100);
    expect(u.billingHoldReason).toBeNull();
    expect(await run()).toMatchObject({ resolved: 0 });
  });

  it("keeps credits off for lost or prevented disputes", async () => {
    disputes = [dispute("prevented")];
    expect(await run()).toMatchObject({ resolved: 1 });
    const u = await user();
    expect(u.creditsBalance).toBe(0);
    expect(u.billingHoldReason).not.toBeNull();
  });

  it("reports an error instead of guessing when Polar refuses", async () => {
    const denied = (async () =>
      new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
    expect(
      await syncPolarDisputes(db, {
        accessToken: "t",
        apiBase: "https://api.polar.sh",
        fetchFn: denied,
      })
    ).toMatchObject({ ok: false, error: "http_403" });
  });
});
