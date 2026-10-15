import type { Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { NOBODY, createLocked, incidentCreate, isLocked } from "../src/index.ts";
import { ALICE, incident, keyOf } from "./fixtures.ts";

const PREDICTED = keyOf(42);

function clients(created: Hex[] = [PREDICTED], transferred: Hex[] = [PREDICTED]) {
  const reader = { predictEntityKeys: vi.fn(async () => [{ key: PREDICTED, salt: 7n }]) };
  const wallet = { executeBatch: vi.fn(async () => ({ txHash: keyOf(1), createdEntities: created, ownershipChanges: transferred, patchedEntities: [], deletedEntities: [], extendedEntities: [] })) };
  return { reader, wallet };
}

describe("locking an entry so nobody can delete it early", () => {
  it("creates with the predicted salt and hands that key to 0x…dEaD in the same batch", async () => {
    const { reader, wallet } = clients();
    const params = incidentCreate(incident);
    const result = await createLocked(reader as never, wallet as never, ALICE, params);
    expect(reader.predictEntityKeys).toHaveBeenCalledWith({ owner: ALICE, count: 1 });
    expect(wallet.executeBatch).toHaveBeenCalledTimes(1);
    const batch = (wallet.executeBatch.mock.calls[0] as unknown[])[0] as { creates: { salt: bigint }[]; ownershipChanges: { entityKey: Hex; newOwner: Hex }[] };
    expect(batch.creates).toHaveLength(1);
    expect(batch.creates[0]).toMatchObject({ ...params, salt: 7n });
    expect(batch.ownershipChanges).toEqual([{ entityKey: PREDICTED, newOwner: NOBODY }]);
    expect(result).toEqual({ entityKey: PREDICTED, txHash: keyOf(1) });
  });

  it("refuses to report success if the transaction did not create and transfer the predicted entry", async () => {
    for (const [created, transferred] of [[[keyOf(9)], [keyOf(9)]], [[PREDICTED], []], [[], []]] as Hex[][][]) {
      const { reader, wallet } = clients(created, transferred);
      await expect(createLocked(reader as never, wallet as never, ALICE, incidentCreate(incident))).rejects.toThrow(/expected entry/);
    }
  });

  it("recognises the burn owner in any letter case, and nothing else", () => {
    expect(NOBODY).toBe("0x000000000000000000000000000000000000dEaD");
    expect(isLocked(NOBODY.toLowerCase())).toBe(true);
    expect(isLocked(ALICE)).toBe(false);
    expect(isLocked("0x000000000000000000000000000000000000dEaE")).toBe(false);
  });
});
