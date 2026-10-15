/**
 * Re-checks every finding in arkiv/friction.md against the installed SDK and the live Tiramisu
 * network, and says whether each still behaves as written there.
 *
 *   npm run friction
 *
 * Read-only: no wallet, no key, no transaction. Findings that need a write (F2, F11) are checked
 * from the SDK's own code or from a transaction we already sent, read back as of its block. About
 * eight `arkiv_query` calls in all. ARKIV_RPC_URL (e.g. with an Arkiv Hub access key) is used for
 * reads if set; F6 always asks the public RPC, because the anonymous budget is the finding.
 * Writes arkiv/friction-check.json; exits 1 if any finding no longer behaves as documented.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ExpirationTime, createPublicClient, createWalletClient, resolveExpiry } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TIRAMISU_RPC, arkivHttp, defaultRpcUrl, entityAtBlock, getEntityOrNull, isRateLimited, readClient } from "../ledger/src/index.ts";
import { loadEnv } from "./env.ts";

loadEnv();
const root = resolve(import.meta.dirname, "..");
const rpc = defaultRpcUrl();
const client = readClient(rpc);

type Verdict = "as documented" | "differs" | "not checked";
type Result = { id: string; how: "source" | "runtime" | "chain" | "manual"; verdict: Verdict; observed: string };
const results: Result[] = [];

async function check(id: string, how: Result["how"], run: () => Promise<{ ok: boolean; observed: string }>) {
  if (how === "manual") {
    results.push({ id, how, verdict: "not checked", observed: (await run()).observed });
    return;
  }
  try {
    const { ok, observed } = await run();
    results.push({ id, how, verdict: ok ? "as documented" : "differs", observed });
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error);
    results.push({ id, how, verdict: "not checked", observed: isRateLimited(error) ? "RPC rate-limited this IP (F6)" : message });
  }
}

async function rawQuery(url: string, query: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "arkiv_query", params: [query, { limit: 1 }] }),
  });
  if (response.status === 429) throw Object.assign(new Error("429"), { status: 429 });
  const body = (await response.json()) as { error?: { code: number; message: string } };
  return { response, error: body.error };
}

const DELETED = "0x1685179bf008a2915b8f61777181fcccf226c65fd4f040d049fe7ce73945261a" as Hex;
const TRUST_LIST = "0x0ba80e7836e3dcc85e5c118ee70f14f0a5bc7d93c36c7094f55406f691c56108" as Hex;
// Our extension of the trust list to the expiry it already had (16 Oct 2026): accepted and charged.
const EQUAL_EXTEND_TX = "0x85914ab4fc4112f85d899f9455f40603036e4b9cc836a5bb7e1e30bcae2b8005" as Hex;

await check("F1 faucet needs a browser wallet", "manual", async () => ({ ok: true, observed: "UI flow; check by hand at hub.arkiv.network/faucet" }));

await check("F2 extend fromDays counts from now, not from the current expiry", "source", async () => {
  // The resolver takes only the current block: an entity's existing expiry is not an input at all.
  const { target } = resolveExpiry(ExpirationTime.fromDays(30), { currentBlock: 1_000_000n });
  return { ok: target === 1_000_000n + 30n * 43_200n, observed: `fromDays(30) at block 1 000 000 resolves to ${target}, whatever the entity's expiry` };
});

await check("F3 entity events carry no attributes", "source", async () => {
  const source = readFileSync(resolve(root, "node_modules/@arkiv-network/sdk/src/types/events.ts"), "utf8");
  const created = /export type EntityCreatedEvent[\s\S]*?\n}/.exec(source)?.[0] ?? "";
  return { ok: created.length > 0 && !/attributes|payload|contentType/.test(created), observed: "EntityCreatedEvent: entityKey, owner, expiresAt, creationFlags" };
});

await check("F4 node limits: 64 predicates, 8192 bytes, neither in the SDK", "chain", async () => {
  const addr = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
  const ors = (n: number) => `app = str('nexora') AND (${Array.from({ length: n }, (_, i) => `$creator = addr(${addr(i + 1)})`).join(" OR ")})`;
  const at64 = await rawQuery(rpc, ors(63));
  const at65 = await rawQuery(rpc, ors(64));
  const long = `app = str('nexora') AND (${Array.from({ length: 60 }, (_, i) => `x${i} = str('${"a".repeat(125)}')`).join(" OR ")})`;
  const tooLong = await rawQuery(rpc, long);
  const ok = !at64.error && /too many predicates/.test(at65.error?.message ?? "") && /too long/.test(tooLong.error?.message ?? "");
  return { ok, observed: `64: ${at64.error?.message ?? "ok"} | 65: ${at65.error?.message} | ${long.length} bytes: ${tooLong.error?.message}` };
});

await check("F5 explorer answers 200 for any path", "chain", async () => {
  const response = await fetch(`https://tiramisu.explorer.arkiv.network/entity/0x${"0".repeat(64)}`);
  return { ok: response.status === 200, observed: `unknown entity key: HTTP ${response.status}` };
});

await check("F6 viem's default transport sleeps through Retry-After; the budget is not visible until gone", "runtime", async () => {
  // A local server that always answers 429 with Retry-After: 1.
  const server = createServer((_, res) => res.writeHead(429, { "retry-after": "1", "content-type": "application/json" }).end("{}"));
  await new Promise<void>((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const time = async (transport: ReturnType<typeof http>) => {
    const started = Date.now();
    await createPublicClient({ chain: tiramisu, transport }).getBlockNumber().catch(() => undefined);
    return Date.now() - started;
  };
  const defaultMs = await time(http(url));
  const ours = await time(arkivHttp(url));
  server.close();
  // The public RPC's headers on a normal answer: a cost per query, but no remaining cost budget.
  let headers = "";
  try {
    const { response } = await rawQuery(TIRAMISU_RPC, "v = i32(1)");
    headers = `cost ${response.headers.get("arkiv-cost")}, quota ${response.headers.get("arkiv-quota-used-percent") ?? "absent"}, exposes quota header: ${/Arkiv-Quota-Used-Percent/i.test(response.headers.get("access-control-expose-headers") ?? "")}`;
  } catch {
    headers = "public RPC answered 429 right now: the finding itself";
  }
  return { ok: defaultMs >= 2_500 && ours < 1_500, observed: `default http() waited ${defaultMs} ms on Retry-After: 1, fail-fast transport ${ours} ms; ${headers}` };
});

await check("F7 predictEntityKeys and executeBatch are on different clients", "runtime", async () => {
  const pub = createPublicClient({ chain: tiramisu, transport: http(TIRAMISU_RPC) }) as unknown as Record<string, unknown>;
  const wallet = createWalletClient({ chain: tiramisu, transport: http(TIRAMISU_RPC), account: privateKeyToAccount(`0x${"1".repeat(64)}`) }) as unknown as Record<string, unknown>;
  const shape = `public: predict ${typeof pub.predictEntityKeys}, batch ${typeof pub.executeBatch}; wallet: predict ${typeof wallet.predictEntityKeys}, batch ${typeof wallet.executeBatch}`;
  return { ok: typeof pub.predictEntityKeys === "function" && pub.executeBatch === undefined && wallet.predictEntityKeys === undefined && typeof wallet.executeBatch === "function", observed: shape };
});

await check("F8 create parameters are not JSON; read-back flags carry raw", "chain", async () => {
  let threw = false;
  try {
    JSON.stringify({ expires: ExpirationTime.fromDays(30) });
  } catch {
    threw = true;
  }
  const list = await getEntityOrNull(client, TRUST_LIST);
  const flags = JSON.stringify(list?.creationFlags);
  return { ok: threw && /"raw"/.test(flags), observed: `JSON.stringify(fromDays(30)) ${threw ? "throws" : "works"}; flags ${flags}` };
});

await check("F9 a deleted entity stays readable at earlier blocks", "chain", async () => {
  const [before, at] = await Promise.all([entityAtBlock(client, DELETED, 580_129n), entityAtBlock(client, DELETED, 580_130n)]);
  const now = await getEntityOrNull(client, DELETED);
  return { ok: before !== null && before.payload !== undefined && at === null && now === null, observed: `block 580129: ${before ? "full entity, payload included" : "absent"}; 580130: ${at ? "present" : "absent"}; now: ${now ? "present" : "gone"}` };
});

await check("F10 block time is not constant; no way to find a block by time", "chain", async () => {
  const [genesis, head, timing] = await Promise.all([client.getBlock({ blockNumber: 0n }), client.getBlock(), client.getBlockTiming()]);
  const average = Number(head.timestamp - genesis.timestamp) / Number(head.number);
  return { ok: average > 3 && timing.blockDuration === 2, observed: `getBlockTiming says ${timing.blockDuration} s; genesis to head averages ${average.toFixed(2)} s over ${head.number} blocks` };
});

await check("F11 extending to the same expiry is accepted and charged, though the docs say it is rejected", "chain", async () => {
  const receipt = await client.getTransactionReceipt({ hash: EQUAL_EXTEND_TX });
  const [before, after] = await Promise.all([entityAtBlock(client, TRUST_LIST, receipt.blockNumber - 1n), entityAtBlock(client, TRUST_LIST, receipt.blockNumber)]);
  const same = before?.expiresAt !== undefined && before.expiresAt === after?.expiresAt;
  return { ok: receipt.status === "success" && receipt.gasUsed > 0n && same, observed: `tx ${receipt.status}, ${receipt.gasUsed} gas, expiry ${before?.expiresAt} → ${after?.expiresAt}` };
});

const block = await client.getBlockNumber().catch(() => undefined);
for (const r of results) console.log(`${r.verdict === "as documented" ? "ok  " : r.verdict === "differs" ? "DIFF" : "--  "} ${r.id} [${r.how}]\n       ${r.observed}`);
const differs = results.filter((r) => r.verdict === "differs").length;
const unchecked = results.filter((r) => r.verdict === "not checked").length;
console.log(`\n${results.length - differs - unchecked}/${results.length} behave as documented${differs ? `, ${differs} differ` : ""}${unchecked ? `, ${unchecked} not checked` : ""} (Tiramisu block ${block ?? "?"})`);
writeFileSync(resolve(root, "arkiv", "friction-check.json"), `${JSON.stringify({ checkedAt: new Date().toISOString(), block: block?.toString() ?? null, sdk: "0.8.1", results }, null, 2)}\n`);
if (differs) process.exitCode = 1;
