import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditEntities, validateEntity } from "../src/contract.ts";
import { CITY_STATE, decodeGuide, guideCreate, guidePatch, guidesFor, validateGuide, type Guide, type GuideInput, type RawEntity } from "../src/index.ts";
import { ALICE, keyOf } from "./fixtures.ts";

const published = (JSON.parse(readFileSync(new URL("../../arkiv/guides.json", import.meta.url), "utf8")) as { guides: GuideInput[] }).guides;

function stored(input: GuideInput, i = 1): RawEntity {
  const params = guideCreate(input);
  return {
    key: keyOf(i), creator: ALICE, owner: ALICE, expiresAt: 1_000_000n,
    creationFlags: params.flags as RawEntity["creationFlags"], contentType: params.contentType,
    payload: params.payload, attributes: params.attributes as RawEntity["attributes"],
  };
}

const law: GuideInput = {
  scope: "karnataka", topic: "law", title: "A law", status: "In force.", points: ["One point."],
  sources: [{ label: "Source", url: "https://example.org/a" }], checked: "2026-10-16",
};

describe("guides", () => {
  it("every guide in arkiv/guides.json follows the contract, decodes back unchanged and passes the privacy audit", () => {
    expect(published.length).toBeGreaterThanOrEqual(7);
    const raws = published.map((g, i) => stored(g, i + 1));
    for (const [i, raw] of raws.entries()) {
      expect(validateEntity("guide", raw), published[i]!.title).toEqual([]);
      const decoded = decodeGuide(raw);
      expect(decoded.ok, published[i]!.title).toBe(true);
      if (decoded.ok) expect({ ...decoded.value, key: undefined, creator: undefined, owner: undefined, expiresAt: undefined }).toMatchObject(published[i]!);
    }
    // Article ids inside source links are not ID numbers; the audit must not flag them.
    const report = auditEntities(raws);
    expect(report.violations).toEqual([]);
    expect(report.shown.guide).toBe(published.length);
  });

  it("every source is an https link, every Hindi translation has one line per English line, and every rating names known platforms", () => {
    for (const g of published) {
      for (const s of g.sources) expect(s.url).toMatch(/^https:\/\//);
      if (g.hi) expect(g.hi.points).toHaveLength(g.points.length);
      if (g.topic === "rating") expect(Object.keys(g.scores ?? {}).length).toBeGreaterThan(0);
    }
  });

  it("refuses insecure links, scores out of range or on a law, mismatched translations and unknown places", () => {
    expect(() => validateGuide({ ...law, sources: [{ label: "x", url: "http://example.org" }] })).toThrow(/https/);
    expect(() => validateGuide({ ...law, sources: [{ label: "x", url: "javascript:alert(1)" }] })).toThrow(/https/);
    expect(() => validateGuide({ ...law, topic: "rating", scores: { swiggy: 11 } })).toThrow(/0–10/);
    expect(() => validateGuide({ ...law, scores: { swiggy: 5 } })).toThrow(/Only a rating/);
    expect(() => validateGuide({ ...law, hi: { title: "क", status: "ख", points: ["एक", "दो"] } })).toThrow(/Hindi point/);
    expect(() => validateGuide({ ...law, scope: "atlantis" as GuideInput["scope"] })).toThrow(/scope/);
    expect(() => validateGuide({ ...law, checked: "16/10/2026" })).toThrow(/YYYY-MM-DD/);
  });

  it("is editable by its curator: a patch re-sets every attribute with the new wording", () => {
    const patch = guidePatch(keyOf(3), { ...law, status: "Struck down." });
    expect(new TextDecoder().decode(patch.payload)).toContain("Struck down.");
    expect(Object.keys(patch.set ?? {})).toEqual(["app", "v", "kind", "scope", "topic"]);
    expect(guideCreate(law).flags).toEqual({ readonly: false, permissionlessExtension: false });
  });

  it("shows a worker the all-India guides plus their own state's law", () => {
    const guides = published.map((g, i) => decodeGuide(stored(g, i + 1))).filter((d): d is { ok: true; value: Guide } => d.ok).map((d) => d.value);
    const bengaluru = guidesFor(guides, "bengaluru").map((g) => g.scope);
    expect(new Set(bengaluru)).toEqual(new Set(["india", "karnataka"]));
    expect(guidesFor(guides, "pune").every((g) => g.scope === "india")).toBe(true);
    expect(CITY_STATE.jaipur).toBe("rajasthan");
  });
});
