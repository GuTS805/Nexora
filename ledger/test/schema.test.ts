import { describe, expect, it } from "vitest";
import {
  HOURS_BANDS, HOURS_BAND_LABELS, NET_MAX, NET_MIN, PLATFORMS, WORK_TYPES, costPct, hoursBand, isOneOf, isPeriod, netHourly,
  periodOf, previousPeriod, shiftCreate, workFor,
} from "../src/index.ts";
import { shift } from "./fixtures.ts";

describe("banding keeps exact figures off-chain", () => {
  it("bands hours and rounds take-home per hour and cost share", () => {
    expect(hoursBand(3.5)).toBe(0);
    expect(hoursBand(4)).toBe(1);
    expect(hoursBand(10)).toBe(3);
    expect(hoursBand(16)).toBe(5);
    expect(netHourly(1_180, 240, 10)).toBe(90);
    expect(netHourly(500, 800, 5)).toBe(-60);
    expect(costPct(1_180, 240)).toBe(20);
    expect(costPct(0, 100)).toBe(100);
    expect(costPct(1_000, 0)).toBe(0);
    expect(previousPeriod(202601)).toBe(202512);
    expect(previousPeriod(202610)).toBe(202609);
  });

  it("never writes rupee amounts or exact hours into attributes or the public payload", () => {
    const params = shiftCreate({ ...shift, grossInr: 1_187, costsInr: 243, hours: 9.5 });
    const publicText = JSON.stringify(params.attributes) + new TextDecoder().decode(params.payload);
    for (const exact of ["1187", "243", "9.5"]) expect(publicText).not.toContain(exact);
    expect(params.flags).toEqual({ readonly: true, permissionlessExtension: true });
  });
});

describe("vocabulary helpers", () => {
  it("accepts only real months inside the contract's range", () => {
    expect(isPeriod(202401)).toBe(true);
    expect(isPeriod(203012)).toBe(true);
    for (const bad of [202312, 203101, 202600, 202613, 2026.5, "202610"]) expect(isPeriod(bad)).toBe(false);
    expect(periodOf(new Date(2026, 9, 15))).toBe(202610);
  });

  it("clamps take-home per hour to the contract's range and refuses zero hours", () => {
    expect(netHourly(50_000, 0, 1)).toBe(NET_MAX);
    expect(netHourly(0, 50_000, 1)).toBe(NET_MIN);
    expect(Object.is(netHourly(1, 2, 10), 0)).toBe(true);
    expect(() => netHourly(100, 0, 0)).toThrow(/Hours/);
  });

  it("puts every band boundary in the higher band", () => {
    HOURS_BANDS.forEach((upper, i) => {
      expect(hoursBand(upper - 0.01)).toBe(i);
      expect(hoursBand(upper)).toBe(i + 1);
    });
    expect(HOURS_BAND_LABELS).toHaveLength(HOURS_BANDS.length + 1);
  });

  it("lists the kinds of work each platform offers, from the closed vocabulary", () => {
    for (const platform of PLATFORMS) for (const work of workFor(platform)) expect(WORK_TYPES).toContain(work);
    expect(isOneOf(PLATFORMS, "swiggy")).toBe(true);
    expect(isOneOf(PLATFORMS, "Swiggy")).toBe(false);
    expect(isOneOf(PLATFORMS, 5)).toBe(false);
  });
});
