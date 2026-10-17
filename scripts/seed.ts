/**
 * Publishes the synthetic demo dataset to Tiramisu.
 *
 *   npm run seed            run every step not yet recorded in arkiv/evidence.json
 *   npm run seed -- --dry   print the steps, write nothing
 *
 * Besides the dataset, the script exercises every Arkiv feature the app claims: batch creates,
 * key-typed lineage (incident follow-ups), a sealed payload, a trust list created then patched, a
 * permissionless extension by a non-owner, a refused patch on a readonly entity, an owner delete, a
 * report locked by handing it to 0x…dEaD, replies from the trust list's curator to three reports, a
 * worker answering a "resolved" reply with "not sorted out", the curator renewing the trust list's
 * lease, and reads as of past blocks.
 * Each transaction is recorded in arkiv/evidence.json so the claims can be checked on the explorer.
 *
 * Every entry is synthetic and flagged `demo = true`. Nine wallets behave like honest workers, each
 * with one consistent profile (city, kind of work, vehicle). Their take-home is drawn from a hidden
 * model that depends on the kind of work, the city and the vehicle only, never on the platform, so
 * the demo says nothing about any real company. Its levels are calibrated to public reporting: the
 * "Prisoners on Wheels?" survey of app-based drivers and delivery workers in eight Indian cities
 * (2024), where 43% of cab drivers took home under ₹500 a day after costs and 34% of delivery workers
 * under ₹10,000 a month. The tenth wallet is a spammer that publishes implausible ₹350–450/hour
 * days, so the trust list and the independent-worker count have something real to defend against.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ExpirationTime, createWalletClient, type CreateEntityParameters } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  EXTEND_DAYS, MAX_BATCH, arkivHttp, createLocked, decodeTrustList, entityAtBlock, explainError, fetchEntry, fetchIncidents, fetchReplies, fetchShifts, fetchTrustList,
  incidentCreate, readClient, replyCreate, seal, shiftCreate, trustListCreate, trustListPatch, trustRenewal, type ReplyStatus,
  type City, type IncidentInput, type IncidentType, type Platform, type ShiftInput, type Vehicle, type WorkType,
} from "../ledger/src/index.ts";
import { SEED_KEY_NAMES, SPAMMER_KEY_NAME, SPONSOR_KEY_NAME, loadEnv, requireKey } from "./env.ts";

loadEnv();
const dry = process.argv.includes("--dry");

/** Public on purpose: it unlocks one synthetic demo day so judges can try "Unlock exact figures". */
const DEMO_PASSPHRASE = "nexora-demo-2026";
const EVIDENCE_FILE = resolve(import.meta.dirname, "..", "arkiv", "evidence.json");
type Evidence = { recommendedTrustList: Hex | null; wallets: Record<string, string>; features: Record<string, Record<string, unknown>> } & Record<string, unknown>;
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
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);

type Profile = { city: City; vehicle: Vehicle; gigs: [Platform, WorkType][] };

/** One profile per honest wallet. Overlaps are deliberate: a figure needs two workers to be confirmed. */
const PROFILES: Profile[] = [
  { city: "bengaluru", vehicle: "petrol_bike", gigs: [["swiggy", "food_delivery"], ["zomato", "food_delivery"]] },
  { city: "bengaluru", vehicle: "ev_scooter", gigs: [["swiggy", "food_delivery"], ["zomato", "food_delivery"], ["zepto", "grocery_delivery"]] },
  { city: "bengaluru", vehicle: "petrol_bike", gigs: [["rapido", "bike_taxi"], ["uber", "bike_taxi"]] },
  { city: "bengaluru", vehicle: "petrol_bike", gigs: [["blinkit", "grocery_delivery"], ["zepto", "grocery_delivery"]] },
  { city: "delhi_ncr", vehicle: "petrol_bike", gigs: [["zomato", "food_delivery"], ["swiggy", "food_delivery"]] },
  { city: "delhi_ncr", vehicle: "ev_scooter", gigs: [["zomato", "food_delivery"], ["blinkit", "grocery_delivery"]] },
  { city: "delhi_ncr", vehicle: "car", gigs: [["uber", "cab"], ["ola", "cab"]] },
  { city: "delhi_ncr", vehicle: "car", gigs: [["uber", "cab"], ["rapido", "cab"]] },
  { city: "jaipur", vehicle: "petrol_bike", gigs: [["zomato", "food_delivery"], ["swiggy", "food_delivery"]] },
];

