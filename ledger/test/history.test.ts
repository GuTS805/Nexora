import { describe, expect, it } from "vitest";
import { blockAtDate, entityKeyPredicate, memberChanges } from "../src/index.ts";

/** A chain whose first `slow` blocks came every 6 s and the rest every 2 s, like Tiramisu's. */
function chain(head: bigint, slow: bigint, start = 1_756_915_670n) {
  const ts = (n: bigint) => (n <= slow ? start + n * 6n : start + slow * 6n + (n - slow) * 2n);
  const calls = { n: 0 };
  return {
    calls,
    ts,
    getBlock: async (args?: { blockNumber: bigint }) => {
      calls.n++;
      const number = args?.blockNumber ?? head;
      return { number, timestamp: ts(number) };
    },
  };
}

describe("blockAtDate", () => {
  it("finds the last block at or before a time, over uneven block times, in few calls", async () => {
    const c = chain(623_688n, 400_000n);
    for (const n of [0n, 1n, 399_999n, 400_000n, 400_001n, 580_118n, 623_687n]) {
      c.calls.n = 0;
      expect(await blockAtDate(c, new Date(Number(c.ts(n)) * 1_000))).toBe(n);
      // A moment later is still the same block until the next one is made.
      expect(await blockAtDate(c, new Date(Number(c.ts(n)) * 1_000 + 1_500))).toBe(n);
      expect(c.calls.n).toBeLessThan(90);
    }
  });

  it("answers the head for now or later, and null before the chain began", async () => {
    const c = chain(623_688n, 400_000n);
    expect(await blockAtDate(c, new Date(Number(c.ts(623_688n)) * 1_000 + 60_000))).toBe(623_688n);
    expect(await blockAtDate(c, new Date(Number(c.ts(0n)) * 1_000 - 1_000))).toBeNull();
  });
});

describe("history helpers", () => {
  it("looks an entity up by key with the same text getEntity sends", () => {
    const key = `0x${"ab".repeat(32)}` as const;
    expect(entityKeyPredicate(key).toString()).toBe(`$key = key(${key})`);
  });

  it("reports who joined and who left a list, ignoring address case", () => {
    const a = "0x00000000000000000000000000000000000000Aa" as const;
    const b = "0x00000000000000000000000000000000000000bB" as const;
    const c = "0x00000000000000000000000000000000000000cc" as const;
    expect(memberChanges([a, b], [b.toLowerCase() as typeof b, c])).toEqual({ added: [c], removed: [a] });
  });
});
