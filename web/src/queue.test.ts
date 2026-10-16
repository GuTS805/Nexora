import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftCreate } from "nexora-ledger";
import { DELAY_MAX_MS, DELAY_MIN_MS, dequeue, enqueue, isDue, paramsFor, pendingEntries, randomSendTime, type FormEntry } from "./queue.ts";

const shift: FormEntry = {
  kind: "shift",
  input: { platform: "swiggy", work: "food_delivery", city: "pune", vehicle: "ev_scooter", period: 202610, grossInr: 1_100, costsInr: 90, hours: 9, incentive: "met", expiresInDays: 90, demo: false },
};

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  vi.stubGlobal("dispatchEvent", () => true);
});

describe("offline queue", () => {
  it("saves only what will be published, banded, and rebuilds exactly the entry the codec writes", () => {
    const saved = enqueue(shift, { oneOff: false, lock: true });
    const [back] = pendingEntries();
    expect(back).toEqual(saved);
    expect(paramsFor(back!.entry)).toEqual(shiftCreate(shift.input));
    // Not even this phone keeps the exact rupees or hours.
    const stored = localStorage.getItem("nexora.pending") ?? "";
    expect(stored).not.toMatch(/1100|"hours"|grossInr|costsInr/);
    expect(stored).toContain("net_hourly");
  });

  it("refuses to save an invalid entry and drops tampered ones instead of sending them", () => {
    expect(() => enqueue({ ...shift, input: { ...shift.input, hours: 30 } }, { oneOff: false, lock: false })).toThrow(/Hours/);
    const good = enqueue(shift, { oneOff: false, lock: false });
    const tampered = { ...good, entry: { ...good.entry, attributes: { ...good.entry.attributes, city: { type: "str", value: "atlantis" } } } };
    localStorage.setItem("nexora.pending", JSON.stringify([tampered, { ...good, entry: { ...good.entry, kind: "incident" } }, "junk"]));
    expect(pendingEntries()).toEqual([]);
    localStorage.setItem("nexora.pending", "{not json");
    expect(pendingEntries()).toEqual([]);
  });

  it("removes one entry by id", () => {
    const a = enqueue(shift, { oneOff: true, lock: false });
    const b = enqueue(shift, { oneOff: false, lock: false });
    dequeue(a.id);
    expect(pendingEntries().map((p) => p.id)).toEqual([b.id]);
  });
  it("keeps a delayed entry until its random moment, between one and six hours away", () => {
    const now = 1_760_000_000_000;
    const times = Array.from({ length: 200 }, () => randomSendTime(now) - now);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(DELAY_MIN_MS);
    expect(Math.max(...times)).toBeLessThan(DELAY_MAX_MS);
    // Spread across the window, not bunched at one end.
    expect(new Set(times.map((t) => Math.floor(t / 3_600_000))).size).toBeGreaterThanOrEqual(4);
    const later = enqueue(shift, { oneOff: true, lock: false, notBefore: now + DELAY_MIN_MS });
    const soon = enqueue(shift, { oneOff: true, lock: false });
    const [a, b] = pendingEntries();
    expect(a).toEqual(later);
    expect(isDue(a!, now)).toBe(false);
    expect(isDue(a!, now + DELAY_MIN_MS)).toBe(true);
    expect(isDue(b!, now)).toBe(true);
    expect("notBefore" in soon).toBe(false);
    localStorage.setItem("nexora.pending", JSON.stringify([{ ...later, notBefore: "soon" }]));
    expect(pendingEntries()).toEqual([]);
  });
});
