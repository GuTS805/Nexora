import { describe, expect, it } from "vitest";
import { getAddress, type Hex } from "viem";
import {
  comboStats, confidence, decodeExperiment, decodeTrustList, experimentCreate, experimentPredicate,
  parseExperimentsCsv, CSV_TEMPLATE, queryText, roiPct, seal, spendBand, suggest, trustListCreate,
  unseal, type ExperimentInput, type RawEntity,
} from "../src/index.ts";

const ALICE = getAddress("0x1111111111111111111111111111111111111111");
const BOB = getAddress("0x2222222222222222222222222222222222222222");
const KEY = `0x${"ab".repeat(32)}` as Hex;

const input: ExperimentInput = {
  category: "tea_coffee", platform: "instagram", format: "reel", lang: "hinglish", tier: "tier2",
  season: "diwali", tone: "festive", cta: "whatsapp_us", offer: "combo",
  spendInr: 3_500, revenueInr: 9_100, days: 7, expiresInDays: 30,
};

/** Simulates what the node hands back for an entity created with `params`. */
function asStored(params: ReturnType<typeof experimentCreate>, creator = ALICE, key = KEY): RawEntity {
  return {
    key, creator, owner: creator, expiresAt: 1_000_000n, createdAt: 10n,
    creationFlags: { readonly: true, permissionlessExtension: true },
    contentType: params.contentType, payload: params.payload,
    attributes: params.attributes as RawEntity["attributes"],
  };
}

describe("banding keeps exact figures off-chain", () => {
  it("bands spend and rounds roi", () => {
    expect(spendBand(499)).toBe(0);
    expect(spendBand(500)).toBe(1);
    expect(spendBand(3_500)).toBe(2);
    expect(spendBand(250_000)).toBe(5);
    expect(roiPct(3_500, 9_100)).toBe(160);
    expect(roiPct(1_000, 0)).toBe(-100);
    expect(roiPct(100, 1_000_000)).toBe(1000);
  });

  it("never writes rupee amounts into attributes or the public payload", () => {
    const params = experimentCreate(input);
    const publicText = JSON.stringify(params.attributes) + new TextDecoder().decode(params.payload);
    expect(publicText).not.toContain("3500");
    expect(publicText).not.toContain("9100");
    expect(params.flags).toEqual({ readonly: true, permissionlessExtension: true });
  });
});

describe("codec round trip and validation", () => {
  it("decodes what it encodes", () => {
    const decoded = decodeExperiment(asStored(experimentCreate({ ...input, parent: KEY })));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value).toMatchObject({ category: "tea_coffee", spendBand: 2, roiPct: 160, parent: KEY, demo: false, creator: ALICE });
  });

  it("rejects an entity whose attributes were hand-written outside the vocabulary", () => {
    const raw = asStored(experimentCreate(input));
    raw.attributes = { ...raw.attributes, category: { type: "str", value: "Ramesh Tea Stall, MG Road" } };
    expect(decodeExperiment(raw)).toMatchObject({ ok: false, reason: "bad category" });
  });

  it("rejects off-grid roi and wrong attribute types", () => {
    const raw = asStored(experimentCreate(input));
    raw.attributes = { ...raw.attributes, roi_pct: { type: "i32", value: 163 } };
    expect(decodeExperiment(raw).ok).toBe(false);
    raw.attributes = { ...raw.attributes, roi_pct: { type: "str", value: "160" } };
    expect(decodeExperiment(raw).ok).toBe(false);
  });

  it("refuses invalid inputs before they reach the chain", () => {
    expect(() => experimentCreate({ ...input, spendInr: 0 })).toThrow();
    expect(() => experimentCreate({ ...input, days: 400 })).toThrow();
    expect(() => experimentCreate({ ...input, platform: "myspace" as never })).toThrow();
  });
});

