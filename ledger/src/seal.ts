/**
 * Client-side sealing for the exact figures a seller does not want to publish.
 *
 * The passphrase never leaves the device. What reaches Arkiv is AES-256-GCM ciphertext under a key
 * derived with PBKDF2-SHA256; GCM's tag means a tampered blob fails to open instead of decrypting
 * to garbage. A short passphrase can still be brute-forced offline — the UI enforces a minimum
 * length and says so, and the sealed fields are business figures, never personal data.
 */

export const SEAL_ALG = "AES-256-GCM";
export const SEAL_KDF = "PBKDF2-SHA256";
export const SEAL_ITERATIONS = 310_000;
export const MIN_PASSPHRASE_LENGTH = 10;

export type SealedBox = {
  alg: typeof SEAL_ALG;
  kdf: typeof SEAL_KDF;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
};

/** What a seller may seal. Free text lives only here, encrypted, never in an attribute. */
export type PrivateFigures = {
  spendInr: number;
  revenueInr: number;
  orders?: number;
  note?: string;
};

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto is unavailable in this environment.");
  return s;
};

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await subtle().importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(figures: PrivateFigures, passphrase: string): Promise<SealedBox> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, SEAL_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(figures));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return { alg: SEAL_ALG, kdf: SEAL_KDF, iter: SEAL_ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(ct) };
}

export async function unseal(box: SealedBox, passphrase: string): Promise<PrivateFigures> {
  if (box.alg !== SEAL_ALG || box.kdf !== SEAL_KDF) throw new Error("Unsupported sealed box.");
  if (!Number.isInteger(box.iter) || box.iter < 100_000 || box.iter > 5_000_000) {
    throw new Error("Sealed box has an implausible iteration count.");
  }
  const key = await deriveKey(passphrase, fromBase64(box.salt), box.iter);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtle().decrypt({ name: "AES-GCM", iv: fromBase64(box.iv) }, key, fromBase64(box.ct));
  } catch {
    throw new Error("Wrong passphrase, or the sealed data was altered.");
  }
  return JSON.parse(new TextDecoder().decode(plaintext)) as PrivateFigures;
}

export function isSealedBox(value: unknown): value is SealedBox {
  if (typeof value !== "object" || value === null) return false;
  const box = value as Record<string, unknown>;
  return box.alg === SEAL_ALG && box.kdf === SEAL_KDF && typeof box.iter === "number" &&
    typeof box.salt === "string" && typeof box.iv === "string" && typeof box.ct === "string" &&
    box.ct.length < 8_000;
}
