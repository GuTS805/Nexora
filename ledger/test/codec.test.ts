import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { decodeEntry, decodeIncident, decodeShift, incidentCreate, shiftCreate } from "../src/index.ts";
import { ALICE, KEY, asStored, incident, shift, storedIncident, storedShift } from "./fixtures.ts";

describe("codec round trip and validation", () => {
  it("decodes a shift and an incident as written", () => {
    expect(storedShift({})).toMatchObject({ kind: "shift", platform: "swiggy", city: "bengaluru", netHourly: 90, costPct: 20, hoursBand: 3, incentive: "met", demo: false, creator: ALICE });
    const followUp = storedIncident({ parent: KEY, resolved: true });
    expect(followUp).toMatchObject({ kind: "incident", type: "id_blocked", daysLost: 4, reasonGiven: false, resolved: true, parent: KEY });
    expect(decodeEntry(asStored(incidentCreate(incident))).ok).toBe(true);
  });

  it("rejects an entity whose attributes were hand-written outside the vocabulary", () => {
    const raw = asStored(shiftCreate(shift));
    raw.attributes = { ...raw.attributes, city: { type: "str", value: "Ramesh, 98xxxxxx21, HSR Layout" } };
    expect(decodeShift(raw)).toMatchObject({ ok: false, reason: "bad city" });
  });

  it("rejects off-grid figures, wrong types and impossible months", () => {
    const raw = asStored(shiftCreate(shift));
    raw.attributes = { ...raw.attributes, net_hourly: { type: "i32", value: 93 } };
    expect(decodeShift(raw).ok).toBe(false);
    raw.attributes = { ...raw.attributes, net_hourly: { type: "str", value: "90" } };
    expect(decodeShift(raw).ok).toBe(false);
    const month = asStored(shiftCreate(shift));
    month.attributes = { ...month.attributes, period: { type: "i32", value: 202613 } };
    expect(decodeShift(month)).toMatchObject({ ok: false, reason: "bad month" });
    expect(decodeShift(asStored(incidentCreate(incident)))).toMatchObject({ ok: false, reason: "not a shift" });
  });

  it("refuses invalid inputs before they reach the chain", () => {
    expect(() => shiftCreate({ ...shift, hours: 0 })).toThrow();
    expect(() => shiftCreate({ ...shift, hours: 30 })).toThrow();
    expect(() => shiftCreate({ ...shift, grossInr: -1 })).toThrow();
    expect(() => shiftCreate({ ...shift, period: 202613 })).toThrow(/Month/);
    expect(() => shiftCreate({ ...shift, platform: "myspace" as never })).toThrow();
    expect(() => incidentCreate({ ...incident, daysLost: 2.5 })).toThrow();
    expect(() => incidentCreate({ ...incident, parent: "0x12" as Hex })).toThrow();
  });
});

describe("codec limits", () => {
  it("rejects an oversized, non-JSON or wrong-version payload", () => {
    const raw = asStored(shiftCreate(shift));
    expect(decodeShift({ ...raw, payload: new Uint8Array(5_000).fill(32) })).toMatchObject({ ok: false, reason: "bad payload" });
    expect(decodeShift({ ...raw, payload: new TextEncoder().encode("not json") })).toMatchObject({ ok: false, reason: "bad payload" });
    expect(decodeShift({ ...raw, payload: new TextEncoder().encode('{"v":2,"incentive":"met"}') })).toMatchObject({ ok: false, reason: "bad payload" });
  });

  it("rejects a parent that is not key-typed, and an unknown entry kind", () => {
    const raw = asStored(incidentCreate({ ...incident, parent: KEY }));
    raw.attributes = { ...raw.attributes, parent: { type: "str", value: KEY } };
    expect(decodeIncident(raw)).toMatchObject({ ok: false, reason: "bad parent" });
    const other = asStored(shiftCreate(shift));
    other.attributes = { ...other.attributes, kind: { type: "str", value: "profile" } };
    expect(decodeEntry(other)).toMatchObject({ ok: false, reason: "not a Nexora entry" });
  });

  it("reports the flags an entry was created with", () => {
    expect(storedShift({})).toMatchObject({ readonly: true, communityCanExtend: true });
  });
});
