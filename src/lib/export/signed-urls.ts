import { timingSafeEqualString } from "@/lib/security/internal-auth";

const DEFAULT_EXPIRY_SECONDS = 600;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const buf = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buf).set(encoded);
  return buf;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, toArrayBuffer(message));
  return toHex(new Uint8Array(sig));
}

export async function signExportDownloadParams(params: {
  exportId: string;
  projectId: string;
  userId: string;
  secret: string;
  nowMs?: number;
  ttlSeconds?: number;
}): Promise<{ exp: number; sig: string }> {
  const nowSec = Math.floor((params.nowMs ?? Date.now()) / 1000);
  const exp = nowSec + (params.ttlSeconds ?? DEFAULT_EXPIRY_SECONDS);
  const canonical = `${params.exportId}:${params.projectId}:${params.userId}:${exp}`;
  const sig = await hmacSha256Hex(params.secret, canonical);
  return { exp, sig };
}

export async function verifyExportDownloadParams(params: {
  exportId: string;
  projectId: string;
  userId: string;
  exp: number;
  sig: string;
  secret: string;
  nowMs?: number;
}): Promise<{ valid: boolean; reason?: string }> {
  if (!Number.isInteger(params.exp) || !params.sig.trim()) {
    return { valid: false, reason: "Missing download signature parameters." };
  }
  const nowSec = Math.floor((params.nowMs ?? Date.now()) / 1000);
  if (params.exp < nowSec) {
    return { valid: false, reason: "This download link has expired. Generate a fresh link." };
  }
  const canonical = `${params.exportId}:${params.projectId}:${params.userId}:${params.exp}`;
  const expected = await hmacSha256Hex(params.secret, canonical);
  if (!timingSafeEqualString(params.sig.trim(), expected)) {
    return { valid: false, reason: "Invalid download signature." };
  }
  return { valid: true };
}
