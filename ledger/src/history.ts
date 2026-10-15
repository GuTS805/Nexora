import type { PublicArkivClient } from "@arkiv-network/sdk";
import { key as keyAttr } from "@arkiv-network/sdk/attr";
import { eq } from "@arkiv-network/sdk/query";
import type { Address, Hex } from "viem";
import type { RawEntity } from "./codec.ts";

/**
 * Reads at a past block. Arkiv answers a query as of any block the node retains, so anyone can show
 * what was on record at a given time: that a report was public before a platform says it was raised,
 * or which workers a union vouched for when a figure was confirmed.
 *
 * The same holds for entries that were later deleted or that expired: deleting removes an entity
 * from the current state, not from history. Readers here only ever see what was published, which
 * is why the public part of every entry is banded and exact figures are sealed.
 */

/** The query that finds one entity by key; the same text `getEntity` sends, so read relays accept it. */
export const entityKeyPredicate = (entityKey: Hex) => eq("$key", keyAttr(entityKey));

/** An entity as it stood at `block`, or `null` if it did not exist then (not yet created, deleted or expired). */
export async function entityAtBlock(client: PublicArkivClient, entityKey: Hex, block: bigint): Promise<RawEntity | null> {
  const page = await client.select("*").where(entityKeyPredicate(entityKey)).atBlock(block).limit(1).fetch();
  return (page.entities[0] as unknown as RawEntity | undefined) ?? null;
}

type BlockReader = { getBlock: (args?: { blockNumber: bigint }) => Promise<{ number: bigint | null; timestamp: bigint }> };

/**
 * The last block at or before `date`, or `null` if the chain did not exist yet. Block times are not
 * constant (Tiramisu's early blocks came about every 6 s, recent ones every 2 s), so this searches
 * block timestamps instead of assuming a rate: interpolation first, halving whenever a step fails
 * to shrink the range by half, which keeps it to a few dozen cheap `eth_getBlockByNumber` calls.
 */
export async function blockAtDate(client: BlockReader, date: Date): Promise<bigint | null> {
  const target = BigInt(Math.floor(date.getTime() / 1_000));
  const head = await client.getBlock();
  const headNumber = head.number ?? 0n;
  if (target >= head.timestamp) return headNumber;
  let lo = 0n;
  let loTs = (await client.getBlock({ blockNumber: 0n })).timestamp;
  if (target < loTs) return null;
  let hi = headNumber;
  let hiTs = head.timestamp;
  // Invariant: ts(lo) <= target < ts(hi).
  let bisect = false;
  while (hi - lo > 1n) {
    const width = hi - lo;
    let mid = bisect || hiTs === loTs ? lo + width / 2n : lo + ((target - loTs) * width) / (hiTs - loTs);
    if (mid <= lo) mid = lo + 1n;
    if (mid >= hi) mid = hi - 1n;
    const ts = (await client.getBlock({ blockNumber: mid })).timestamp;
    if (ts <= target) {
      lo = mid;
      loTs = ts;
    } else {
      hi = mid;
      hiTs = ts;
    }
    bisect = (hi - lo) * 2n > width;
  }
  return lo;
}

/** Who joined and who left a member list between two readings. */
export function memberChanges(before: readonly Address[], after: readonly Address[]): { added: Address[]; removed: Address[] } {
  const lower = (list: readonly Address[]) => new Set(list.map((a) => a.toLowerCase()));
  const was = lower(before);
  const now = lower(after);
  return { added: after.filter((a) => !was.has(a.toLowerCase())), removed: before.filter((a) => !now.has(a.toLowerCase())) };
}
