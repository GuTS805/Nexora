/**
 * Runs every write shape the app produces through the real SDK (0.8.1) up to the point of sending:
 * operations are validated, encoded, the transaction is built and signed locally, and a mock RPC
 * captures `eth_sendRawTransaction`. Reaching that call proves the SDK accepted our parameters —
 * attribute names and types, payload size, content type, creation flags, expiry resolution and
 * patch mutations — without needing a funded wallet or a live node.
 */
import { ExpirationTime, createWalletClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { custom, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { experimentCreate, seal, trustListCreate, trustListPatch, type ExperimentInput } from "../src/index.ts";

// Anvil's well-known test key #0: public, never funded on Tiramisu, used only to sign locally.
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const KEY = `0x${"cd".repeat(32)}` as Hex;

class Sent extends Error {
  constructor(readonly raw: Hex) {
    super("captured eth_sendRawTransaction");
  }
}

const calls: string[] = [];
const transport = custom({
  async request({ method }: { method: string; params?: unknown }) {
    calls.push(method);
    switch (method) {
      case "eth_chainId": return `0x${tiramisu.id.toString(16)}`;
      case "eth_blockNumber": return "0x100000";
      case "eth_getTransactionCount": return "0x0";
      case "eth_estimateGas": return "0x200000";
      case "eth_gasPrice": return "0x3b9aca00";
      case "eth_maxPriorityFeePerGas": return "0x1";
      case "eth_getBlockByNumber": return { baseFeePerGas: "0x7", number: "0x100000", timestamp: "0x0", transactions: [] };
      case "eth_sendRawTransaction": throw new Sent("0x");
      default: throw new Error(`unexpected RPC ${method}`);
    }
  },
});
const wallet = createWalletClient({ chain: tiramisu, transport, account });

const input: ExperimentInput = {
  category: "sarees_textiles", platform: "meesho", format: "listing_boost", lang: "hinglish", tier: "tier3",
  season: "wedding", tone: "festive", cta: "shop_now", offer: "cod", spendInr: 6_000, revenueInr: 15_000,
  days: 10, expiresInDays: 90, demo: true,
};

/** Resolves when the SDK got as far as sending; rejects with the SDK's own error otherwise. */
async function reachesSend(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    for (let e = error as { cause?: unknown } | undefined, depth = 0; e && depth < 8; e = e.cause as typeof e, depth++) {
      if (e instanceof Sent) return true;
    }
    throw error;
  }
  throw new Error("transaction unexpectedly completed against a mock");
}

describe("SDK accepts every write the app sends", () => {
  it("createEntity: one experiment, with lineage and a sealed payload", async () => {
    const sealed = await seal({ spendInr: 6_000, revenueInr: 15_000, orders: 30 }, "correct horse battery");
    await expect(reachesSend(() => wallet.createEntity(experimentCreate({ ...input, parent: KEY, sealed })))).resolves.toBe(true);
    expect(calls).toContain("eth_sendRawTransaction");
  });

  it("executeBatch: 20 creates in one transaction (CSV import / seed)", async () => {
    const creates = Array.from({ length: 20 }, (_, i) => experimentCreate({ ...input, spendInr: 1_000 + i }));
    await expect(reachesSend(() => wallet.executeBatch({ creates }))).resolves.toBe(true);
  });

  it("createEntity + patchEntity: trust list created, then edited with set mutations", async () => {
    const list = { name: "Surat saree resellers", scope: "sarees_textiles" as const, description: "demo", members: [account.address, getAddress("0x2222222222222222222222222222222222222222")] };
    await expect(reachesSend(() => wallet.createEntity(trustListCreate(list)))).resolves.toBe(true);
    await expect(reachesSend(() => wallet.patchEntity(trustListPatch(KEY, list)))).resolves.toBe(true);
  });

  it("extendEntity: keep-alive as an absolute deadline after the current expiry", async () => {
    await expect(reachesSend(() => wallet.extendEntity({ entityKey: KEY, expires: ExpirationTime.atBlock(0x100000n + 30n * 43_200n) }))).resolves.toBe(true);
  });

  it("deleteEntity and batch deletes", async () => {
    await expect(reachesSend(() => wallet.deleteEntity({ entityKey: KEY }))).resolves.toBe(true);
    await expect(reachesSend(() => wallet.executeBatch({ deletes: [{ entityKey: KEY }, { entityKey: `0x${"ef".repeat(32)}` as Hex }] }))).resolves.toBe(true);
  });

  it("SDK itself rejects a deadline that is not in the future (dead on arrival)", async () => {
    await expect(reachesSend(() => wallet.extendEntity({ entityKey: KEY, expires: ExpirationTime.atBlock(0x10n) }))).rejects.toThrow(/dead on arrival|not after the current block/);
  });
});
