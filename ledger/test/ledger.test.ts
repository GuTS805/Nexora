import { afterEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Hex } from "viem";
import {
  CSV_TEMPLATE, MAX_OR_BRANCHES, PLATFORM_WORK, comparePlatforms, confidence, costPct, decodeEntry, decodeIncident,
  decodeShift, decodeTrustList, earningsStats, entryPredicate, explainError, fetchEntries, fetchEntry, getEntityOrNull,
  hoursBand, incidentCreate, incidentPredicate, incidentStats, isRateLimited, resolvedReports, monthChange, netHourly, parseShiftsCsv,
  previousPeriod, queryText, seal, shiftCreate, shiftPredicate, trustListCreate, trustListPatch, unseal, withReadFallback,
  type IncidentInput, type RawEntity, type ShiftInput,
} from "../src/index.ts";

const ALICE = getAddress("0x1111111111111111111111111111111111111111");
const BOB = getAddress("0x2222222222222222222222222222222222222222");
const KEY = `0x${"ab".repeat(32)}` as Hex;

const shift: ShiftInput = {
  platform: "swiggy", work: "food_delivery", city: "bengaluru", vehicle: "petrol_bike", period: 202610,
  grossInr: 1_180, costsInr: 240, hours: 10, incentive: "met", expiresInDays: 90,
};

const incident: IncidentInput = {
  platform: "zomato", work: "food_delivery", city: "delhi_ncr", type: "id_blocked", period: 202610,
  daysLost: 4, reasonGiven: false, appealed: true, resolved: false, expiresInDays: 365,
};

/** Simulates what the node hands back for an entity created with `params`. */
function asStored(params: ReturnType<typeof shiftCreate>, creator = ALICE, key = KEY): RawEntity {
  return {
    key, creator, owner: creator, expiresAt: 1_000_000n, createdAt: 10n,
    creationFlags: { readonly: true, permissionlessExtension: true },
    contentType: params.contentType, payload: params.payload,
    attributes: params.attributes as RawEntity["attributes"],
  };
}

const keyOf = (i: number) => `0x${i.toString(16).padStart(64, "0")}` as Hex;

function storedShift(overrides: Partial<ShiftInput>, creator = ALICE, i = 1) {
  const decoded = decodeShift(asStored(shiftCreate({ ...shift, ...overrides }), creator, keyOf(i)));
  if (!decoded.ok) throw new Error(decoded.reason);
  return decoded.value;
}

function storedIncident(overrides: Partial<IncidentInput>, creator = ALICE, i = 1) {
  const decoded = decodeIncident(asStored(incidentCreate({ ...incident, ...overrides }), creator, keyOf(i)));
  if (!decoded.ok) throw new Error(decoded.reason);
  return decoded.value;
}

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

describe("sealing", () => {
  it("round trips and fails closed on a wrong passphrase or tampering", async () => {
    const box = await seal({ grossInr: 1_180, costsInr: 240, hours: 10, orders: 17, note: "rain, two long waits" }, "correct horse battery");
    expect(await unseal(box, "correct horse battery")).toMatchObject({ orders: 17, hours: 10 });
    await expect(unseal(box, "wrong passphrase!")).rejects.toThrow(/Wrong passphrase/);
    const tampered = { ...box, ct: box.ct.slice(0, -4) + (box.ct.endsWith("AAAA") ? "BBBB" : "AAAA") };
    await expect(unseal(tampered, "correct horse battery")).rejects.toThrow();
    await expect(seal({ grossInr: 1 }, "short")).rejects.toThrow();
  });

  it("carries a sealed box through the codec", async () => {
    const sealed = await seal({ grossInr: 1_180 }, "correct horse battery");
    expect(storedShift({ sealed }).sealed?.alg).toBe("AES-256-GCM");
  });
});

