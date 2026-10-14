/**
 * Publishes the synthetic demo dataset to Tiramisu.
 *
 *   npm run seed            publish (skips a wallet that already has demo rows)
 *   npm run seed -- --dry   print what would be published, write nothing
 *
 * Every row is synthetic and flagged `demo = true`. Three wallets behave like honest sellers whose
 * results follow one hidden pattern with noise. The fourth behaves like a spammer: it publishes
 * implausible ShareChat wins, so the trust-list filter and the publisher-count dampener have
 * something real to defend against. A trust list curated by the sponsor wallet includes only the honest
 * three.
 */
import { createWalletClient, type CreateEntityParameters } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CATEGORIES, CTAS, LANGUAGES, PLATFORM_FORMATS, MAX_BATCH, OFFERS, PLATFORMS, SEASONS, TIERS, TONES,
  experimentCreate, fetchExperiments, fetchTrustLists, readClient, trustListCreate,
  type ExperimentInput,
} from "../ledger/src/index.ts";
import { SEED_KEY_NAMES, SPONSOR_KEY_NAME, loadEnv, requireKey } from "./env.ts";

loadEnv();
const dry = process.argv.includes("--dry");

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

async function publish(keyName: string, rows: ExperimentInput[]): Promise<Hex[]> {
  const account = privateKeyToAccount(requireKey(keyName));
  const existing = await fetchExperiments(client, { includeDemo: true, creators: [account.address] }, 10);
  if (existing.items.length > 0) {
    console.log(`${account.address} already has demo rows; skipping.`);
    return existing.items.map((e) => e.key);
  }
  if (dry) {
    console.log(`[dry] ${account.address} would publish ${rows.length} rows`);
    return [];
  }
  const wallet = createWalletClient({ chain: tiramisu, transport: http(), account });
  const keys: Hex[] = [];
  for (let i = 0; i < rows.length; i += MAX_BATCH) {
    const creates: CreateEntityParameters[] = rows.slice(i, i + MAX_BATCH).map(experimentCreate);
    const result = await wallet.executeBatch({ creates });
    keys.push(...result.createdEntities);
    console.log(`${account.address} batch ${i / MAX_BATCH + 1}: ${result.createdEntities.length} entities, tx ${result.txHash}`);
  }
  return keys;
}

const honest = SEED_KEY_NAMES.slice(0, 3);
const published: Hex[][] = [];
for (const [i, name] of honest.entries()) published.push(await publish(name, honestRows(1000 + i, 30)));
await publish(SEED_KEY_NAMES[3], spamRows(15));

// Lineage: seller 2 publishes variants of seller 1's first few results, referencing them by key.
const parents = published[0]?.slice(0, 4) ?? [];
if (parents.length > 0 && !dry) {
  const account = privateKeyToAccount(requireKey(SEED_KEY_NAMES[1]));
  const variants = await fetchExperiments(client, { includeDemo: true, parent: parents[0] }, 5);
  if (variants.items.length === 0) {
    const wallet = createWalletClient({ chain: tiramisu, transport: http(), account });
    const children = honestRows(77, parents.length).map((row, i) => ({ ...row, parent: parents[i] }));
    const result = await wallet.executeBatch({ creates: children.map(experimentCreate) });
    console.log(`variants: ${result.createdEntities.length} entities, tx ${result.txHash}`);
  }
}

const sponsor = privateKeyToAccount(requireKey(SPONSOR_KEY_NAME));
const lists = await fetchTrustLists(client, sponsor.address);
if (lists.items.length === 0 && !dry) {
  const wallet = createWalletClient({ chain: tiramisu, transport: http(), account: sponsor });
  const members = honest.map((name) => privateKeyToAccount(requireKey(name)).address);
  const result = await wallet.createEntity(trustListCreate({
    name: "Nexora demo: honest seed sellers",
    scope: "all",
    description: "Synthetic demo. Includes seed publishers 1–3; excludes seed publisher 4, which publishes implausible results on purpose.",
    members,
  }));
  console.log(`trust list ${result.entityKey}, tx ${result.txHash}`);
}
console.log("done");
