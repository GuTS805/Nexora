import { TRUST_LIST_DAYS } from "./schema.ts";

/** Blocks per day at Arkiv's nominal 2 s block time. */
export const BLOCKS_PER_DAY = 43_200;

/**
 * Any entity used as a lease: it lives `days` from when its owner last renewed it. Returns the block
 * to renew to (`extendEntity` with `ExpirationTime.atBlock(target)`), or null when that would not
 * move the expiry later: the node reverts an extension that would shorten the entity's life and
 * accepts, and charges gas for, one that changes nothing (friction F11). Nothing here is
 * specific to Nexora; it fits any Arkiv entity that should lapse unless someone keeps renewing it.
 */
export function leaseRenewal(expiresAt: bigint, currentBlock: bigint, days: number): bigint | null {
  if (!Number.isInteger(days) || days <= 0) throw new Error("A lease needs a whole, positive number of days.");
  const target = currentBlock + BigInt(days * BLOCKS_PER_DAY);
  return target > expiresAt ? target : null;
}

/**
 * A trust list is a lease. Vouching for workers should lapse when the group behind it stops
 * curating, or no longer exists, instead of vouching forever. So a list lives TRUST_LIST_DAYS from
 * when its curator last renewed it, and only the curator can renew it (the list is created without
 * permissionless extension).
 *
 * Returns the block to renew to, TRUST_LIST_DAYS from `currentBlock`, or null when that would not
 * move the expiry later (the list was just created or just renewed), so a curator never pays for a
 * renewal that adds no time.
 */
export function trustRenewal(expiresAt: bigint, currentBlock: bigint): bigint | null {
  return leaseRenewal(expiresAt, currentBlock, TRUST_LIST_DAYS);
}
