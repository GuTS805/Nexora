import { beforeEach, describe, expect, it, vi } from "vitest";
import { monthKey, monthKeys, rememberMonthKeys } from "./months.ts";

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
});

describe("a wallet per month", () => {
  it("reuses one key within a month and makes a new one for the next, each kept with the one-time keys", () => {
    const october = monthKey(202610);
    expect(monthKey(202610)).toBe(october);
    const november = monthKey(202611);
    expect(november).not.toBe(october);
    expect(monthKeys()).toEqual({ "202610": october, "202611": november });
    expect(JSON.parse(localStorage.getItem("nexora.oneoff")!)).toEqual([october, november]);
  });

  it("restores months from a backup without duplicating keys, and ignores anything malformed", () => {
    const key = `0x${"1".repeat(64)}`;
    localStorage.setItem("nexora.oneoff", JSON.stringify([key]));
    rememberMonthKeys({ "202609": key, "2026-10": key, "202610": "0x12" });
    expect(monthKeys()).toEqual({ "202609": key });
    expect(JSON.parse(localStorage.getItem("nexora.oneoff")!)).toEqual([key]);
    expect(monthKey(202609)).toBe(key);
    expect(() => monthKey(2026)).toThrow(/month/);
  });
});
