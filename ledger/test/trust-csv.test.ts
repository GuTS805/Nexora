import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { CSV_TEMPLATE, decodeTrustList, parseShiftsCsv, trustListCreate, trustListPatch, type RawEntity } from "../src/index.ts";
import { ALICE, BOB, KEY } from "./fixtures.ts";

describe("trust lists and csv", () => {
  it("round trips a trust list and dedupes members", () => {
    const params = trustListCreate({ name: "Bengaluru delivery riders union", scope: "food_delivery", description: "", members: [ALICE, ALICE.toLowerCase() as typeof ALICE, BOB] });
    const decoded = decodeTrustList({ key: KEY, creator: ALICE, owner: ALICE, expiresAt: 1n, payload: params.payload, attributes: params.attributes as RawEntity["attributes"] });
    expect(decoded.ok && decoded.value.members).toEqual([ALICE, BOB]);
  });

  it("builds trust-list edits as Arkiv patch mutations (set), not a create-shaped object", () => {
    const patch = trustListPatch(KEY, { name: "Bengaluru delivery riders union", scope: "all", description: "", members: [ALICE, BOB] });
    expect(patch.entityKey).toBe(KEY);
    expect(patch.set).toMatchObject({ kind: { value: "trust_list" }, name: { value: "Bengaluru delivery riders union" } });
    expect("attributes" in patch).toBe(false);
  });

  it("parses the template and reports bad rows by line, without turning blanks into ₹0", () => {
    const ok = parseShiftsCsv(CSV_TEMPLATE, 30);
    expect(ok.errors).toEqual([]);
    expect(ok.rows).toHaveLength(2);
    expect(ok.rows[0]).toMatchObject({ period: 202610, grossInr: 1_180, hours: 10 });
    const bad = parseShiftsCsv(CSV_TEMPLATE + "swiggy,food_delivery,bengaluru,petrol_bike,2026-10,,100,8,met\n", 30);
    expect(bad.errors[0]?.line).toBe(4);
  });

  it("refuses trust lists that are unnamed, oversized or contain non-addresses", () => {
    const base = { name: "Union", scope: "all" as const, description: "", members: [ALICE] };
    expect(() => trustListCreate({ ...base, name: "ab" })).toThrow(/Name/);
    expect(() => trustListCreate({ ...base, members: [] })).toThrow(/members/);
    const many = Array.from({ length: 26 }, (_, i) => getAddress(`0x${(i + 1).toString(16).padStart(40, "0")}`));
    expect(() => trustListCreate({ ...base, members: many })).toThrow(/members/);
    expect(() => trustListCreate({ ...base, members: ["0x123" as never] })).toThrow(/Not an address/);
    expect(() => trustListCreate({ ...base, description: "x".repeat(281) })).toThrow(/Description/);
    expect(trustListCreate(base).flags).toEqual({ readonly: false, permissionlessExtension: false });
  });

  it("rejects a stored trust list with an unknown scope", () => {
    const params = trustListCreate({ name: "Union", scope: "all", description: "", members: [ALICE] });
    const attributes = { ...(params.attributes as RawEntity["attributes"]), scope: { type: "str", value: "everyone" } };
    expect(decodeTrustList({ key: KEY, creator: ALICE, owner: ALICE, expiresAt: 1n, payload: params.payload, attributes })).toMatchObject({ ok: false, reason: "Unknown scope." });
  });

  it("rejects a header without the required columns, and accepts reordered columns and blank costs", () => {
    expect(parseShiftsCsv("platform,city\nswiggy,bengaluru\n", 30).errors[0]).toMatchObject({ line: 1 });
    const reordered = "month,platform,work,city,vehicle,hours,gross_inr,costs_inr,incentive\n2026-09,zepto,grocery_delivery,pune,ev_scooter,8,900,,\n";
    const { rows, errors } = parseShiftsCsv(reordered, 7);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ platform: "zepto", period: 202609, costsInr: 0, incentive: "none", expiresInDays: 7 });
  });

  it("reports a bad month or unknown platform with its line number", () => {
    const extra = "swiggy,food_delivery,bengaluru,petrol_bike,Oct 2026,1000,100,8,met\nmyspace,food_delivery,bengaluru,petrol_bike,2026-10,1000,100,8,met\n";
    const { errors } = parseShiftsCsv(CSV_TEMPLATE + extra, 30);
    expect(errors.map((e) => e.line)).toEqual([4, 5]);
    expect(errors[0]?.message).toMatch(/Month/);
    expect(errors[1]?.message).toMatch(/platform/);
  });
});