const PERIODS = [202608, 202609, 202610] as const;
const SHIFTS_PER_MONTH = [5, 5, 6] as const;

/** The hidden model. Nobody reading Arkiv sees this table, and the platform is not in it. */
const NET_PER_HOUR: Record<WorkType, number> = {
  food_delivery: 70, grocery_delivery: 80, parcel_delivery: 70, cab: 55, bike_taxi: 65, auto: 65, home_services: 150,
};
const CITY_FACTOR: Partial<Record<City, number>> = { jaipur: 0.75, lucknow: 0.75, indore: 0.75 };
const COST_PER_HOUR: Record<Vehicle, number> = { bicycle: 2, ev_scooter: 8, petrol_bike: 22, auto: 30, car: 55, none: 5 };

function honestShifts(profile: Profile, seed: number): ShiftInput[] {
  const r = rng(seed);
  const rows: ShiftInput[] = [];
  PERIODS.forEach((period, m) => {
    for (let i = 0; i < SHIFTS_PER_MONTH[m]!; i++) {
      const [platform, work] = pick(r, profile.gigs);
      const driving = work === "cab" || work === "bike_taxi" || work === "auto";
      const hours = Math.round(between(r, driving ? 10 : 8, driving ? 14 : 12) * 2) / 2;
      const net = NET_PER_HOUR[work] * (CITY_FACTOR[profile.city] ?? 1) * (1 + (r() - 0.5) * 0.35);
      const costsInr = Math.round(COST_PER_HOUR[profile.vehicle] * hours * between(r, 0.8, 1.2));
      const roll = r();
      rows.push({
        platform, work, city: profile.city, vehicle: profile.vehicle, period,
        grossInr: Math.round(net * hours + costsInr), costsInr, hours,
        incentive: roll < 0.45 ? "met" : roll < 0.8 ? "missed" : "none",
        expiresInDays: 365, demo: true,
      });
    }
  });
  return rows;
}

function spamShifts(count: number): ShiftInput[] {
  const r = rng(404);
  return Array.from({ length: count }, (_, i) => ({
    platform: "rapido" as const, work: "bike_taxi" as const, city: "bengaluru" as const, vehicle: "petrol_bike" as const,
    period: PERIODS[i % PERIODS.length]!, grossInr: Math.round(between(r, 3_500, 4_500)) + 200, costsInr: 200, hours: 10,
    incentive: "met" as const, expiresInDays: 90 as const, demo: true,
  }));
}

const INCIDENT_WEIGHTS: [IncidentType, number][] = [
  ["id_blocked", 30], ["pay_cut", 15], ["incentive_cut", 15], ["penalty", 15],
  ["payout_delayed", 10], ["unsafe_pressure", 10], ["deactivated", 3], ["harassment", 2],
];

function weighted(r: () => number): IncidentType {
  let roll = r() * INCIDENT_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  for (const [type, w] of INCIDENT_WEIGHTS) {
    roll -= w;
    if (roll < 0) return type;
  }
  return "id_blocked";
}

function honestIncidents(profile: Profile, seed: number, first?: IncidentType): IncidentInput[] {
  const r = rng(seed);
  const count = 1 + Math.floor(r() * 3);
  return Array.from({ length: count }, (_, i) => {
    const type = i === 0 && first ? first : weighted(r);
    const [platform, work] = pick(r, profile.gigs);
    const daysLost = type === "id_blocked" ? 1 + Math.floor(r() * 10) : type === "deactivated" ? 30 + Math.floor(r() * 61) : 0;
    const resolvedChance = type === "id_blocked" ? 0.5 : type === "payout_delayed" ? 0.7 : 0.2;
    return {
      platform, work, city: profile.city, type, period: pick(r, PERIODS), daysLost,
      reasonGiven: r() < 0.3, appealed: r() < 0.6,
      // The follow-up step resolves the first block of worker 5 later, so it starts unresolved.
      resolved: i === 0 && first ? false : r() < resolvedChance,
      expiresInDays: 365, demo: true,
    };
  });
}

