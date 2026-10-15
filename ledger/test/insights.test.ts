import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  MIN_WORKERS_FOR_CONFIRMED, PLATFORM_WORK, comparePlatforms, confidence, earningsStats, incidentStats, monthChange, quantile,
  resolvedReports, summariseShifts,
} from "../src/index.ts";
import { ALICE, BOB, storedIncident, storedShift } from "./fixtures.ts";

describe("insights", () => {
  it("one wallet repeating a figure stays unconfirmed and never outranks confirmed pay", () => {
    const spam = Array.from({ length: 30 }, (_, i) => storedShift({ platform: "rapido", work: "bike_taxi", vehicle: "petrol_bike", grossInr: 4_200, costsInr: 200, hours: 10 }, ALICE, i));
    const honest = [storedShift({}, ALICE, 100), storedShift({ grossInr: 1_000 }, BOB, 101)];
    const ranked = comparePlatforms([...spam, ...honest]);
    expect(ranked[0]).toMatchObject({ platform: "swiggy", confirmed: true, workers: 2 });
    expect(ranked[1]).toMatchObject({ platform: "rapido", confirmed: false, workers: 1, medianHourly: 400 });
    expect(confidence(5)).toBeGreaterThan(confidence(1));
  });

  it("with a trust set, free throwaway wallets cannot manufacture independent confirmation", () => {
    const sybils = [3, 4, 5, 6, 7].map((n) => getAddress(`0x${String(n).repeat(40)}`));
    const fake = sybils.map((wallet, i) => storedShift({ platform: "porter", work: "parcel_delivery", grossInr: 5_000, costsInr: 0, hours: 10 }, wallet, 200 + i));
    const honest = [storedShift({}, ALICE, 300), storedShift({}, BOB, 301)];
    // Without a trust set, five fresh wallets look like five independent workers.
    expect(comparePlatforms([...fake, ...honest])[0]).toMatchObject({ platform: "porter", confirmed: true });
    // With one, only trusted creators confirm; the fake rows stay visible but unconfirmed.
    const trusted = new Set([ALICE, BOB]);
    const ranked = comparePlatforms([...fake, ...honest], [], { trusted });
    expect(ranked[0]).toMatchObject({ platform: "swiggy", confirmed: true });
    expect(ranked.find((r) => r.platform === "porter")).toMatchObject({ workers: 5, trustedWorkers: 0, confirmed: false });
  });

  it("reports a month-on-month change only when both months are confirmed", () => {
    const sept = [storedShift({ period: 202609, grossInr: 1_240 }, ALICE, 1), storedShift({ period: 202609, grossInr: 1_240 }, BOB, 2)];
    const oct = [storedShift({ period: 202610, grossInr: 1_040 }, ALICE, 3), storedShift({ period: 202610, grossInr: 1_040 }, BOB, 4)];
    expect(monthChange([...sept, ...oct])).toBe(-20);
    expect(monthChange([...sept, oct[0]!])).toBeNull();
    expect(monthChange([...sept, ...oct], new Set([ALICE]))).toBeNull();
  });

  it("groups earnings by platform · work · city and puts incidents beside pay", () => {
    const rows = [storedShift({}, ALICE, 1), storedShift({ city: "jaipur" }, BOB, 2)];
    expect(earningsStats(rows).map((g) => g.city)).toEqual(expect.arrayContaining(["bengaluru", "jaipur"]));
    const compared = comparePlatforms(rows, [storedIncident({ platform: "swiggy" }, ALICE, 9)]);
    expect(compared[0]).toMatchObject({ city: null, incidents: 1 });
  });

  it("counts incidents once and lets only the author's own follow-up mark the original resolved", () => {
    const blocked = storedIncident({}, ALICE, 1);
    const blockedToo = storedIncident({ reasonGiven: true, daysLost: 10 }, BOB, 2);
    const update = storedIncident({ parent: blocked.key, resolved: true, daysLost: 6 }, ALICE, 3);
    const [stats] = incidentStats([blocked, blockedToo, update]);
    expect(stats).toMatchObject({ type: "id_blocked", reports: 2, workers: 2, confirmed: true, medianDaysLost: 7, noReasonShare: 0.5, resolvedShare: 0.5 });
    // Someone else's resolved "same here" report does not close Bob's case.
    const sameHere = storedIncident({ parent: blockedToo.key, resolved: true }, ALICE, 4);
    expect(resolvedReports([blocked, blockedToo, update, sameHere])).toEqual(new Set([blocked.key]));
  });

  it("every platform offers at least one kind of work", () => {
    for (const work of Object.values(PLATFORM_WORK)) expect(work.length).toBeGreaterThan(0);
  });

  it("interpolates quantiles and counts distinct workers, not rows", () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(quantile([10, 20, 30, 40], 0)).toBe(10);
    expect(quantile([10, 20, 30, 40], 1)).toBe(40);
    const rows = [storedShift({}, ALICE, 1), storedShift({}, ALICE, 2), storedShift({ grossInr: 2_240 }, BOB, 3)];
    expect(summariseShifts(rows)).toEqual({ shifts: 3, workers: 2, medianHourly: 90 });
    expect(confidence(1)).toBeCloseTo(1 / 3);
    expect(MIN_WORKERS_FOR_CONFIRMED).toBe(2);
  });
});
