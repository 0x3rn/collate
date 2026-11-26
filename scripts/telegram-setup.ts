/**
 * Helps connect the owner alert bot.
 *
 * 1. Put TELEGRAM_BOT_TOKEN=<token from @BotFather> in .dev.vars, then send your bot any message
 *    in Telegram (for example "hi").
 * 2. Find your chat id:
 *      pnpm exec tsx scripts/telegram-setup.ts
 * 3. Put TELEGRAM_CHAT_ID=<that id> in .dev.vars and send yourself a test alert:
 *      pnpm exec tsx scripts/telegram-setup.ts --send-test
 *
 * The token is read from the environment or .dev.vars and never printed.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTelegramNotifier } from "../src/lib/notify/admin-alerts";

function readDevVars(): Record<string, string> {
  const path = resolve(".dev.vars");
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) vars[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return vars;
}

const devVars = readDevVars();
const setting = (key: string) => process.env[key]?.trim() || devVars[key]?.trim() || "";
const token = setting("TELEGRAM_BOT_TOKEN");

async function main() {
  if (!token) {
    throw new Error("Set TELEGRAM_BOT_TOKEN in .dev.vars (or the environment) first.");
  }

  if (process.argv.includes("--send-test")) {
    const notifier = createTelegramNotifier({
      TELEGRAM_BOT_TOKEN: token,
      TELEGRAM_CHAT_ID: setting("TELEGRAM_CHAT_ID"),
    });
    if (!notifier) throw new Error("Set TELEGRAM_CHAT_ID in .dev.vars first.");
    const ok = await notifier.send("✅ <b>Collate alerts are connected.</b>");
    console.log(ok ? "Test message sent. Check Telegram." : "Telegram rejected the message.");
    process.exitCode = ok ? 0 : 1;
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  if (!res.ok) throw new Error(`Telegram returned HTTP ${res.status}. Check the bot token.`);
  const body = (await res.json()) as {
    result?: Array<{
      message?: { chat?: { id: number; type: string; first_name?: string; title?: string } };
    }>;
  };
  const chats = new Map<number, string>();
  for (const update of body.result ?? []) {
    const chat = update.message?.chat;
    if (chat) chats.set(chat.id, `${chat.type}: ${chat.title ?? chat.first_name ?? ""}`.trim());
  }
  if (chats.size === 0) {
    console.log("No messages yet. Send your bot a message in Telegram, then run this again.");
    return;
  }
  for (const [id, label] of chats) console.log(`TELEGRAM_CHAT_ID=${id}   (${label})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