const client = readClient();
const evidence = readEvidence();
const account = (name: string) => privateKeyToAccount(requireKey(name));
const walletFor = (name: string) => createWalletClient({ chain: tiramisu, transport: arkivHttp(), account: account(name) });
const honest = SEED_KEY_NAMES.filter((name) => name !== SPAMMER_KEY_NAME);
if (honest.length !== PROFILES.length) throw new Error(`Expected ${PROFILES.length} honest seed keys, found ${honest.length}.`);
const worker = (i: number) => honest[i]!;

if (!dry) {
  evidence.wallets = {
    sponsor: account(SPONSOR_KEY_NAME).address,
    ...Object.fromEntries(honest.map((name, i) => [`worker${i + 1}`, account(name).address])),
    spammer: account(SPAMMER_KEY_NAME).address,
  };
  writeEvidence(evidence);
}

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
  console.log(`+ ${name}: ${JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 400)}`);
  return result;
}

/**
 * Publishes `rows` from one wallet in batches. Resumable: entries this wallet already has on chain
 * (from a run that stopped half-way, e.g. out of gas) are counted and skipped, so a rerun never
 * duplicates.
 */
async function publishBatches(keyName: string, creates: CreateEntityParameters[], existingKeys: Hex[]) {
  const wallet = walletFor(keyName);
  const keys = [...existingKeys];
  const txs: Hex[] = [];
  if (keys.length > 0) console.log(`  ${account(keyName).address} already has ${keys.length} on chain; publishing the remaining ${Math.max(0, creates.length - keys.length)}`);
  for (let i = keys.length; i < creates.length; i += MAX_BATCH) {
    const result = await wallet.executeBatch({ creates: creates.slice(i, i + MAX_BATCH) });
    keys.push(...result.createdEntities);
    txs.push(result.txHash);
  }
  return { keys, txs };
}

async function publishShifts(keyName: string, rows: ShiftInput[]) {
  const creator = account(keyName).address;
  const existing = await fetchShifts(client, { includeDemo: true, creators: [creator] }, 200);
  return { creator, ...(await publishBatches(keyName, rows.map(shiftCreate), existing.items.map((s) => s.key))) };
}

async function publishIncidents(keyName: string, rows: IncidentInput[]) {
  const creator = account(keyName).address;
  const existing = await fetchIncidents(client, { includeDemo: true, creators: [creator] }, 200);
  return { creator, ...(await publishBatches(keyName, rows.map(incidentCreate), existing.items.filter((i) => !i.parent).map((i) => i.key))) };
}

const LIST_NAME = "Nexora demo: honest seed workers";
const LIST_DESCRIPTION = "Synthetic demo. Includes seed workers 1–9; excludes seed wallet 10, which publishes implausible earnings on purpose.";

const shifts = await step("batch_shifts", "executeBatch: 16 synthetic days of earnings from each of nine honest workers", async () => {
  const perWorker = [];
  for (let i = 0; i < PROFILES.length; i++) perWorker.push(await publishShifts(worker(i), honestShifts(PROFILES[i]!, 1000 + i)));
  return {
    creators: perWorker.map((w) => w.creator),
    entities: perWorker.reduce((n, w) => n + w.keys.length, 0),
    keys: perWorker.flatMap((w) => w.keys),
    txs: perWorker.flatMap((w) => w.txs),
  };
});

await step("batch_spammer", "executeBatch: 15 implausible ₹350–450/hour days from the deliberate spammer", async () => {
  const result = await publishShifts(SPAMMER_KEY_NAME, spamShifts(15));
  return { creator: result.creator, entities: result.keys.length, keys: result.keys, txs: result.txs };
});

