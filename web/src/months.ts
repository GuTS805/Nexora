import { generatePrivateKey } from "viem/accounts";
import { store } from "./storage.ts";

/**
 * A wallet per month for earnings. All of a worker's days in one month share a wallet, so counts of
 * distinct workers per month (and so confirmation) stay right, but a platform that recognises one
 * day can follow the worker through that month only, not through their whole history. Each key is
 * also kept with the one-time keys, so My data, backups, later edits and the phone wipe cover it.
 */
const KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const PERIOD_RE = /^\d{6}$/;

export function monthKeys(): Record<string, `0x${string}`> {
  try {
    const parsed = JSON.parse(store.get("monthly") ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, `0x${string}`] => PERIOD_RE.test(e[0]) && typeof e[1] === "string" && KEY_RE.test(e[1])));
  } catch {
    return {};
  }
}

function oneOffKeys(): string[] {
  try {
    const parsed = JSON.parse(store.get("oneoff") ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string" && KEY_RE.test(k)) : [];
  } catch {
    return [];
  }
}

/** Remembers month keys (new or restored from a backup), and keeps each with the one-time keys. */
export function rememberMonthKeys(keys: Record<string, string>): void {
  const valid = Object.fromEntries(Object.entries(keys).filter(([period, key]) => PERIOD_RE.test(period) && KEY_RE.test(key)));
  if (!Object.keys(valid).length) return;
  store.set("monthly", JSON.stringify({ ...monthKeys(), ...valid }));
  store.set("oneoff", JSON.stringify([...new Set([...oneOffKeys(), ...Object.values(valid)])]));
}

/** The key for a month (yyyymm), created the first time that month is published. */
export function monthKey(period: number): `0x${string}` {
  const id = String(period);
  if (!PERIOD_RE.test(id)) throw new Error(`Not a month: ${period}`);
  const existing = monthKeys()[id];
  if (existing) return existing;
  const key = generatePrivateKey();
  rememberMonthKeys({ [id]: key });
  return key;
}
