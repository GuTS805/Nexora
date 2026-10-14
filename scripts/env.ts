import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Reads KEY=value lines from the repo-root `.env.local` (gitignored) into process.env. */
export const ENV_FILE = resolve(import.meta.dirname, "..", ".env.local");

export function loadEnv(): void {
  if (!existsSync(ENV_FILE)) return;
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && match[1] && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

export function requireKey(name: string): `0x${string}` {
  const value = process.env[name];
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} is missing. Run \`npm run wallets\` first.`);
  }
  return value as `0x${string}`;
}

/**
 * Synthetic demo workers. Keys 1–9 behave like honest workers with one consistent profile each
 * (city, kind of work, vehicle); key 10 is a deliberate spammer. Each key is one `$creator`, so the
 * "independent workers" counts in the app are counts of these wallets.
 */
export const SEED_KEY_NAMES = Array.from({ length: 10 }, (_, i) => `NEXORA_SEED_KEY_${i + 1}`) as readonly string[];
export const SPAMMER_KEY_NAME = "NEXORA_SEED_KEY_10";
export const SPONSOR_KEY_NAME = "NEXORA_SPONSOR_KEY";
