import { z } from "zod";
import type { ReversalEvent } from "./reversals";
import { BILLING_POLICY, findCreditPack } from "@/config/pricing";
import type { PaymentProvider } from "@/db/schema";
import { timingSafeEqualString } from "@/lib/security/internal-auth";

function toArrayBuffer(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const buf = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buf).set(encoded);
  return buf;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function tryDecodeBase64(input: string): Uint8Array | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    return null;
  }
  try {
    const padded = trimmed.padEnd(Math.ceil(trimmed.length / 4) * 4, "=");
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

export async function computeHmacHex(
  algorithm: "SHA-256" | "SHA-512",
  secret: string,
  payload: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(secret),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, toArrayBuffer(payload));
  return toHex(new Uint8Array(sig));
}

export async function computeHmacBase64(
  algorithm: "SHA-256" | "SHA-512",
  secretKeyBytes: Uint8Array,
  payload: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    bytesToArrayBuffer(secretKeyBytes),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, toArrayBuffer(payload));
  return toBase64(new Uint8Array(sig));
}

export interface NormalizedPaymentWebhook {
  provider: PaymentProvider;
  providerReference: string;
  /** Polar order id, which later refunds and disputes point at. */
  providerOrderId?: string;
  userId: string;
  currency: string;
  amountMinor: number;
  subtotalAmountMinor?: number;
  productId?: string;
  creditsGranted: number;
  eventType: string;
}

const PaystackEventSchema = z.object({
  event: z.string(),
  data: z.object({
    id: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
    reference: z.string().min(1),
    amount: z.number().int().positive(),
    currency: z.string().min(3).default("NGN"),
    status: z.string().optional(),
    metadata: z
      .object({
        userId: z.string().min(1),
        credits: z.union([z.number().int().positive(), z.string().regex(/^[0-9]+$/)]),
      })
      .optional(),
  }),
});

export async function verifyPaystackWebhook(params: {
  rawBody: string;
  signatureHeader: string | null;
  secretKey: string;
}): Promise<
  | { valid: false; reason: string }
  | { valid: true; ignored?: true; payment?: NormalizedPaymentWebhook; rawEvent?: unknown }
> {
  const sig = params.signatureHeader?.trim();
  if (!sig) {
    return { valid: false, reason: "Missing x-paystack-signature header." };
  }

  const expected = await computeHmacHex("SHA-512", params.secretKey, params.rawBody);
  if (!timingSafeEqualString(sig.toLowerCase(), expected.toLowerCase())) {
    return { valid: false, reason: "Invalid Paystack webhook signature." };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(params.rawBody);
  } catch {
    return { valid: false, reason: "Malformed Paystack webhook JSON." };
  }

  // Signature checked: other events (refunds, disputes) go back to the caller as they are.
  const eventName = (parsedJson as { event?: unknown } | null)?.event;
  if (eventName !== "charge.success") {
    return { valid: true, ignored: true, rawEvent: parsedJson };
  }

  const parsed = PaystackEventSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { valid: false, reason: "Unexpected Paystack webhook schema." };
  }

  if (parsed.data.event !== "charge.success") {
    return { valid: true, ignored: true };
  }
  if (parsed.data.data.status && parsed.data.data.status.toLowerCase() !== "success") {
    return { valid: true, ignored: true };
  }

  const meta = parsed.data.data.metadata;
  if (!meta) {
    return { valid: false, reason: "Paystack charge.success missing metadata.userId/credits." };
  }

  const credits = typeof meta.credits === "number" ? meta.credits : Number(meta.credits);
  if (!Number.isInteger(credits) || credits <= 0) {
    return { valid: false, reason: "Invalid credits value in Paystack metadata." };
  }

  const paystackTxId =
    parsed.data.data.id !== undefined ? String(parsed.data.data.id).trim() : undefined;

  return {
    valid: true,
    payment: {
      provider: "paystack",
      providerReference: parsed.data.data.reference,
      ...(paystackTxId ? { providerOrderId: paystackTxId } : {}),
      userId: meta.userId,
      currency: parsed.data.data.currency.toUpperCase(),
      amountMinor: parsed.data.data.amount,
      creditsGranted: credits,
      eventType: parsed.data.event,
    },
  };
}

const StripeEventSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  data: z.object({
    object: z.object({
      id: z.string().min(1),
      amount_total: z.number().int().positive().nullable().optional(),
      currency: z.string().min(3).nullable().optional(),
      payment_status: z.string().optional(),
      metadata: z
        .object({
          userId: z.string().min(1),
          credits: z.string().regex(/^[0-9]+$/),
        })
        .optional(),
    }),
  }),
});

export function parseStripeSignatureHeader(
  header: string | null
): { timestamp: number; signatures: string[] } | null {
  if (!header) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const [k, v] = part.split("=");
    const key = k?.trim();
    const val = v?.trim();
    if (!key || !val) continue;
    if (key === "t") {
      const n = Number(val);
      if (Number.isInteger(n) && n > 0) timestamp = n;
    } else if (key === "v1") {
      signatures.push(val);
    }
  }

  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export async function verifyStripeWebhook(params: {
  rawBody: string;
  signatureHeader: string | null;
  webhookSecret: string;
  nowMs?: number;
}): Promise<
  | { valid: false; reason: string }
  | { valid: true; ignored?: true; payment?: NormalizedPaymentWebhook; rawEvent?: unknown }
> {
  const parsedSig = parseStripeSignatureHeader(params.signatureHeader);
  if (!parsedSig) {
    return { valid: false, reason: "Missing or malformed stripe-signature header." };
  }

  const nowSec = Math.floor((params.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSec - parsedSig.timestamp) > BILLING_POLICY.webhookReplayWindowSeconds) {
    return { valid: false, reason: "Stripe webhook timestamp outside replay window." };
  }

  const signedPayload = `${parsedSig.timestamp}.${params.rawBody}`;
  const expected = await computeHmacHex("SHA-256", params.webhookSecret, signedPayload);
  const matched = parsedSig.signatures.some((sig) =>
    timingSafeEqualString(sig.toLowerCase(), expected.toLowerCase())
  );
  if (!matched) {
    return { valid: false, reason: "Invalid Stripe webhook signature." };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(params.rawBody);
  } catch {
    return { valid: false, reason: "Malformed Stripe webhook JSON." };
  }

  const parsed = StripeEventSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { valid: false, reason: "Unexpected Stripe webhook schema." };
  }

  if (parsed.data.type !== "checkout.session.completed") {
    return { valid: true, ignored: true, rawEvent: parsedJson };
  }

  const obj = parsed.data.data.object;
  if (obj.payment_status && obj.payment_status !== "paid") {
    return { valid: true, ignored: true };
  }

  const meta = obj.metadata;
  if (!meta) {
    return { valid: false, reason: "Stripe checkout session missing metadata.userId/credits." };
  }

  const credits = Number(meta.credits);
  if (!Number.isInteger(credits) || credits <= 0) {
    return { valid: false, reason: "Invalid credits value in Stripe metadata." };
  }

  return {
    valid: true,
    payment: {
      provider: "stripe",
      providerReference: obj.id,
      userId: meta.userId,
      currency: (obj.currency ?? "usd").toUpperCase(),
      amountMinor: obj.amount_total ?? 100,
      creditsGranted: credits,
      eventType: parsed.data.type,
    },
  };
}

const PolarEventEnvelopeSchema = z.object({
  type: z.string().min(1),
  data: z.unknown(),
});

