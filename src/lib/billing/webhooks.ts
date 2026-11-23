import { z } from "zod";
import { BILLING_POLICY } from "@/config/pricing";
import type { PaymentProvider } from "@/db/schema";
import { timingSafeEqualString } from "@/lib/security/internal-auth";

function toArrayBuffer(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const buf = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buf).set(encoded);
  return buf;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

export interface NormalizedPaymentWebhook {
  provider: PaymentProvider;
  providerReference: string;
  userId: string;
  currency: string;
  amountMinor: number;
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