await step("batch_incidents", "executeBatch: 1–3 synthetic incidents (ID blocks, pay cuts, penalties…) from each honest worker", async () => {
  const perWorker = [];
  for (let i = 0; i < PROFILES.length; i++) {
    perWorker.push(await publishIncidents(worker(i), honestIncidents(PROFILES[i]!, 2000 + i, i === 4 ? "id_blocked" : undefined)));
  }
  return {
    creators: perWorker.map((w) => w.creator),
    entities: perWorker.reduce((n, w) => n + w.keys.length, 0),
    keys: perWorker.flatMap((w) => w.keys),
    txs: perWorker.flatMap((w) => w.txs),
  };
});

await step("incident_followup", "key-typed parent attribute: worker 5 posts that their ID block was lifted, worker 6 reports the same thing happened to them", async () => {
  // Found by query rather than by position, so a resumed run still picks worker 5's ID block.
  const blocks = await fetchIncidents(client, { includeDemo: true, creators: [account(worker(4)).address], type: "id_blocked" }, 20);
  const o = blocks.items.find((i) => !i.parent);
  if (!o) throw new Error("worker 5's ID block report is missing");
  const parent = o.key;
  const base = { platform: o.platform, work: o.work, city: o.city, type: o.type, period: o.period, reasonGiven: false, expiresInDays: 365 as const, demo: true, parent };
  const update = await walletFor(worker(4)).createEntity(incidentCreate({ ...base, daysLost: 6, appealed: true, resolved: true }));
  const sameHere = await walletFor(worker(5)).createEntity(incidentCreate({ ...base, daysLost: 3, appealed: false, resolved: false }));
  const check = await fetchIncidents(client, { includeDemo: true, parent }, 5);
  return { parent, keys: [update.entityKey, sameHere.entityKey], txs: [update.txHash, sameHere.txHash], query: check.query, foundByParentQuery: check.items.length };
});

await step("sealed_payload", "client-side AES-256-GCM sealed exact figures in the payload (demo passphrase is public on purpose)", async () => {
  const [row] = honestShifts(PROFILES[2]!, 55);
  const sealed = await seal({ grossInr: row!.grossInr, costsInr: row!.costsInr, hours: row!.hours, orders: 19, note: "synthetic demo day" }, DEMO_PASSPHRASE);
  const result = await walletFor(worker(2)).createEntity(shiftCreate({ ...row!, sealed }));
  return { key: result.entityKey, tx: result.txHash, demoPassphrase: DEMO_PASSPHRASE };
});

const list = await step("trust_list_create", "trust list entity curated by the sponsor wallet; starts with workers 1–8", async () => {
  const result = await walletFor(SPONSOR_KEY_NAME).createEntity(trustListCreate({
    name: LIST_NAME,
    scope: "all",
    description: LIST_DESCRIPTION,
    members: honest.slice(0, 8).map((name) => account(name).address),
  }));
  return { key: result.entityKey, tx: result.txHash };
});
if (list?.key && !dry) {
  evidence.recommendedTrustList = list.key as Hex;
  writeEvidence(evidence);
}

