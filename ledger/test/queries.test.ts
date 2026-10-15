import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  EXPLORER, MAX_OR_BRANCHES, blockToDate, entryPredicate, explorerAddress, explorerEntity, explorerTx, fetchEntries, fetchEntry,
  getEntityOrNull, incidentCreate, incidentPredicate, queryText, shiftCreate, shiftPredicate, trustListPredicate,
} from "../src/index.ts";
import { ALICE, BOB, KEY, asStored, incident, keyOf, shift } from "./fixtures.ts";

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

  it("lists trust lists, optionally by one curator, and builds explorer links", () => {
    expect(queryText(trustListPredicate())).toContain("kind = str('trust_list')");
    expect(queryText(trustListPredicate(ALICE))).toContain("$creator");
    expect(explorerEntity(KEY)).toBe(`${EXPLORER}/entity/${KEY}`);
    expect(explorerTx(KEY)).toBe(`${EXPLORER}/tx/${KEY}`);
    expect(explorerAddress(ALICE)).toBe(`${EXPLORER}/address/${ALICE}`);
  });

  it("refuses empty creator or key filters instead of silently matching everyone", () => {
    expect(() => shiftPredicate({ creators: [] })).toThrow(/empty/);
    expect(() => entryPredicate({ keys: [] })).toThrow(/empty/);
  });

  it("estimates a future block's date at two seconds per block", () => {
    expect(blockToDate(1_000n + 43_200n, 1_000n, 0).getTime()).toBe(86_400_000);
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
