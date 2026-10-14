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

export const SEED_KEY_NAMES = ["NEXORA_SEED_KEY_1", "NEXORA_SEED_KEY_2", "NEXORA_SEED_KEY_3", "NEXORA_SEED_KEY_4"] as const;
export const SPONSOR_KEY_NAME = "NEXORA_SPONSOR_KEY";