const PolarOrderPaidDataSchema = z.object({
  id: z.string().min(1),
  checkout_id: z.string().min(1).nullable().optional(),
  product_id: z.string().min(1).nullable().optional(),
  paid: z.boolean().optional(),
  amount: z.number().int().nonnegative().nullable().optional(),
  subtotal_amount: z.number().int().nonnegative().nullable().optional(),
  discount_amount: z.number().int().nonnegative().nullable().optional(),
  net_amount: z.number().int().nonnegative().nullable().optional(),
  total_amount: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().min(3).nullable().optional(),
  customer: z
    .object({
      external_id: z.string().min(1).nullable().optional(),
      email: z.string().optional(),
    })
    .nullable()
    .optional(),
  metadata: z
    .object({
      userId: z.string().min(1).optional(),
      credits: z.union([z.number().int().positive(), z.string().regex(/^[0-9]+$/)]).optional(),
      packId: z.string().min(1).optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
});

/**
 * Parses a Standard Webhooks `webhook-signature` header containing space-delimited
 * `<version>,<base64>` entries (e.g. `v1,<sig1> v1,<sig2>`).
 */
export function parseStandardWebhookSignatures(header: string | null): string[] {
  if (!header) return [];
  const signatures: string[] = [];
  for (const token of header.trim().split(/\s+/)) {
    const commaIdx = token.indexOf(",");
    if (commaIdx <= 0) continue;
    const version = token.slice(0, commaIdx).trim();
    const sig = token.slice(commaIdx + 1).trim();
    if (version === "v1" && sig.length > 0) {
      signatures.push(sig);
    }
  }
  return signatures;
}

/**
 * Derives candidate HMAC-SHA256 signing keys for a Polar webhook secret.
 * Supports both Standard Webhooks base64-encoded secrets (strip `whsec_` / `polar_whs_`
 * prefix and base64-decode, used by Polar from Sept 2026 onward) and legacy Polar secrets
 * signed with the literal UTF-8 bytes of the full secret string.
 */
function buildPolarCandidateSigningKeys(webhookSecret: string): Uint8Array[] {
  const trimmed = webhookSecret.trim();
  const keys: Uint8Array[] = [];

  for (const prefix of ["whsec_", "polar_whs_"]) {
    if (trimmed.startsWith(prefix)) {
      const decoded = tryDecodeBase64(trimmed.slice(prefix.length));
      if (decoded && decoded.byteLength > 0) {
        keys.push(decoded);
      }
      break;
    }
  }

  keys.push(new TextEncoder().encode(trimmed));
  return keys;
}

export async function verifyPolarWebhook(params: {
  rawBody: string;
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  webhookSecret: string;
  polarProductIds?: Record<string, string | undefined>;
  nowMs?: number;
}): Promise<
  | { valid: false; reason: string }
  | { valid: true; ignored?: true; payment?: NormalizedPaymentWebhook; rawEvent?: unknown }
> {
  const webhookId = params.webhookId?.trim();
  const timestampRaw = params.webhookTimestamp?.trim();
  const signatures = parseStandardWebhookSignatures(params.webhookSignature);

  if (!webhookId || !timestampRaw || signatures.length === 0) {
    return {
      valid: false,
      reason: "Missing or malformed Polar Standard Webhooks headers.",
    };
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    return { valid: false, reason: "Malformed Polar webhook-timestamp header." };
  }

  const nowSec = Math.floor((params.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSec - timestamp) > BILLING_POLICY.webhookReplayWindowSeconds) {
    return { valid: false, reason: "Polar webhook timestamp outside replay window." };
  }

  const signedPayload = `${webhookId}.${timestampRaw}.${params.rawBody}`;
  const candidateKeys = buildPolarCandidateSigningKeys(params.webhookSecret);
  const expectedSignatures = await Promise.all(
    candidateKeys.map((keyBytes) => computeHmacBase64("SHA-256", keyBytes, signedPayload))
  );

  let matched = false;
  for (const expected of expectedSignatures) {
    for (const sig of signatures) {
      if (timingSafeEqualString(sig, expected)) {
        matched = true;
      }
    }
  }

  if (!matched) {
    return { valid: false, reason: "Invalid Polar webhook signature." };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(params.rawBody);
  } catch {
    return { valid: false, reason: "Malformed Polar webhook JSON." };
  }

  const envelope = PolarEventEnvelopeSchema.safeParse(parsedJson);
  if (!envelope.success) {
    return { valid: false, reason: "Unexpected Polar webhook envelope." };
  }

  if (envelope.data.type !== "order.paid") {
    return { valid: true, ignored: true, rawEvent: envelope.data };
  }

  const orderParsed = PolarOrderPaidDataSchema.safeParse(envelope.data.data);
  if (!orderParsed.success) {
    return { valid: false, reason: "Unexpected Polar order.paid payload schema." };
  }

  const order = orderParsed.data;
  if (order.paid === false) {
    return { valid: true, ignored: true };
  }

  const meta = order.metadata ?? undefined;
  const userId = meta?.userId?.trim() || order.customer?.external_id?.trim() || "";
  if (!userId) {
    return {
      valid: false,
      reason: "Polar order.paid missing metadata.userId and customer.external_id.",
    };
  }

  const productMatchedPack = (() => {
    const prodId = order.product_id?.trim();
    if (!prodId || !params.polarProductIds) return null;
    for (const [packKey, configuredProdId] of Object.entries(params.polarProductIds)) {
      if (configuredProdId?.trim() === prodId) {
        return findCreditPack(packKey);
      }
    }
    return null;
  })();

  const matchedPack = productMatchedPack ?? (meta?.packId ? findCreditPack(meta.packId) : null);
  const metaCredits =
    meta?.credits !== undefined
      ? typeof meta.credits === "number"
        ? meta.credits
        : Number(meta.credits)
      : undefined;

  // When the paid Polar product_id matches a configured credit pack, enforce strict parity
  // between the verified product's credit count and any metadata value.
  if (
    productMatchedPack &&
    metaCredits !== undefined &&
    metaCredits !== productMatchedPack.credits
  ) {
    return {
      valid: false,
      reason: "Polar order metadata credits do not match the purchased Polar product.",
    };
  }

  const rawCredits = productMatchedPack?.credits ?? metaCredits ?? matchedPack?.credits;

  if (typeof rawCredits !== "number" || !Number.isInteger(rawCredits) || rawCredits <= 0) {
    return { valid: false, reason: "Invalid or missing credits value in Polar order metadata." };
  }

  const rawAmount =
    order.total_amount ?? order.amount ?? order.net_amount ?? matchedPack?.amountUsdCents ?? 100;
  const amountMinor = rawAmount > 0 ? rawAmount : (matchedPack?.amountUsdCents ?? 1);
  const subtotalAmountMinor =
    order.subtotal_amount && order.subtotal_amount > 0
      ? order.subtotal_amount
      : order.discount_amount && order.discount_amount > 0
        ? amountMinor + order.discount_amount
        : amountMinor;

  return {
    valid: true,
    payment: {
      provider: "polar",
      providerReference: order.checkout_id?.trim() || order.id,
      providerOrderId: order.id,
      userId,
      currency: (order.currency ?? "usd").toUpperCase(),
      amountMinor,
      subtotalAmountMinor,
      ...(order.product_id ? { productId: order.product_id } : {}),
      creditsGranted: rawCredits,
      eventType: envelope.data.type,
    },
  };
}

// ── Refunds and disputes ────────────────────────────────────────────────────

export type ParsedReversal =
  | { type: "reversal"; event: ReversalEvent }
  | {
      type: "dispute_resolved";
      provider: PaymentProvider;
      disputeId: string;
      result: "won" | "lost";
      status: string;
      /** Used to record the dispute first if its "opened" event was missed. */
      event: ReversalEvent;
    };

const toMinor = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
const date = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Paystack refund.processed and charge.dispute.* events (already signature-checked).
 * Dispute resolutions: "declined" means the customer's claim was turned down (we won); any
 * other resolution (merchant-accepted, auto-accepted) means the money went back to them.
 */
export function parsePaystackReversal(raw: unknown): ParsedReversal | null {
  const ev = raw as { event?: unknown; data?: Record<string, unknown> } | null;
  const name = typeof ev?.event === "string" ? ev.event : "";
  const data = ev?.data ?? {};
  if (name === "refund.processed") {
    const ref = str(data.transaction_reference);
    const amount = toMinor(data.amount);
    if (!ref || !amount) return null;
    return {
      type: "reversal",
      event: {
        provider: "paystack",
        kind: "refund",
        providerReversalId: str(data.refund_reference) ?? str(data.id) ?? `${ref}:${amount}`,
        payment: { providerReference: ref },
        amountMinor: amount,
        currency: str(data.currency) ?? "NGN",
        status: str(data.status) ?? "processed",
      },
    };
  }
  if (name.startsWith("charge.dispute.")) {
    const tx = (data.transaction ?? {}) as Record<string, unknown>;
    const ref = str(tx.reference) ?? str(data.transaction_reference);
    const txId = str(tx.id);
    const id = str(data.id);
    const amount = toMinor(data.refund_amount) ?? toMinor(tx.amount);
    if (!ref || !id || !amount) return null;
    const messages = Array.isArray(data.messages)
      ? (data.messages as Array<{ body?: unknown }>)
      : [];
    const event: ReversalEvent = {
      provider: "paystack",
      kind: "dispute",
      providerReversalId: id,
      payment: { providerReference: ref, ...(txId ? { providerOrderId: txId } : {}) },
      amountMinor: amount,
      currency: str(data.currency) ?? str(tx.currency) ?? "NGN",
      status: str(data.status) ?? "open",
      reason:
        [str(data.category), str(messages[0]?.body)].filter(Boolean).join(": ").slice(0, 300) ||
        null,
      dueAt: date(data.dueAt) ?? date(data.due_at),
    };
    if (name === "charge.dispute.resolve") {
      const resolution = (str(data.resolution) ?? "").toLowerCase();
      return {
        type: "dispute_resolved",
        provider: "paystack",
        disputeId: id,
        result: resolution === "declined" || resolution === "auto-declined" ? "won" : "lost",
        status: resolution || "resolved",
        event,
      };
    }
    return { type: "reversal", event };
  }
  return null;
}

/** Polar refund.created / refund.updated, once the refund has succeeded. */
export function parsePolarReversal(rawEnvelope: unknown): ParsedReversal | null {
  const env = rawEnvelope as { type?: unknown; data?: Record<string, unknown> } | null;
  if (env?.type !== "refund.created" && env?.type !== "refund.updated") return null;
  const data = env.data ?? {};
  if (str(data.status) !== "succeeded") return null;
  const id = str(data.id);
  const orderId = str(data.order_id);
  const amount = toMinor((toMinor(data.amount) ?? 0) + (toMinor(data.tax_amount) ?? 0));
  if (!id || !orderId || !amount) return null;
  return {
    type: "reversal",
    event: {
      provider: "polar",
      kind: "refund",
      providerReversalId: id,
      payment: { providerOrderId: orderId },
      amountMinor: amount,
      currency: str(data.currency) ?? "usd",
      status: "succeeded",
      reason: str(data.reason),
    },
  };
}

// ── Cancelled, expired, and failed checkouts ────────────────────────────────

export interface ParsedCheckoutTermination {
  provider: PaymentProvider;
  providerReference: string;
  status: "cancelled" | "failed";
  reason: string;
}

/**
 * Polar emits `checkout.updated` when a checkout expires or fails (and `checkout.expired` in
 * some SDK/API versions). Maps those to terminal local payment statuses so unpaid checkouts do
 * not stay stuck as "pending".
 */
export function parsePolarCheckoutTermination(
  rawEnvelope: unknown
): ParsedCheckoutTermination | null {
  const env = rawEnvelope as { type?: unknown; data?: Record<string, unknown> } | null;
  const type = typeof env?.type === "string" ? env.type : "";
  const data = env?.data ?? {};
  const checkoutId = str(data.id);
  if (!checkoutId) return null;

  if (type === "checkout.expired") {
    return {
      provider: "polar",
      providerReference: checkoutId,
      status: "cancelled",
      reason: "expired",
    };
  }

  if (type === "checkout.updated") {
    const status = (str(data.status) ?? "").toLowerCase();
    if (status === "expired") {
      return {
        provider: "polar",
        providerReference: checkoutId,
        status: "cancelled",
        reason: "expired",
      };
    }
    if (status === "failed") {
      return {
        provider: "polar",
        providerReference: checkoutId,
        status: "failed",
        reason: "failed",
      };
    }
  }

  return null;
}

/** Paystack `charge.failed` webhook (signature already verified). */
export function parsePaystackChargeFailure(raw: unknown): ParsedCheckoutTermination | null {
  const ev = raw as { event?: unknown; data?: Record<string, unknown> } | null;
  if (ev?.event !== "charge.failed") return null;
  const data = ev.data ?? {};
  const ref = str(data.reference);
  if (!ref) return null;
  return {
    provider: "paystack",
    providerReference: ref,
    status: "failed",
    reason: str(data.gateway_response) ?? "charge.failed",
  };
}

/** Stripe `checkout.session.expired` webhook (signature already verified). */
export function parseStripeCheckoutExpired(raw: unknown): ParsedCheckoutTermination | null {
  const ev = raw as { type?: unknown; data?: { object?: Record<string, unknown> } } | null;
  if (ev?.type !== "checkout.session.expired") return null;
  const id = str(ev.data?.object?.id);
  if (!id) return null;
  return {
    provider: "stripe",
    providerReference: id,
    status: "cancelled",
    reason: "expired",
  };
}
