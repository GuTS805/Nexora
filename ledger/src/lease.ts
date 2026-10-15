import { TRUST_LIST_DAYS } from "./schema.ts";

/** Blocks per day at Arkiv's nominal 2 s block time. */
export const BLOCKS_PER_DAY = 43_200;

/**
 * A trust list is a lease. Vouching for workers should lapse when the group behind it stops
 * curating, or no longer exists, instead of vouching forever. So a list lives TRUST_LIST_DAYS from
 * when its curator last renewed it, and only the curator can renew it (the list is created without
 * permissionless extension).
 *
 * Returns the block to renew to, TRUST_LIST_DAYS from `currentBlock`, or null when that would not
 * move the expiry later (the list was just created or just renewed): the node reverts an extension
 * that does not extend.
 */
export function trustRenewal(expiresAt: bigint, currentBlock: bigint): bigint | null {
  const target = currentBlock + BigInt(TRUST_LIST_DAYS * BLOCKS_PER_DAY);
  return target > expiresAt ? target : null;
}
