import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { adminAlerts, jobsLog } from "@/db/schema";
import {
  alertOnAiSpendThresholds,
  buildPaymentAlert,
  buildSignupAlert,
  createTelegramNotifier,
  escapeTelegramHtml,
  maskEmail,
  parseSpendThresholds,
  type AdminNotifier,
} from "@/lib/notify/admin-alerts";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Telegram notifier", () => {
  it("is off until both the bot token and chat id are set", () => {
    expect(createTelegramNotifier({})).toBeNull();
    expect(createTelegramNotifier({ TELEGRAM_BOT_TOKEN: "123:abc" })).toBeNull();
    expect(createTelegramNotifier({ TELEGRAM_CHAT_ID: "42" })).toBeNull();
    expect(createTelegramNotifier({ TELEGRAM_BOT_TOKEN: " ", TELEGRAM_CHAT_ID: "42" })).toBeNull();
  });

  it("posts the message to the configured chat", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const notifier = createTelegramNotifier(
      { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_ID: "42" },
      async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return Response.json({ ok: true });
      }
    )!;
    await expect(notifier.send("<b>hi</b>")).resolves.toBe(true);
    expect(calls[0]!.url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(calls[0]!.body).toEqual({
      chat_id: "42",
      text: "<b>hi</b>",
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  });

  it("reports failure without throwing when Telegram rejects or is unreachable", async () => {
    const env = { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_ID: "42" };
    const rejected = createTelegramNotifier(env, async () => new Response("no", { status: 401 }))!;
    await expect(rejected.send("x")).resolves.toBe(false);
    const offline = createTelegramNotifier(env, async () => {
      throw new TypeError("network down");
    })!;
    await expect(offline.send("x")).resolves.toBe(false);
  });
});

describe("alert messages", () => {
  it("masks emails and escapes user-supplied text", () => {
    expect(maskEmail("student@uni.edu.ng")).toBe("st***@uni.edu.ng");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
    expect(maskEmail("not-an-email")).toBe("***");
    expect(escapeTelegramHtml("<script>&")).toBe("&lt;script&gt;&amp;");
  });

  it("describes payments and sign-ups in one glance", () => {
    expect(
      buildPaymentAlert({
        amountFormatted: "₦35,000.00",
        creditsAdded: 100,
        provider: "paystack",
        customerName: "Chidi <b>",
        customerEmail: "chidi@uni.edu.ng",
      })
    ).toBe(
      "💳 <b>Payment received: ₦35,000.00</b>\n100 credits via Paystack\nCustomer: Chidi &lt;b&gt; (ch***@uni.edu.ng)"
    );
    expect(buildSignupAlert({ name: "Ada", email: "ada@x.com", totalUsers: 7 })).toBe(
      "👤 <b>New sign-up</b>\nAda (ad***@x.com)\nEmail not verified yet.\nTotal accounts: 7"
    );
  });

  it("reads custom spend thresholds and falls back to the defaults", () => {
    expect(parseSpendThresholds("25, 5,10,10, abc, -3")).toEqual([5, 10, 25]);
    expect(parseSpendThresholds("")).toEqual([5, 10, 25, 50, 100, 200]);
    expect(parseSpendThresholds(undefined)).toEqual([5, 10, 25, 50, 100, 200]);
  });
});

describe("daily AI spend alerts", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let messages: string[];
  let accept: boolean;
  const notifier: AdminNotifier = {
    send: async (text) => {
      messages.push(text);
      return accept;
    },
  };
  const now = new Date("2026-11-25T15:00:00.000Z");
  let seq = 0;

  async function spend(usd: number, at: Date = now) {
    seq += 1;
    await db.insert(jobsLog).values({
      id: `job_${seq}`,
      workflowId: "wf_1",
      step: "draft",
      provider: "google",
      model: "gemini-4-neon",
      status: "succeeded",
      costEstimateUsd: usd,
      createdAt: at,
    });
  }
  const check = () => alertOnAiSpendThresholds(db, notifier, { now, thresholdsUsd: [5, 10, 25] });

  beforeEach(() => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);
    messages = [];
    accept = true;
  });

  afterEach(() => d1Ctx.close());

  it("stays quiet below the first threshold and ignores yesterday's spend", async () => {
    await spend(30, new Date("2026-11-24T23:59:00.000Z"));
    await spend(4.99);
    await expect(check()).resolves.toEqual({ sentForThresholdUsd: null });
    expect(messages).toEqual([]);
  });

  it("sends one message for the highest threshold passed, then never repeats it", async () => {
    await spend(12.5);
    await expect(check()).resolves.toEqual({ sentForThresholdUsd: 10 });
    expect(messages).toEqual([
      "⚠️ <b>AI spend passed $10 today</b>\nTotal so far: $12.50 (2026-11-25, UTC)",
    ]);

    await spend(1);
    await expect(check()).resolves.toEqual({ sentForThresholdUsd: null });
    await spend(12);
    await expect(check()).resolves.toEqual({ sentForThresholdUsd: 25 });
    expect(messages).toHaveLength(2);
  });

  it("retries on the next AI call when Telegram fails", async () => {
    await spend(6);
    accept = false;
    await expect(check()).resolves.toEqual({ sentForThresholdUsd: null });
    expect(await db.select().from(adminAlerts)).toEqual([]);

    accept = true;
    await expect(check()).resolves.toEqual({ sentForThresholdUsd: 5 });
    expect(messages).toHaveLength(2);
  });

  it("does nothing at all when the bot is not configured", async () => {
    await spend(100);
    await expect(alertOnAiSpendThresholds(db, null, { now })).resolves.toEqual({
      sentForThresholdUsd: null,
    });
    expect(await db.select().from(adminAlerts)).toEqual([]);
  });
});