describe("sealing", () => {
  it("round trips and fails closed on a wrong passphrase or tampering", async () => {
    const box = await seal({ spendInr: 3_500, revenueInr: 9_100, orders: 41, note: "combo pack" }, "correct horse battery");
    expect(await unseal(box, "correct horse battery")).toMatchObject({ orders: 41 });
    await expect(unseal(box, "wrong passphrase!")).rejects.toThrow(/Wrong passphrase/);
    const tampered = { ...box, ct: box.ct.slice(0, -4) + (box.ct.endsWith("AAAA") ? "BBBB" : "AAAA") };
    await expect(unseal(tampered, "correct horse battery")).rejects.toThrow();
    await expect(seal({ spendInr: 1, revenueInr: 1 }, "short")).rejects.toThrow();
  });

  it("carries a sealed box through the codec", async () => {
    const sealed = await seal({ spendInr: 3_500, revenueInr: 9_100 }, "correct horse battery");
    const decoded = decodeExperiment(asStored(experimentCreate({ ...input, sealed })));
    expect(decoded.ok && decoded.value.sealed?.alg).toBe("AES-256-GCM");
  });
});

describe("queries", () => {
  it("filters authorship with $creator and hides demo rows by default", () => {
    const text = queryText(experimentPredicate({ category: "tea_coffee", creators: [ALICE, BOB], minRoi: 0 }));
    expect(text).toContain("category = str('tea_coffee')");
    expect(text).toContain("$creator");
    expect(text).toContain("demo = false");
    expect(text).toContain("roi_pct >= i32(0)");
  });

  it("includes demo rows when asked", () => {
    expect(queryText(experimentPredicate({ includeDemo: true }))).not.toContain("demo");
  });
});

describe("insights", () => {
  const make = (creator: typeof ALICE, platform: ExperimentInput["platform"], roi: number, i: number) => {
    const params = experimentCreate({ ...input, platform, spendInr: 1_000, revenueInr: 1_000 + roi * 10 });
    const decoded = decodeExperiment(asStored(params, creator, `0x${i.toString(16).padStart(64, "0")}` as Hex));
    if (!decoded.ok) throw new Error(decoded.reason);
    return decoded.value;
  };

  it("one wallet spamming rows is dampened and never suggested as proven", () => {
    const spam = Array.from({ length: 30 }, (_, i) => make(ALICE, "sharechat", 900, i));
    const honest = [make(ALICE, "instagram", 200, 100), make(BOB, "instagram", 200, 101)];
    const spamCombo = comboStats([...spam, ...honest]).find((c) => c.platform === "sharechat");
    expect(spamCombo?.publishers).toBe(1);
    expect(spamCombo?.score).toBe(Math.round(900 * confidence(1)));
    const proven = suggest([...spam, ...honest]).filter((s) => s.kind === "proven");
    expect(proven.map((s) => s.kind === "proven" && s.combo.platform)).toEqual(["instagram"]);
    expect(confidence(5)).toBeGreaterThan(confidence(1));
  });

  it("suggests proven combos plus one exploration", () => {
    const rows = [make(ALICE, "instagram", 200, 1), make(BOB, "instagram", 150, 2), make(BOB, "whatsapp", 50, 3)];
    const suggestions = suggest(rows);
    expect(suggestions[0]).toMatchObject({ kind: "proven" });
    expect(suggestions.at(-1)?.kind).toBe("explore");
  });
});

describe("trust lists and csv", () => {
  it("round trips a trust list and dedupes members", () => {
    const params = trustListCreate({ name: "Jaipur crafts collective", scope: "handicrafts", description: "", members: [ALICE, ALICE.toLowerCase() as typeof ALICE, BOB] });
    const decoded = decodeTrustList({ key: KEY, creator: ALICE, owner: ALICE, expiresAt: 1n, payload: params.payload, attributes: params.attributes as RawEntity["attributes"] });
    expect(decoded.ok && decoded.value.members).toEqual([ALICE, BOB]);
  });

  it("parses the template and reports bad rows by line", () => {
    const ok = parseExperimentsCsv(CSV_TEMPLATE, 30);
    expect(ok.rows).toHaveLength(2);
    const bad = parseExperimentsCsv(CSV_TEMPLATE + "tea_coffee,myspace,reel,hi,tier2,none,festive,shop_now,none,100,200,3\n", 30);
    expect(bad.errors[0]?.line).toBe(4);
  });
});
