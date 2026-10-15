import type { CreateEntityParameters, PublicArkivClient, WalletArkivClient } from "@arkiv-network/sdk";
import { getAddress, type Address, type Hex } from "viem";

/**
 * The owner a locked entry is handed to: the conventional burn address, whose key nobody holds. Only
 * an entity's owner can delete it, so after the handover nobody can, not even the worker who wrote it.
 */
export const NOBODY: Address = getAddress("0x000000000000000000000000000000000000dEaD");

export const isLocked = (owner: string) => owner.toLowerCase() === NOBODY.toLowerCase();

type Predictor = Pick<PublicArkivClient, "predictEntityKeys">;
type Batcher = Pick<WalletArkivClient, "executeBatch">;

/**
 * Creates an entry and hands its ownership to {@link NOBODY} in the same transaction.
 *
 * Why a worker would want this: an entry its author can delete is an entry the author can be
 * pressured to delete ("remove that report or stay blocked"). A locked entry still expires on the
 * lifetime the worker chose, and anyone may still extend it; what nobody can do any more is end it
 * early.
 *
 * The create carries a predicted key's salt so the transfer in the same batch can name it. Batches
 * are atomic: if the prediction were wrong (another write from this wallet landed first), the
 * transfer would fail and the create with it, so an unlocked copy is never left behind.
 */
export async function createLocked(reader: Predictor, wallet: Batcher, owner: Address, params: CreateEntityParameters): Promise<{ entityKey: Hex; txHash: Hex }> {
  const [predicted] = await reader.predictEntityKeys({ owner, count: 1 });
  const result = await wallet.executeBatch({
    creates: [{ ...params, salt: predicted.salt }],
    ownershipChanges: [{ entityKey: predicted.key, newOwner: NOBODY }],
  });
  const entityKey = result.createdEntities[0];
  if (!entityKey || entityKey.toLowerCase() !== predicted.key.toLowerCase() || !result.ownershipChanges.some((k) => k.toLowerCase() === predicted.key.toLowerCase())) {
    throw new Error("The lock transaction did not report the expected entry; check it on the explorer before relying on it.");
  }
  return { entityKey, txHash: result.txHash };
}
