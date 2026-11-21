import { timingSafeEqualString } from "@/lib/security/internal-auth";

// Cloudflare Workers Web Crypto caps PBKDF2 iterations at 100,000.
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_BITS = 256;
const HASH_PREFIX = "pbkdf2_sha256";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

const COMMON_BREACHED_PASSWORDS = new Set([
  "123456789012",
  "password1234",
  "password12345",
  "qwerty123456",
  "letmein12345",
  "welcome12345",
  "admin1234567",
  "iloveyou1234",
  "abcdefghijkl",
  "000000000000",
  "111111111111",
  "passw0rd1234",
]);

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function copyBytes(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(src.byteLength);
  const view = new Uint8Array(buf);
  view.set(src);
  return view;
}

export interface PasswordValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Enforces >= 12 character passphrases and rejects common breached passwords
 * without arbitrary symbol-composition theatre.
 */
export function validatePasswordStrength(
  password: string,
  email?: string
): PasswordValidationResult {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      valid: false,
      reason: `Password must be at most ${MAX_PASSWORD_LENGTH} characters long.`,
    };
  }

  const normalized = password.toLowerCase().trim();
  if (COMMON_BREACHED_PASSWORDS.has(normalized)) {
    return {
      valid: false,
      reason: "That password is too common. Choose a longer phrase that is unique to Collate.",
    };
  }

  if (new Set(password).size < 4) {
    return {
      valid: false,
      reason: "Password is too repetitive. Mix more varied words or characters.",
    };
  }

  if (email) {
    const localPart = email.split("@")[0]?.toLowerCase().trim() ?? "";
    if (localPart.length >= 4 && normalized.includes(localPart)) {
      return {
        valid: false,
        reason: "Password should not contain your email address.",
      };
    }
  }

  return { valid: true };
}

async function derivePbkdf2Hex(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    copyBytes(encoder.encode(password)),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: copyBytes(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    DERIVED_BITS
  );

  return toHex(new Uint8Array(derived));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const derivedHex = await derivePbkdf2Hex(password, salt, PBKDF2_ITERATIONS);
  return `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${toHex(salt)}$${derivedHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 4) return false;

  const [scheme, iterStr, saltHex, expectedHex] = parts;
  if (scheme !== HASH_PREFIX || !iterStr || !saltHex || !expectedHex) return false;

  const iterations = Number(iterStr);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > PBKDF2_ITERATIONS) {
    return false;
  }

  const salt = fromHex(saltHex);
  if (!salt || salt.byteLength < SALT_BYTES) return false;

  const actualHex = await derivePbkdf2Hex(password, salt, iterations);
  return timingSafeEqualString(actualHex, expectedHex);
}

// Pre-computed dummy hash for timing-equalized failed lookups when an email does not exist.
const DUMMY_SALT = "00112233445566778899aabbccddeeff";
const DUMMY_HASH = `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${DUMMY_SALT}$0000000000000000000000000000000000000000000000000000000000000000`;

export async function runDummyPasswordCheck(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}
