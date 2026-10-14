/**
 * Publishes the synthetic demo dataset to Tiramisu.
 *
 *   npm run seed            run every step not yet recorded in arkiv/evidence.json
 *   npm run seed -- --dry   print the steps, write nothing
 *
 * Besides the dataset, the script exercises every Arkiv feature the app claims: batch creates,
 * key-typed lineage, a sealed payload, a trust list created then patched, a permissionless extension
 * by a non-owner, a refused patch on a readonly entity, and an owner delete. Each transaction is
 * recorded in arkiv/evidence.json so the claims can be checked on the explorer.
 *
 * Every row is synthetic and flagged `demo = true`. Three wallets behave like honest sellers whose
 * results follow one hidden pattern with noise. The fourth behaves like a spammer: it publishes
 * implausible ShareChat wins, so the trust-list filter and the publisher-count dampener have
 * something real to defend against. A trust list curated by the sponsor wallet includes only the honest
 * three.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ExpirationTime, createWalletClient, type CreateEntityParameters } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CATEGORIES, CTAS, LANGUAGES, PLATFORM_FORMATS, MAX_BATCH, OFFERS, PLATFORMS, SEASONS, TIERS, TONES,
  EXTEND_DAYS, arkivHttp, experimentCreate, explainError, fetchExperiment, fetchExperiments, fetchTrustList,
  readClient, seal, trustListCreate, trustListPatch, type ExperimentInput,
} from "../ledger/src/index.ts";
import { SEED_KEY_NAMES, SPONSOR_KEY_NAME, loadEnv, requireKey } from "./env.ts";

loadEnv();
const dry = process.argv.includes("--dry");

/** Public on purpose: it unlocks one synthetic demo row so judges can try "Unlock exact figures". */
const DEMO_PASSPHRASE = "nexora-demo-2026";
const EVIDENCE_FILE = resolve(import.meta.dirname, "..", "arkiv", "evidence.json");
type Evidence = { recommendedTrustList: Hex | null; features: Record<string, Record<string, unknown>> } & Record<string, unknown>;
const readEvidence = (): Evidence => JSON.parse(readFileSync(EVIDENCE_FILE, "utf8")) as Evidence;
const writeEvidence = (value: Evidence) =>
  writeFileSync(EVIDENCE_FILE, `${JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length)] as T;

/** The hidden "market" the honest sellers sample from. Nobody reading Arkiv sees this table. */
function trueRoi(e: Omit<ExperimentInput, "revenueInr" | "expiresInDays">, r: () => number): number {
  let roi = -20;
  const rural = e.tier === "tier3" || e.tier === "rural";
  if (e.platform === "whatsapp" && (e.format === "status" || e.format === "broadcast")) roi += rural ? 140 : 60;
  if (e.platform === "instagram" && e.format === "reel") roi += e.tier === "metro" || e.tier === "tier1" ? 120 : 70;
  if (e.platform === "youtube" && e.format === "long_video" && e.category === "coaching_tuition") roi += 160;
  if (e.platform === "google_search" && e.format === "search_text") roi += e.category === "coaching_tuition" || e.category === "mobile_accessories" ? 110 : 20;
  if (e.platform === "meesho" && e.format === "listing_boost") roi += ["ethnic_apparel", "sarees_textiles", "jewellery"].includes(e.category) ? 90 : 10;
  if (e.platform === "facebook" && e.format === "carousel") roi += 30;
  if (e.lang === "hi" || e.lang === "hinglish" || (e.lang !== "en" && rural)) roi += 25;
  if (e.season !== "none") roi += ["sarees_textiles", "jewellery", "snacks_sweets", "handicrafts"].includes(e.category) ? 60 : 15;
  if (e.offer === "cod" && rural) roi += 30;
  if (e.offer === "combo" || e.offer === "free_shipping") roi += 15;
  return roi + (r() - 0.5) * 120;
}


function honestRows(seed: number, count: number): ExperimentInput[] {
  const r = rng(seed);
  return Array.from({ length: count }, () => {
    const platform = pick(r, PLATFORMS.filter((p) => p !== "sharechat"));
    const base = {
      category: pick(r, CATEGORIES.filter((c) => c !== "other")),
      platform,
      format: pick(r, PLATFORM_FORMATS[platform]),
      lang: pick(r, LANGUAGES),
      tier: pick(r, TIERS),
      season: r() < 0.6 ? "none" as const : pick(r, SEASONS),
      tone: pick(r, TONES),
      cta: pick(r, CTAS),
      offer: pick(r, OFFERS),
      spendInr: Math.round(300 + r() ** 2 * 40_000),
      days: 3 + Math.floor(r() * 25),
      demo: true,
    };
    const roi = trueRoi(base, r);
    return { ...base, revenueInr: Math.max(0, Math.round(base.spendInr * (1 + roi / 100))), expiresInDays: r() < 0.5 ? 90 : 365 };
  });
}

function spamRows(count: number): ExperimentInput[] {
  const r = rng(404);
  return Array.from({ length: count }, () => ({
    category: pick(r, ["tea_coffee", "beauty_ayurveda", "ethnic_apparel"] as const),
    platform: "sharechat" as const, format: "static_image" as const, lang: "hi" as const,
    tier: pick(r, TIERS), season: "none" as const, tone: "urgency" as const, cta: "dm_us" as const,
    offer: "none" as const, spendInr: 500, revenueInr: 5_000 + Math.round(r() * 1_000), days: 2,
    demo: true, expiresInDays: 30 as const,
  }));
}

const client = readClient();
const evidence = readEvidence();
const account = (name: string) => privateKeyToAccount(requireKey(name));
const walletFor = (name: string) => createWalletClient({ chain: tiramisu, transport: arkivHttp(), account: account(name) });

/** Runs a step once; its on-chain result is recorded in arkiv/evidence.json and skipped next time. */
async function step(name: string, why: string, run: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown> | undefined> {
  const done = evidence.features[name];
  if (done) {
    console.log(`= ${name} (already recorded)`);
    return done;
  }
  if (dry) {
    console.log(`[dry] ${name}: ${why}`);
    return undefined;
  }
  const result = { why, ...(await run()), at: new Date().toISOString() };
  evidence.features[name] = result;
  writeEvidence(evidence);
  console.log(`+ ${name}: ${JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  return result;
}

/**
 * Publishes `rows` from one wallet in batches. Resumable: rows this wallet already has on chain (from
 * a run that stopped half-way, e.g. out of gas) are counted and skipped, so a rerun never duplicates.
 */
async function publishBatches(keyName: string, rows: ExperimentInput[]) {
  const wallet = walletFor(keyName);
  const creator = account(keyName).address;
  const existing = await fetchExperiments(client, { includeDemo: true, creators: [creator] }, 200);
  const keys: Hex[] = existing.items.map((e) => e.key);
  const txs: Hex[] = [];
  if (keys.length > 0) console.log(`  ${creator} already has ${keys.length} rows on chain; publishing the remaining ${Math.max(0, rows.length - keys.length)}`);
  for (let i = keys.length; i < rows.length; i += MAX_BATCH) {
    const creates: CreateEntityParameters[] = rows.slice(i, i + MAX_BATCH).map(experimentCreate);
    const result = await wallet.executeBatch({ creates });
    keys.push(...result.createdEntities);
    txs.push(result.txHash);
  }
  return { creator, entities: keys.length, keys, txs };
}

const honest = SEED_KEY_NAMES.slice(0, 3);
const LIST_NAME = "Nexora demo: honest seed sellers";
const LIST_DESCRIPTION = "Synthetic demo. Includes seed publishers 1–3; excludes seed publisher 4, which publishes implausible results on purpose.";

const seller1 = await step("batch_seed1", "executeBatch: 30 synthetic experiments from honest seller 1", () => publishBatches(honest[0]!, honestRows(1000, 30)));
await step("batch_seed2", "executeBatch: 30 synthetic experiments from honest seller 2", () => publishBatches(honest[1]!, honestRows(1001, 30)));
await step("batch_seed3", "executeBatch: 30 synthetic experiments from honest seller 3", () => publishBatches(honest[2]!, honestRows(1002, 30)));
await step("batch_spammer", "executeBatch: 15 implausible ShareChat wins from the deliberate spammer", () => publishBatches(SEED_KEY_NAMES[3], spamRows(15)));

const parents = ((seller1?.keys as Hex[] | undefined) ?? []).slice(0, 4);

await step("lineage_variants", "key-typed parent attribute: seller 2 publishes variants of seller 1's results", async () => {
  if (parents.length === 0) throw new Error("seller 1 keys missing");
  const children = honestRows(77, parents.length).map((row, i) => ({ ...row, parent: parents[i] }));
  const result = await walletFor(honest[1]!).executeBatch({ creates: children.map(experimentCreate) });
  const check = await fetchExperiments(client, { includeDemo: true, parent: parents[0] }, 5);
  return { parents, keys: result.createdEntities, tx: result.txHash, query: check.query, foundByParentQuery: check.items.length };
});

await step("sealed_payload", "client-side AES-256-GCM sealed figures in the payload (demo passphrase is public on purpose)", async () => {
  const sealed = await seal({ spendInr: 4_200, revenueInr: 11_760, orders: 37, note: "synthetic demo row" }, DEMO_PASSPHRASE);
  const [row] = honestRows(55, 1);
  const result = await walletFor(honest[2]!).createEntity(experimentCreate({ ...row!, sealed }));
  return { key: result.entityKey, tx: result.txHash, demoPassphrase: DEMO_PASSPHRASE };
});

const list = await step("trust_list_create", "trust list entity curated by the sponsor wallet; starts with sellers 1 and 2", async () => {
  const result = await walletFor(SPONSOR_KEY_NAME).createEntity(trustListCreate({
    name: LIST_NAME,
    scope: "all",
    description: LIST_DESCRIPTION,
    members: [account(honest[0]!).address, account(honest[1]!).address],
  }));
  return { key: result.entityKey, tx: result.txHash };
});
if (list?.key && !dry) {
  evidence.recommendedTrustList = list.key as Hex;
  writeEvidence(evidence);
}

await step("trust_list_patch", "patchEntity by the owner: the curator adds seller 3 to the list", async () => {
  const key = list?.key as Hex;
  const result = await walletFor(SPONSOR_KEY_NAME).patchEntity(trustListPatch(key, {
    name: LIST_NAME,
    scope: "all",
    description: LIST_DESCRIPTION,
    members: honest.map((name) => account(name).address),
  }));
  const after = await fetchTrustList(client, key);
  return { key, tx: result.txHash, membersAfter: after.ok ? after.value.members.length : null };
});

await step("permissionless_extend", "extendEntity by a NON-owner (the sponsor) on seller 1's entity, allowed by permissionlessExtension", async () => {
  const key = parents[0]!;
  const before = await fetchExperiment(client, key);
  if (!before.ok) throw new Error(before.reason);
  const target = before.value.expiresAt + BigInt(EXTEND_DAYS * 43_200);
  const result = await walletFor(SPONSOR_KEY_NAME).extendEntity({ entityKey: key, expires: ExpirationTime.atBlock(target) });
  return {
    key, owner: before.value.owner, extendedBy: account(SPONSOR_KEY_NAME).address, tx: result.txHash,
    expiresBefore: before.value.expiresAt.toString(), expiresAfter: result.expiresAt.toString(),
  };
});

await step("readonly_enforced", "patchEntity on a readonly experiment must be refused, even for its owner", async () => {
  const key = parents[1]!;
  const [row] = honestRows(66, 1);
  const attempt = experimentCreate(row!);
  try {
    const result = await walletFor(honest[0]!).patchEntity({ entityKey: key, payload: attempt.payload, contentType: attempt.contentType, set: attempt.attributes });
    return { key, unexpected: "patch succeeded", tx: result.txHash };
  } catch (error) {
    return { key, refused: true, error: explainError(error) };
  }
});

await step("owner_delete", "deleteEntity by the owner: seller 2 publishes a mistaken row and removes it", async () => {
  const [row] = honestRows(88, 1);
  const created = await walletFor(honest[1]!).createEntity(experimentCreate({ ...row!, expiresInDays: 7 }));
  const deleted = await walletFor(honest[1]!).deleteEntity({ entityKey: created.entityKey });
  const gone = await fetchExperiments(client, { includeDemo: true, keys: [created.entityKey] }, 1);
  return { key: created.entityKey, createTx: created.txHash, deleteTx: deleted.txHash, stillQueryable: gone.items.length > 0 };
});

console.log(dry ? "dry run complete" : "done; evidence written to arkiv/evidence.json");
