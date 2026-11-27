import type { BroadcastKind, InboxMailbox } from "@/db/schema";

/**
 * Which address belongs to which inbox tab. Set in wrangler.jsonc:
 * EMAIL_SUPPORT_ADDRESS, EMAIL_BILLING_ADDRESS, EMAIL_DISPUTES_ADDRESS, EMAIL_GENERAL_ADDRESS
 * (incoming mail lands in the matching tab), EMAIL_ANNOUNCEMENTS_ADDRESS and
 * EMAIL_PROMOTIONS_ADDRESS (senders for bulk mail).
 */
export interface MailboxConfig {
  support: string;
  billing: string;
  disputes: string;
  general: string;
  announcements: string;
  promotions: string;
}

export const MAILBOX_LABELS: Record<InboxMailbox, string> = {
  support: "Support",
  billing: "Billing",
  disputes: "Disputes",
  general: "General inquiries",
};

const SENDER_NAMES: Record<InboxMailbox | BroadcastKind, string> = {
  support: "Collate",
  billing: "Collate",
  disputes: "Collate",
  general: "Collate",
  announcement: "Collate",
  promotion: "Collate",
};

export function readMailboxConfig(env: Record<string, unknown>): MailboxConfig {
  const get = (key: string, fallback: string) => {
    const v = env[key];
    return (typeof v === "string" && v.trim() ? v.trim() : fallback).toLowerCase();
  };
  return {
    support: get("EMAIL_SUPPORT_ADDRESS", "support@collateresearch.app"),
    billing: get("EMAIL_BILLING_ADDRESS", "billing@collateresearch.app"),
    disputes: get("EMAIL_DISPUTES_ADDRESS", "disputes@collateresearch.app"),
    general: get("EMAIL_GENERAL_ADDRESS", "hello@collateresearch.app"),
    announcements: get("EMAIL_ANNOUNCEMENTS_ADDRESS", "news@collateresearch.app"),
    promotions: get("EMAIL_PROMOTIONS_ADDRESS", "offers@collateresearch.app"),
  };
}

/** The inbox tab for an incoming message's recipient; anything unrecognised goes to General. */
export function mailboxForRecipient(to: string, config: MailboxConfig): InboxMailbox {
  const address = to.trim().toLowerCase();
  if (address === config.support) return "support";
  if (address === config.billing) return "billing";
  if (address === config.disputes) return "disputes";
  return "general";
}

export function senderFor(mailbox: InboxMailbox | BroadcastKind, config: MailboxConfig): string {
  const address =
    mailbox === "announcement"
      ? config.announcements
      : mailbox === "promotion"
        ? config.promotions
        : config[mailbox];
  return `${SENDER_NAMES[mailbox]} <${address}>`;
}