describe("queries", () => {
  it("filters authorship with $creator and hides demo rows by default", () => {
    const text = queryText(shiftPredicate({ city: "bengaluru", creators: [ALICE, BOB], minPeriod: 202608 }));
    expect(text).toContain("kind = str('shift')");
    expect(text).toContain("city = str('bengaluru')");
    expect(text).toContain("$creator");
    expect(text).toContain("demo = false");
    expect(text).toContain("period >= i32(202608)");
  });

  it("includes demo rows when asked, and queries both entry kinds together", () => {
    expect(queryText(incidentPredicate({ includeDemo: true }))).not.toContain("demo");
    const both = queryText(entryPredicate({ includeDemo: true }));
    expect(both).toContain("kind = str('shift')");
    expect(both).toContain("kind = str('incident')");
  });

  // Limits measured on Tiramisu (friction F4): > 64 predicates or > 8192 bytes is refused.
  it("keeps the heaviest filter inside the node's predicate and length limits", () => {
    const many = Array.from({ length: MAX_OR_BRANCHES }, (_, i) => getAddress(`0x${(i + 1).toString(16).padStart(40, "f")}`));
    const keys = Array.from({ length: MAX_OR_BRANCHES }, (_, i) => keyOf(i + 1));
    for (const text of [
      queryText(shiftPredicate({ platform: "swiggy", work: "food_delivery", city: "bengaluru", vehicle: "ev_scooter", minPeriod: 202601, maxPeriod: 202612, minHourly: 0, creators: many })),
      queryText(incidentPredicate({ platform: "swiggy", work: "food_delivery", city: "bengaluru", type: "pay_cut", minPeriod: 202601, maxPeriod: 202612, parent: KEY, creators: many })),
      queryText(entryPredicate({ creators: many, keys })),
    ]) {
      expect(text.match(/\s(?:=|>=|<=)\s/g)?.length ?? 0).toBeLessThanOrEqual(64);
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(8192);
    }
    expect(() => shiftPredicate({ creators: [...many, ALICE] })).toThrow(/At most/);
  });

  it("splits a long creator list into several queries and merges the results", async () => {
    const creators = Array.from({ length: 60 }, (_, i) => getAddress(`0x${(i + 1).toString(16).padStart(40, "0")}`));
    const seenQueries: string[] = [];
    const client = {
      select: () => ({
        where: (expression: { toString(): string }) => ({
          limit: () => ({
            fetch: async () => {
              seenQueries.push(expression.toString());
              const n = seenQueries.length;
              const entity = n === 2 ? asStored(incidentCreate(incident), creators[n - 1], keyOf(n)) : asStored(shiftCreate(shift), creators[n - 1], keyOf(n));
              return { entities: [entity], blockNumber: BigInt(100 + n), hasNextPage: () => false };
            },
          }),
        }),
      }),
    } as unknown as Parameters<typeof fetchEntries>[0];
    const result = await fetchEntries(client, { creators, includeDemo: true });
    expect(seenQueries).toHaveLength(3);
    expect(seenQueries.every((q) => (q.match(/\$creator/g)?.length ?? 0) <= MAX_OR_BRANCHES)).toBe(true);
    expect(result.items.map((e) => e.kind)).toEqual(["shift", "incident", "shift"]);
    expect(result.blockNumber).toBe(103n);
    expect(result.query.split("\n")).toHaveLength(3);
  });
});

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
});

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
});

describe("read fallback transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends arkiv_query to the fallback only after a 429, and keeps other calls direct", async () => {
    const direct = vi.fn(async (_url: string, init: RequestInit) => {
      const { method, id } = JSON.parse(init.body as string) as { method: string; id: number };
      if (method === "arkiv_query") return new Response("{}", { status: 429, headers: { "retry-after": "1200" } });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: "0x10" }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", direct);
    const fallback = vi.fn(async (_url: string) => new Response(JSON.stringify({ result: { data: [], blockNumber: "0x10" } })));
    const transport = withReadFallback("https://rpc.example", "https://app.example/api/read", fallback as unknown as typeof fetch)({});

    await expect(transport.request({ method: "arkiv_query", params: ["v = i32(1)", { limit: 1 }] })).resolves.toEqual({ data: [], blockNumber: "0x10" });
    expect(fallback.mock.calls[0]![0]).toBe(`https://app.example/api/read?q=${encodeURIComponent(JSON.stringify(["v = i32(1)", { limit: 1 }]))}`);

    // Inside the Retry-After window the next query skips the exhausted RPC entirely.
    const directQueries = () => direct.mock.calls.filter(([, init]) => (init.body as string).includes("arkiv_query")).length;
    const before = directQueries();
    await transport.request({ method: "arkiv_query", params: ["v = i32(2)"] });
    expect(directQueries()).toBe(before);
    expect(fallback).toHaveBeenCalledTimes(2);

    // Balance-style calls never use the fallback.
    await expect(transport.request({ method: "eth_blockNumber" })).resolves.toBe("0x10");
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it("reports an exhausted fallback as the rate limit, not a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "60" } })));
    const fallback = vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "60" } }));
    const transport = withReadFallback("https://rpc.example", "https://app.example/api/read", fallback as unknown as typeof fetch)({});
    const error = await transport.request({ method: "arkiv_query", params: ["v = i32(1)"] }).catch((e: unknown) => e);
    expect(isRateLimited(error)).toBe(true);
  });

  it("on a host without the endpoint, shows the rate limit rather than a 404, but relays real node errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "900" } })));
    const missing = withReadFallback("https://rpc.example", "https://mirror.example/api/read", (async () => new Response("<html>404</html>", { status: 404 })) as unknown as typeof fetch)({});
    const error = await missing.request({ method: "arkiv_query", params: ["v = i32(1)"] }).catch((e: unknown) => e);
    expect(isRateLimited(error)).toBe(true);
    expect(explainError(error)).toMatch(/resets in about 15 min/);

    const relaying = withReadFallback("https://rpc.example", "https://app.example/api/read", (async () => new Response(JSON.stringify({ error: { message: "query is too long" } }))) as unknown as typeof fetch)({});
    await expect(relaying.request({ method: "arkiv_query", params: ["v = i32(1)"] })).rejects.toThrow("query is too long");
  });
});

describe("missing entities", () => {
  const client = (error: Error) => ({ getEntity: async () => { throw error; } }) as unknown as Parameters<typeof fetchEntry>[0];
  const notFound = Object.assign(new Error("no entity"), { name: "NoEntityFoundError" });

  it("treats an expired or deleted entity as a decode failure, not an exception", async () => {
    expect(await getEntityOrNull(client(notFound), KEY)).toBeNull();
    expect(await fetchEntry(client(notFound), KEY)).toMatchObject({ ok: false, reason: expect.stringMatching(/expired, deleted/) });
  });

  it("still surfaces real failures such as the rate limit", async () => {
    await expect(getEntityOrNull(client(new Error("HTTP 429")), KEY)).rejects.toThrow("429");
  });
});
