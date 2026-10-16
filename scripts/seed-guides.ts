/**
 * Publishes arkiv/guides.json to Tiramisu from the curator of the recommended trust list, and
 * records each guide's entity key in arkiv/guides-onchain.json.
 *
 *   npx tsx scripts/seed-guides.ts            create guides that are missing, patch the ones whose wording changed
 *   npx tsx scripts/seed-guides.ts --dry      show what would be sent
 *
 * A guide is identified by its scope and topic. Unchanged guides are left alone, so running it twice
 * sends nothing the second time. A patched guide's earlier wording stays readable at past blocks.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createWalletClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { privateKeyToAccount } from "viem/accounts";
import { arkivHttp, fetchGuides, guideCreate, guidePatch, readClient, validateGuide, type GuideInput } from "../ledger/src/index.ts";
import { SPONSOR_KEY_NAME, loadEnv, requireKey } from "./env.ts";

loadEnv();
const dry = process.argv.includes("--dry");
const root = new URL("../", import.meta.url);
const { guides } = JSON.parse(readFileSync(new URL("arkiv/guides.json", root), "utf8")) as { guides: GuideInput[] };
const curator = privateKeyToAccount(requireKey(SPONSOR_KEY_NAME));
const reader = readClient();
const wallet = createWalletClient({ chain: tiramisu, transport: arkivHttp(), account: curator });

const existing = await fetchGuides(reader, curator.address);
const id = (g: { scope: string; topic: string }) => `${g.scope}/${g.topic}`;
const onChain = new Map(existing.items.map((g) => [id(g), g]));
const wording = (g: GuideInput) => JSON.stringify(validateGuide(g));

const creates: GuideInput[] = [];
const patches: { key: `0x${string}`; guide: GuideInput }[] = [];
for (const guide of guides) {
  const current = onChain.get(id(guide));
  if (!current) creates.push(guide);
  else if (wording({ ...current, scope: current.scope, topic: current.topic }) !== wording(guide)) patches.push({ key: current.key, guide });
}
console.log(`curator ${curator.address}: ${guides.length} guides, ${existing.items.length} on chain; ${creates.length} to create, ${patches.length} to update`);
if (dry || (creates.length === 0 && patches.length === 0)) process.exit(0);

const record: { scope: string; topic: string; key: string; tx: string }[] = [];
if (creates.length) {
  const result = await wallet.executeBatch({ creates: creates.map(guideCreate) });
  creates.forEach((g, i) => record.push({ scope: g.scope, topic: g.topic, key: result.createdEntities[i]!, tx: result.txHash }));
  console.log(`created ${creates.length} in ${result.txHash}`);
}
for (const { key, guide } of patches) {
  const result = await wallet.patchEntity(guidePatch(key, guide));
  record.push({ scope: guide.scope, topic: guide.topic, key, tx: result.txHash });
  console.log(`updated ${id(guide)} in ${result.txHash}`);
}

// Keep the record complete: unchanged guides keep their earlier entry.
const file = new URL("arkiv/guides-onchain.json", root);
let previous: typeof record = [];
try {
  previous = (JSON.parse(readFileSync(file, "utf8")) as { guides: typeof record }).guides;
} catch {
  /* first run */
}
const merged = [...previous.filter((p) => !record.some((r) => id(r) === id(p))), ...record].sort((a, b) => id(a).localeCompare(id(b)));
writeFileSync(file, `${JSON.stringify({ curator: curator.address, guides: merged }, null, 2)}\n`);
console.log(`arkiv/guides-onchain.json: ${merged.length} guides`);
