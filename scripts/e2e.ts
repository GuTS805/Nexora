/**
 * End-to-end check against Tiramisu. Measures what the friction report needs and writes the results
 * to arkiv/e2e-report.md:
 *
 *   gas for one create and for a 20-entity batch · read-after-write latency · a 25-branch $creator
 *   OR query · extend semantics (F2) · refused patch on readonly · delete then read
 *
 *   npm run e2e      (uses NEXORA_SEED_KEY_1; everything it creates is demo=true with a 7-day life
 *                     and is deleted at the end)
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ExpirationTime, createWalletClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { formatEther, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  MAX_BATCH, arkivHttp, defaultRpcUrl, experimentCreate, explainError, experimentPredicate, fetchExperiment,
  fetchExperiments, readClient, type ExperimentInput,
} from "../ledger/src/index.ts";
import { SEED_KEY_NAMES, loadEnv, requireKey } from "./env.ts";

loadEnv();
const client = readClient();
const account = privateKeyToAccount(requireKey(SEED_KEY_NAMES[0]));
const wallet = createWalletClient({ chain: tiramisu, transport: arkivHttp(), account });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const row = (i: number, days: ExperimentInput["expiresInDays"] = 7): ExperimentInput => ({
  category: "tea_coffee", platform: "whatsapp", format: "status", lang: "hi", tier: "tier3", season: "none",
  tone: "testimonial", cta: "whatsapp_us", offer: "cod", spendInr: 1_000 + i, revenueInr: 2_000 + i, days: 5,
  expiresInDays: days, demo: true,
});

type Result = { check: string; outcome: "pass" | "fail" | "info"; detail: string };
const results: Result[] = [];
const created: Hex[] = [];
async function check(name: string, run: () => Promise<Omit<Result, "check">>) {
  try {
    const r = await run();
    results.push({ check: name, ...r });
  } catch (error) {
    results.push({ check: name, outcome: "fail", detail: explainError(error) });
  }
  const last = results.at(-1)!;
  console.log(`${last.outcome.toUpperCase().padEnd(4)} ${name}: ${last.detail}`);
}

async function cost(hash: Hex) {
  const receipt = await client.getTransactionReceipt({ hash });
  return { gas: receipt.gasUsed, glm: formatEther(receipt.gasUsed * receipt.effectiveGasPrice) };
}

const startBalance = await client.getBalance({ address: account.address });

await check("create one entity: gas", async () => {
  const result = await wallet.createEntity(experimentCreate(row(1)));
  created.push(result.entityKey);
  const c = await cost(result.txHash);
  return { outcome: "info", detail: `${c.gas} gas = ${c.glm} GLM (tx ${result.txHash})` };
});

await check("read-after-write latency", async () => {
  const key = created[0]!;
  const started = Date.now();
  const startBlock = await client.getBlockNumber();
  for (let attempt = 0; attempt < 30; attempt++) {
    const found = await fetchExperiments(client, { keys: [key], includeDemo: true }, 1);
    if (found.items.length === 1) {
      const blocks = (await client.getBlockNumber()) - startBlock;
      return { outcome: "pass", detail: `queryable after ${Date.now() - started} ms (~${blocks} blocks after the receipt)` };
    }
    await sleep(1_000);
  }
  return { outcome: "fail", detail: "not queryable within 30 s" };
});

await check(`batch of ${MAX_BATCH} creates: gas`, async () => {
  const result = await wallet.executeBatch({ creates: Array.from({ length: MAX_BATCH }, (_, i) => experimentCreate(row(100 + i))) });
  created.push(...result.createdEntities);
  const c = await cost(result.txHash);
  return { outcome: "info", detail: `${c.gas} gas = ${c.glm} GLM for ${result.createdEntities.length} entities (tx ${result.txHash})` };
});

await check("25-branch $creator OR query", async () => {
  const creators = [account.address, ...Array.from({ length: 24 }, (_, i) => getAddress(`0x${(i + 1).toString(16).padStart(40, "a")}`))];
  const found = await fetchExperiments(client, { creators, includeDemo: true, keys: undefined }, 50);
  return { outcome: found.items.length > 0 ? "pass" : "fail", detail: `${found.items.length} rows; query length ${found.query.length} chars` };
});

await check("F2: extendEntity(fromDays(30)) on a 365-day entity", async () => {
  const long = await wallet.createEntity(experimentCreate(row(500, 365)));
  created.push(long.entityKey);
  try {
    const result = await wallet.extendEntity({ entityKey: long.entityKey, expires: ExpirationTime.fromDays(30) });
    return { outcome: "fail", detail: `did not revert; expiresAt ${result.expiresAt} vs created ${long.expiresAt}` };
  } catch (error) {
    return { outcome: "pass", detail: `reverted as F2 predicts: ${explainError(error)}` };
  }
});

await check("extend via atBlock(current + 30 days)", async () => {
  const key = created[0]!;
  const before = await fetchExperiment(client, key);
  if (!before.ok) throw new Error(before.reason);
  const result = await wallet.extendEntity({ entityKey: key, expires: ExpirationTime.atBlock(before.value.expiresAt + 30n * 43_200n) });
  return { outcome: result.expiresAt > before.value.expiresAt ? "pass" : "fail", detail: `${before.value.expiresAt} → ${result.expiresAt}` };
});

await check("patch on a readonly entity is refused", async () => {
  const key = created[0]!;
  const attempt = experimentCreate(row(900));
  try {
    await wallet.patchEntity({ entityKey: key, payload: attempt.payload, set: attempt.attributes });
    return { outcome: "fail", detail: "patch succeeded on a readonly entity" };
  } catch (error) {
    return { outcome: "pass", detail: explainError(error) };
  }
});

await check("delete, then the entity is gone from queries", async () => {
  const result = await wallet.executeBatch({ deletes: created.map((entityKey) => ({ entityKey })) });
  await sleep(3_000);
  const left = await fetchExperiments(client, { keys: created.slice(0, 25), includeDemo: true }, 25);
  return { outcome: left.items.length === 0 ? "pass" : "fail", detail: `deleted ${result.deletedEntities.length} in one batch tx ${result.txHash}; ${left.items.length} still queryable` };
});

const spent = formatEther(startBalance - (await client.getBalance({ address: account.address })));
const rpc = defaultRpcUrl().replace(/\/[^/]{16,}$/, "/<key>");
const report = `# End-to-end report

Generated by \`npm run e2e\` on ${new Date().toISOString()} against Tiramisu (chain 7738577) via \`${rpc}\`,
SDK \`@arkiv-network/sdk\` 0.8.1, wallet \`${account.address}\`. Total spent: ${spent} GLM.
Every entity created here was \`demo = true\` and deleted at the end.

| Check | Outcome | Detail |
| --- | --- | --- |
${results.map((r) => `| ${r.check} | ${r.outcome} | ${r.detail.replace(/\|/g, "\\|")} |`).join("\n")}

Predicate used for reads: \`${experimentPredicate({ includeDemo: true }).toString()} AND ($key = … )\`
`;
writeFileSync(resolve(import.meta.dirname, "..", "arkiv", "e2e-report.md"), report);
console.log(`\nwrote arkiv/e2e-report.md (${results.filter((r) => r.outcome === "fail").length} failures)`);
