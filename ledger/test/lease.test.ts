import { describe, expect, it } from "vitest";
import { BLOCKS_PER_DAY, TRUST_LIST_DAYS, trustRenewal } from "../src/index.ts";

const LEASE = BigInt(TRUST_LIST_DAYS * BLOCKS_PER_DAY);

describe("trust list lease", () => {
  it("renewing sets the expiry to a full lease from now", () => {
    const now = 1_000_000n;
    // Created 10 days ago, so 170 days are left.
    const expiresAt = now - 10n * BigInt(BLOCKS_PER_DAY) + LEASE;
    expect(trustRenewal(expiresAt, now)).toBe(now + LEASE);
  });

  it("offers no renewal that would not move the expiry later, because the node reverts it", () => {
    const now = 1_000_000n;
    expect(trustRenewal(now + LEASE, now)).toBeNull();
    expect(trustRenewal(now + LEASE + 5n, now)).toBeNull();
    expect(trustRenewal(now + LEASE - 1n, now)).toBe(now + LEASE);
  });
});
