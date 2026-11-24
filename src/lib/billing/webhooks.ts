import { z } from "zod";
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
  | { valid: true; ignored?: true; payment?: NormalizedPaymentWebhook }
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

  return {
    valid: true,
    payment: {
      provider: "paystack",
      providerReference: parsed.data.data.reference,
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
  | { valid: true; ignored?: true; payment?: NormalizedPaymentWebhook }
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
    return { valid: true, ignored: true };
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
  | { valid: true; ignored?: true; payment?: NormalizedPaymentWebhook }
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
    return { valid: true, ignored: true };
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