await step("trust_list_patch", "patchEntity by the owner: the curator adds worker 9", async () => {
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

const firstShift = (shifts?.keys as Hex[] | undefined)?.[0];
const secondShift = (shifts?.keys as Hex[] | undefined)?.[1];

await step("permissionless_extend", "extendEntity by a NON-owner (the sponsor) on worker 1's entry, allowed by permissionlessExtension", async () => {
  if (!firstShift) throw new Error("worker 1's entries are missing");
  const before = await fetchEntry(client, firstShift);
  if (!before.ok) throw new Error(before.reason);
  const target = before.value.expiresAt + BigInt(EXTEND_DAYS * 43_200);
  const result = await walletFor(SPONSOR_KEY_NAME).extendEntity({ entityKey: firstShift, expires: ExpirationTime.atBlock(target) });
  return {
    key: firstShift, owner: before.value.owner, extendedBy: account(SPONSOR_KEY_NAME).address, tx: result.txHash,
    expiresBefore: before.value.expiresAt.toString(), expiresAfter: result.expiresAt.toString(),
  };
});

await step("readonly_enforced", "patchEntity on a readonly entry must be refused, even for its owner", async () => {
  if (!secondShift) throw new Error("worker 1's entries are missing");
  const [row] = honestShifts(PROFILES[0]!, 66);
  const attempt = shiftCreate(row!);
  try {
    const result = await walletFor(worker(0)).patchEntity({ entityKey: secondShift, payload: attempt.payload, contentType: attempt.contentType, set: attempt.attributes });
    return { key: secondShift, unexpected: "patch succeeded", tx: result.txHash };
  } catch (error) {
    return { key: secondShift, refused: true, error: explainError(error) };
  }
});

await step("owner_delete", "deleteEntity by the owner: worker 2 publishes a mistaken day and removes it", async () => {
  const [row] = honestShifts(PROFILES[1]!, 88);
  const created = await walletFor(worker(1)).createEntity(shiftCreate({ ...row!, expiresInDays: 7 }));
  const deleted = await walletFor(worker(1)).deleteEntity({ entityKey: created.entityKey });
  const gone = await fetchShifts(client, { includeDemo: true, keys: [created.entityKey] }, 1);
  return { key: created.entityKey, createTx: created.txHash, deleteTx: deleted.txHash, stillQueryable: gone.items.length > 0 };
});

await step("ownership_lock", "executeBatch with an ownership change: worker 6 reports a deactivation and hands the entry to 0x…dEaD in the same transaction, so nobody (not even worker 6) can delete it early", async () => {
  const author = walletFor(worker(5));
  const created = await createLocked(client, author, account(worker(5)).address, incidentCreate({
    platform: "zomato", work: "food_delivery", city: "delhi_ncr", type: "deactivated", period: 202610,
    daysLost: 0, reasonGiven: false, appealed: true, resolved: false, expiresInDays: 365, demo: true,
  }));
  const after = await fetchEntry(client, created.entityKey);
  if (!after.ok) throw new Error(after.reason);
  let deleteRefused = false;
  let refusal = "";
  try {
    await author.deleteEntity({ entityKey: created.entityKey });
  } catch (error) {
    deleteRefused = true;
    refusal = explainError(error);
  }
  return { key: created.entityKey, tx: created.txHash, creator: after.value.creator, owner: after.value.owner, readonly: after.value.readonly, deleteRefused, refusal };
});

await step("union_reply", "replies linked by a key-typed parent: the demo trust list's curator, standing in for a union, answers three reports in one batch; a reply never changes the report", async () => {
  const curator = account(SPONSOR_KEY_NAME).address;
  const lockedKey = evidence.features.ownership_lock?.key as Hex | undefined;
  const blockKey = evidence.features.incident_followup?.parent as Hex | undefined;
  if (!lockedKey || !blockKey) throw new Error("run the earlier steps first");
  // A third report, chosen by query so a rerun picks the same one: the first open pay cut or penalty.
  const others = await fetchIncidents(client, { includeDemo: true, creators: honest.map((name) => account(name).address) }, 200);
  const third = others.items
    .filter((i) => !i.parent && !i.resolved && (i.type === "pay_cut" || i.type === "penalty") && i.key !== lockedKey && i.key !== blockKey)
    .sort((a, b) => a.key.localeCompare(b.key))[0];
  if (!third) throw new Error("no open pay cut or penalty report to answer");
  const answers: [Hex, ReplyStatus][] = [[lockedKey, "escalated"], [blockKey, "resolved"], [third.key, "received"]];
  const result = await walletFor(SPONSOR_KEY_NAME).executeBatch({
    creates: answers.map(([parent, status]) => replyCreate({ parent, status, period: 202610, expiresInDays: 365, demo: true })),
  });
  const check = await fetchReplies(client, { includeDemo: true, parent: lockedKey }, 5);
  return {
    curator, keys: result.createdEntities, tx: result.txHash,
    replies: answers.map(([parent, status], i) => ({ parent, status, key: result.createdEntities[i] })),
    query: check.query, foundByParentQuery: check.items.length,
  };
});

await step("worker_verdict", "the worker's word checks a reply: the demo trust list's curator says a pay-cut report is resolved, and the worker who reported it answers from the same wallet that it is not sorted out; Incidents counts it as disputed", async () => {
  const curator = account(SPONSOR_KEY_NAME).address;
  const answered = evidence.features.union_reply?.replies as { parent: Hex; status: ReplyStatus }[] | undefined;
  const parent = answered?.find((r) => r.status === "received")?.parent;
  if (!parent) throw new Error("run union_reply first");
  const found = await fetchEntry(client, parent);
  if (!found.ok || found.value.kind !== "incident") throw new Error("the answered report is not readable");
  const report = found.value;
  const name = honest.find((n) => account(n).address.toLowerCase() === report.creator.toLowerCase());
  if (!name) throw new Error("the report is not from a seed worker");
  const reply = await walletFor(SPONSOR_KEY_NAME).createEntity(replyCreate({ parent, status: "resolved", period: 202610, expiresInDays: 365, demo: true }));
  // A later transaction, so a later block: the worker's word comes after the claim it answers.
  const update = await walletFor(name).createEntity(incidentCreate({
    platform: report.platform, work: report.work, city: report.city, type: report.type, period: 202610, daysLost: report.daysLost,
    reasonGiven: report.reasonGiven, appealed: report.appealed, resolved: false, expiresInDays: 365, parent, demo: true,
  }));
  return { key: update.entityKey, tx: update.txHash, replyKey: reply.entityKey, replyTx: reply.txHash, parent, curator, worker: account(name).address };
});

await step("trust_list_renew", "extendEntity as a lease: only the curator can renew the trust list, to 180 days from today; a list nobody renews stops vouching", async () => {
  const key = list?.key as Hex;
  const before = await fetchTrustList(client, key);
  if (!before.ok) throw new Error(before.reason);
  const block = await client.getBlockNumber();
  const target = trustRenewal(before.value.expiresAt, block);
  if (target === null) throw new Error("the list was renewed too recently to renew again");
  const result = await walletFor(SPONSOR_KEY_NAME).extendEntity({ entityKey: key, expires: ExpirationTime.atBlock(target) });
  const after = await fetchTrustList(client, key);
  return {
    key, curator: account(SPONSOR_KEY_NAME).address, tx: result.txHash,
    expiresBefore: before.value.expiresAt.toString(), expiresAfter: (after.ok ? after.value.expiresAt : result.expiresAt).toString(),
  };
});

await step("history_at_block", "reads as of a past block: the trust list had 8 members just before its curator's patch and 9 after, and worker 2's deleted day is still readable at the block before its deletion, so anyone can show what was on record at a given time", async () => {
  const patched = evidence.features.trust_list_patch;
  const deleted = evidence.features.owner_delete;
  if (!patched?.tx || !deleted?.deleteTx) throw new Error("run the earlier steps first");
  const key = patched.key as Hex;
  const deletedKey = deleted.key as Hex;
  const patchBlock = (await client.getTransactionReceipt({ hash: patched.tx as Hex })).blockNumber;
  const deleteBlock = (await client.getTransactionReceipt({ hash: deleted.deleteTx as Hex })).blockNumber;
  const membersAt = async (block: bigint) => {
    const raw = await entityAtBlock(client, key, block);
    const list = raw ? decodeTrustList(raw) : null;
    if (!list?.ok) throw new Error(`no valid trust list at block ${block}`);
    return list.value.members.length;
  };
  const membersBefore = await membersAt(patchBlock - 1n);
  const membersAfter = await membersAt(patchBlock);
  const visibleBefore = (await entityAtBlock(client, deletedKey, deleteBlock - 1n)) !== null;
  const goneAtDelete = (await entityAtBlock(client, deletedKey, deleteBlock)) === null;
  if (membersAfter !== membersBefore + 1 || !visibleBefore || !goneAtDelete) throw new Error("history did not read back as expected");
  return {
    key, txs: [patched.tx, deleted.deleteTx],
    listBlockBefore: patchBlock - 1n, membersBefore, listBlockAfter: patchBlock, membersAfter,
    deletedKey, deletedVisibleAt: deleteBlock - 1n, deletedGoneAt: deleteBlock,
  };
});

console.log(dry ? "dry run complete" : "done; evidence written to arkiv/evidence.json");
