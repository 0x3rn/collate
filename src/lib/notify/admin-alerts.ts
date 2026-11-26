import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { adminAlerts, jobsLog } from "@/db/schema";
import { logEvent } from "@/lib/observability/logger";

/**
 * Telegram alerts for the site owner: payments, new sign-ups and daily AI spend thresholds.
 *
 * Alerts are best effort. They never throw and never block the request or AI job that triggered
 * them: a Telegram outage only means a missed message, logged for diagnosis.
 *
 * Settings (Cloudflare Worker secrets / vars):
 * - TELEGRAM_BOT_TOKEN: the bot token from @BotFather (secret).
 * - TELEGRAM_CHAT_ID: the chat that receives alerts (your own chat with the bot).
 * - AI_SPEND_ALERT_THRESHOLDS_USD: optional comma-separated daily thresholds, e.g. "5,10,25".
 */

export interface AdminAlertEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  AI_SPEND_ALERT_THRESHOLDS_USD?: string;
}

export interface AdminNotifier {
  /** Sends one message. Resolves true when Telegram accepted it, false otherwise; never throws. */
  send(text: string): Promise<boolean>;
}

const TELEGRAM_TIMEOUT_MS = 4000;
const TELEGRAM_MAX_LENGTH = 4000;

export const DEFAULT_AI_SPEND_ALERT_THRESHOLDS_USD = [5, 10, 25, 50, 100, 200] as const;

/** Returns null when the bot is not configured, so callers can skip alert work entirely. */
export function createTelegramNotifier(
  env: AdminAlertEnv,
  fetchFn: typeof fetch = globalThis.fetch
): AdminNotifier | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return null;

  return {
    async send(text: string): Promise<boolean> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
      try {
        const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: text.slice(0, TELEGRAM_MAX_LENGTH),
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          // Telegram's error text never contains the token, but the URL does: log status only.
          logEvent("warn", "admin_alert.telegram_rejected", { data: { status: res.status } });
          return false;
        }
        return true;
      } catch (err) {
        logEvent("warn", "admin_alert.telegram_failed", {
          data: { reason: err instanceof Error ? err.name : "unknown" },
        });
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Escapes text for Telegram's HTML parse mode. */
export function escapeTelegramHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** "student@uni.edu.ng" -> "st***@uni.edu.ng": enough to recognise a customer without exposing the full address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}***${email.slice(at)}`;
}

export function buildPaymentAlert(params: {
  amountFormatted: string;
  creditsAdded: number;
  provider: string;
  customerName?: string | null;
  customerEmail?: string | null;
}): string {
  const who = [
    params.customerName ? escapeTelegramHtml(params.customerName) : null,
    params.customerEmail ? `(${escapeTelegramHtml(maskEmail(params.customerEmail))})` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const provider = params.provider.charAt(0).toUpperCase() + params.provider.slice(1);
  return [
    `💳 <b>Payment received: ${escapeTelegramHtml(params.amountFormatted)}</b>`,
    `${params.creditsAdded} credits via ${escapeTelegramHtml(provider)}`,
    who ? `Customer: ${who}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSignupAlert(params: {
  name: string;
  email: string;
  totalUsers?: number;
}): string {
  return [
    `👤 <b>New sign-up</b>`,
    `${escapeTelegramHtml(params.name)} (${escapeTelegramHtml(maskEmail(params.email))})`,
    "Email not verified yet.",
    typeof params.totalUsers === "number" ? `Total accounts: ${params.totalUsers}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildAiSpendAlert(params: {
  thresholdUsd: number;
  totalUsd: number;
  day: string;
}): string {
  return [
    `⚠️ <b>AI spend passed $${params.thresholdUsd} today</b>`,
    `Total so far: $${params.totalUsd.toFixed(2)} (${params.day}, UTC)`,
  ].join("\n");
}

/** Parses "5, 10,25" into sorted positive thresholds; falls back to the defaults when empty or invalid. */
export function parseSpendThresholds(raw: string | undefined): number[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const values = parsed.length > 0 ? parsed : [...DEFAULT_AI_SPEND_ALERT_THRESHOLDS_USD];
  return [...new Set(values)].sort((a, b) => a - b);
}

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Sends one alert when today's (UTC) AI spend passes a threshold for the first time. Each
 * threshold is claimed in admin_alerts before sending, so concurrent AI calls cannot send the
 * same alert twice; if Telegram fails, the claim is released so the next AI call retries.
 * Several thresholds passed at once produce a single message for the highest.
 */
export async function alertOnAiSpendThresholds(
  db: AppDb,
  notifier: AdminNotifier | null,
  options: { now?: Date; thresholdsUsd?: number[] } = {}
): Promise<{ sentForThresholdUsd: number | null }> {
  if (!notifier) return { sentForThresholdUsd: null };
  try {
    const now = options.now ?? new Date();
    const thresholds = options.thresholdsUsd ?? [...DEFAULT_AI_SPEND_ALERT_THRESHOLDS_USD];
    const dayStart = utcDayStart(now);
    const day = dayStart.toISOString().slice(0, 10);

    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${jobsLog.costEstimateUsd}), 0)` })
      .from(jobsLog)
      .where(gte(jobsLog.createdAt, dayStart));
    const totalUsd = Number(row?.total ?? 0);

    const passed = thresholds.filter((t) => totalUsd >= t);
    if (passed.length === 0) return { sentForThresholdUsd: null };

    const keys = passed.map((t) => `ai_spend:${day}:${t}`);
    const already = await db
      .select({ key: adminAlerts.key })
      .from(adminAlerts)
      .where(inArray(adminAlerts.key, keys));
    const alreadySent = new Set(already.map((r) => r.key));

    const claimed: Array<{ key: string; threshold: number }> = [];
    for (const [i, threshold] of passed.entries()) {
      const key = keys[i]!;
      if (alreadySent.has(key)) continue;
      const inserted = await db
        .insert(adminAlerts)
        .values({ key, createdAt: now })
        .onConflictDoNothing()
        .returning({ key: adminAlerts.key });
      if (inserted.length > 0) claimed.push({ key, threshold });
    }
    if (claimed.length === 0) return { sentForThresholdUsd: null };

    const highest = Math.max(...claimed.map((c) => c.threshold));
    const sent = await notifier.send(buildAiSpendAlert({ thresholdUsd: highest, totalUsd, day }));
    if (!sent) {
      await db.delete(adminAlerts).where(
        and(
          inArray(
            adminAlerts.key,
            claimed.map((c) => c.key)
          ),
          eq(adminAlerts.createdAt, now)
        )
      );
      return { sentForThresholdUsd: null };
    }
    return { sentForThresholdUsd: highest };
  } catch (err) {
    logEvent("warn", "admin_alert.ai_spend_check_failed", {
      data: { reason: err instanceof Error ? err.message : String(err) },
    });
    return { sentForThresholdUsd: null };
  }
}
