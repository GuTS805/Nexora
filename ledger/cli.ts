#!/usr/bin/env node
/**
 * nexora — read the public gig-worker ledger straight from Arkiv. No Nexora server, account or
 * wallet involved: if nexora's website disappeared tomorrow, this still works.
 *
 *   nexora earnings  [--platform swiggy] [--work food_delivery] [--city bengaluru] [--vehicle ev_scooter]
 *                    [--since 202608] [--day under8|8plus|10plus|12plus] [--min-cost 30]
 *                    [--demo] [--trust <listKey> | --creator <address>] [--json]
 *   nexora compare   --city <city> [--work <work>] [--vehicle <vehicle>] [--day 8plus] [--demo] [--trust <listKey>]
 *   nexora incidents [--platform …] [--city …] [--type id_blocked] [--demo] [--trust <listKey>] [--json]
 *   nexora show      <entityKey>       an entry; for a report, also its updates and the replies to it
 *   nexora at        <entityKey> --block <n> | --date <YYYY-MM-DD or ISO time>
 *                    the entity as it stood then, even if it was later deleted or expired;
 *                    for a trust list, who joined and left since
 *   nexora proof     <file | ->  [--challenge <text>]
 *                    check an authorship proof a worker gave you against the entry's $creator on chain
 *   nexora guides    [--curator <address>]  workers' rights by state and independent platform ratings, with sources
 *   nexora lists
 *   nexora verify    re-check every feature recorded in arkiv/evidence.json against the chain
 *   nexora audit     check every Nexora entity on chain against the JSON Schemas and for personal data [--json]
 *   nexora watch     live feed of new entries over WebSocket
 *
 *   --rpc <url>      use another Arkiv node (default: Tiramisu public RPC)
 */
import { readFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import {
  DAY_LENGTHS, HOURS_BAND_LABELS, comparePlatforms, entryPredicate, explainError, fetchEntries, fetchEntry, fetchIncidents,
  fetchShifts, fetchTrustList, fetchTrustLists, getEntityOrNull, incidentStats, liveClient, queryText, readClient,
  fetchRawEntities, fetchReplies, decodeReply, decodeTrustList, isLocked, repliesTo, type EntryFilters, type IncidentFilters, type ShiftFilters,
  blockAtDate, decodeEntry, entityAtBlock, memberChanges, parseProof, verifyAuthorship, fetchGuides, type RawEntity,
} from "./src/index.ts";
import { auditEntities } from "./src/contract.ts";

const [command = "help", ...rest] = process.argv.slice(2);
const flags = new Map<string, string | true>();
const positional: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i] ?? "";
  if (arg.startsWith("--")) {
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(arg.slice(2), next);
      i++;
    } else flags.set(arg.slice(2), true);
  } else positional.push(arg);
}
const flag = (name: string) => (typeof flags.get(name) === "string" ? (flags.get(name) as string) : undefined);
const client = readClient(flag("rpc"));
const json = (value: unknown) =>
  console.log(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

/** Turns --trust or --creator into a `$creator` filter; nothing means everyone. */
async function creatorsFromFlags(): Promise<Address[] | undefined> {
  const trust = flag("trust");
  if (trust) {
    const list = await fetchTrustList(client, trust as Hex);
    if (!list.ok) throw new Error(`Trust list ${trust} is invalid: ${list.reason}`);
    console.error(`trust list "${list.value.name}" by ${list.value.creator}: ${list.value.members.length} workers`);
    return list.value.members;
  }
  const creator = flag("creator");
  return creator ? [getAddress(creator)] : undefined;
}

async function commonFlags(): Promise<EntryFilters> {
  const since = flag("since");
  return {
    platform: flag("platform") as EntryFilters["platform"],
    work: flag("work") as EntryFilters["work"],
    city: flag("city") as EntryFilters["city"],
    minPeriod: since === undefined ? undefined : Number(since),
    includeDemo: flags.has("demo"),
    creators: await creatorsFromFlags(),
  };
}

/** --day and --min-cost, checked before any query is sent. */
function shiftFlags(): Pick<ShiftFilters, "vehicle" | "day" | "minCostPct"> {
  const day = flag("day");
  if (day !== undefined && !(day in DAY_LENGTHS)) throw new Error(`--day must be one of ${Object.keys(DAY_LENGTHS).join(", ")}`);
  const cost = flag("min-cost");
  const minCostPct = cost === undefined ? undefined : Number(cost);
  if (minCostPct !== undefined && !(Number.isInteger(minCostPct) && minCostPct >= 0 && minCostPct <= 100)) throw new Error("--min-cost must be a whole percentage from 0 to 100");
  return { vehicle: flag("vehicle") as ShiftFilters["vehicle"], day: day as ShiftFilters["day"], minCostPct };
}

const rupees = (n: number) => `₹${n}`;

/** --block, or --date: a bare date means the end of that day (UTC), an ISO time means that moment. */
async function blockFromFlags(): Promise<bigint> {
  const block = flag("block");
  if (block !== undefined) {
    if (!/^\d+$/.test(block)) throw new Error("--block must be a block number");
    return BigInt(block);
  }
  const date = flag("date");
  if (date === undefined) throw new Error("give --block <n> or --date <YYYY-MM-DD>");
  const when = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:59Z` : date);
  if (Number.isNaN(when.getTime())) throw new Error(`--date ${date} is not a date`);
  const found = await blockAtDate(client, when);
  if (found === null) throw new Error(`${date} is before the chain began`);
  return found;
}

/** The recorded past reads: list sizes either side of its patch, and the deleted day either side of its deletion. */
async function historyHolds(step: Record<string, unknown>): Promise<boolean> {
  const at = (key: unknown, block: unknown) => entityAtBlock(client, key as Hex, BigInt(String(block)));
  const size = (raw: RawEntity | null) => {
    const list = raw ? decodeTrustList(raw) : null;
    return list?.ok ? list.value.members.length : -1;
  };
  const [before, after, visible, gone] = await Promise.all([
    at(step.key, step.listBlockBefore), at(step.key, step.listBlockAfter), at(step.deletedKey, step.deletedVisibleAt), at(step.deletedKey, step.deletedGoneAt),
  ]);
  return size(before) === step.membersBefore && size(after) === step.membersAfter && visible !== null && gone === null;
}

/** Any Nexora entity, decoded by whichever contract it follows. */
function decodeAny(raw: RawEntity) {
  return [decodeEntry(raw), decodeTrustList(raw), decodeReply(raw)].find((d) => d.ok);
}
const EVIDENCE_URL = "https://raw.githubusercontent.com/GuTS805/Nexora/main/arkiv/evidence.json";

try {
switch (command) {
  case "earnings": {
    const filters: ShiftFilters = { ...(await commonFlags()), ...shiftFlags() };
    const result = await fetchShifts(client, filters);
    if (flags.has("json")) {
      json(result);
      break;
    }
    console.log(`query @ block ${result.blockNumber}:\n  ${result.query}\n`);
    for (const s of result.items) {
      console.log(`${s.key}  ${s.period}  ${`${s.platform}/${s.work}`.padEnd(28)} ${s.city.padEnd(11)} ${s.vehicle.padEnd(12)} ${(HOURS_BAND_LABELS[s.hoursBand] ?? "").padEnd(8)} ${rupees(s.netHourly).padStart(5)}/h  costs ${String(s.costPct).padStart(3)}%  by ${s.creator}`);
    }
    console.log(`\n${result.items.length} valid, ${result.rejected.length} rejected by the contract${result.truncated ? ", truncated" : ""}`);
    break;
  }
  case "compare": {
    const filters = await commonFlags();
    if (!filters.city) throw new Error("--city is required");
    const [shifts, incidents] = await Promise.all([
      fetchShifts(client, { ...filters, ...shiftFlags() }),
      fetchIncidents(client, filters),
    ]);
    console.log(`based on ${shifts.items.length} days and ${incidents.items.length} incidents matching:\n  ${shifts.query}\n`);
    // With --trust, every row already comes from a list member, so every worker counts as trusted.
    for (const row of comparePlatforms(shifts.items, incidents.items)) {
      const change = row.monthChangePct === null ? "" : `, ${row.monthChangePct > 0 ? "+" : ""}${row.monthChangePct}% vs last month`;
      const workers = `${row.trustedWorkers} independent worker${row.trustedWorkers === 1 ? "" : "s"}`;
      console.log(`${row.confirmed ? "CONFIRMED " : "unconfirmed"} ${`${row.platform}/${row.work}`.padEnd(28)} ${rupees(row.medianHourly)}/h take-home (middle half ${rupees(row.p25Hourly)}–${rupees(row.p75Hourly)}), costs ${row.medianCostPct}%${change} — ${workers}, ${row.shifts} days, ${row.incidents} incidents`);
    }
    if (!filters.creators) console.log("\nEveryone's wallets count here, and wallets are free. Add --trust <listKey> (see `lists`) to count only workers a union or group vouches for.");
    break;
  }
  case "incidents": {
    const filters: IncidentFilters = { ...(await commonFlags()), type: flag("type") as IncidentFilters["type"] };
    const result = await fetchIncidents(client, filters);
    if (flags.has("json")) {
      json(result);
      break;
    }
    console.log(`query @ block ${result.blockNumber}:\n  ${result.query}\n`);
    for (const s of incidentStats(result.items)) {
      console.log(`${s.type.padEnd(16)} ${String(s.reports).padStart(3)} reports from ${s.workers} workers · median ${s.medianDaysLost} days without work · no reason given in ${Math.round(s.noReasonShare * 100)}% · resolved ${Math.round(s.resolvedShare * 100)}%`);
    }
    console.log(`\n${result.items.length} valid, ${result.rejected.length} rejected by the contract`);
    break;
  }
  case "show": {
    const key = positional[0] as Hex | undefined;
    if (!key) throw new Error("usage: nexora show <entityKey>");
    const decoded = await fetchEntry(client, key);
    if (decoded.ok) {
      json(decoded.value);
      if (decoded.value.kind === "incident") {
        const [updates, replies] = await Promise.all([
          fetchIncidents(client, { parent: key, includeDemo: true }),
          fetchReplies(client, { parent: key, includeDemo: true }),
        ]);
        console.log(`updates and "same here" reports: ${updates.items.map((c) => c.key).join(", ") || "none"}`);
        // Replies from the reporter's own wallet are not answers; repliesTo leaves them out.
        const answers = repliesTo(decoded.value, replies.items);
        console.log(`replies: ${answers.map((r) => `${r.status} by ${r.creator} (${r.key})`).join(", ") || "none"}`);
      }
    } else {
      const raw = await getEntityOrNull(client, key);
      const other = raw ? [decodeTrustList(raw), decodeReply(raw)].find((d) => d.ok) : undefined;
      if (other?.ok) json(other.value);
      else console.log(`not a valid Nexora entry: ${decoded.reason}`);
    }
    break;
  }
  case "at": {
    const key = positional[0] as Hex | undefined;
    if (!key) throw new Error("usage: nexora at <entityKey> --block <n> | --date <YYYY-MM-DD>");
    const block = await blockFromFlags();
    const [then, now] = await Promise.all([entityAtBlock(client, key, block), getEntityOrNull(client, key)]);
    console.log(`as of block ${block}:`);
    if (!then) {
      console.log(`  not on chain then (not yet created, or already deleted or expired)${now ? "; it exists now" : ""}`);
      break;
    }
    const decoded = decodeAny(then);
    if (decoded?.ok) json(decoded.value);
    else console.log("  not a valid Nexora entity");
    console.log(now ? "now: still on chain" : "now: gone (deleted or expired), yet the record above stays readable at that block");
    const list = decoded?.ok && "members" in decoded.value ? decoded.value : null;
    const current = now ? decodeTrustList(now) : null;
    if (list && current?.ok) {
      const { added, removed } = memberChanges(list.members, current.value.members);
      console.log(`members then ${list.members.length}, now ${current.value.members.length}; joined since: ${added.join(", ") || "none"}; left since: ${removed.join(", ") || "none"}`);
    }
    break;
  }
  case "proof": {
    const source = positional[0];
    if (!source) throw new Error("usage: nexora proof <file | -> [--challenge <text>]");
    const proof = parseProof(readFileSync(source === "-" ? 0 : source, "utf8"));
    if (!proof) throw new Error("not a Nexora authorship proof");
    // Authorship is the creator Arkiv recorded, read from the chain, never anything the proof claims.
    const raw = await getEntityOrNull(client, proof.entityKey);
    if (!raw?.creator) throw new Error(`entry ${proof.entityKey} is not on chain now (deleted or expired); check it with \`nexora at\` first`);
    const ok = await verifyAuthorship(proof, { entityKey: proof.entityKey, creator: raw.creator as Address, challenge: flag("challenge") });
    console.log(`entry ${proof.entityKey}, written by ${raw.creator}`);
    console.log(`challenge in the proof: ${proof.challenge || "(none)"}`);
    console.log(ok ? "VALID: signed by the wallet that wrote this entry" : "INVALID: not signed by the entry's author, or not for this challenge");
    if (!ok) process.exitCode = 1;
    break;
  }
  case "verify": {
    // Re-check the seed script's recorded evidence against the chain (same checks as the Proof page).
    // From a clone, the repo's copy; from the npm package (which does not ship it), the published one.
    let text: string;
    try {
      text = readFileSync(new URL("../arkiv/evidence.json", import.meta.url), "utf8");
    } catch {
      const response = await fetch(EVIDENCE_URL);
      if (!response.ok) throw new Error(`could not fetch ${EVIDENCE_URL}: HTTP ${response.status}`);
      text = await response.text();
    }
    const evidence = JSON.parse(text) as { features: Record<string, Record<string, unknown>> };
    const steps = Object.entries(evidence.features);
    if (steps.length === 0) console.log("no recorded evidence yet: run npm run seed with a funded wallet");
    for (const [name, step] of steps) {
      const key = (step.key ?? (step.keys as Hex[] | undefined)?.[0]) as Hex | undefined;
      if (!key) {
        console.log(`-    ${name}: no entity to check`);
        continue;
      }
      const entity = await getEntityOrNull(client, key);
      const entityFlags = entity?.creationFlags;
      const verdict =
        name === "owner_delete" ? entity === null :
        name === "ownership_lock" ? entity !== null && !!entityFlags?.readonly && isLocked(entity.owner ?? "") :
        name === "trust_list_create" || name === "trust_list_patch" ? entity !== null && entityFlags?.readonly === false :
        name === "trust_list_renew" ? entity !== null && entityFlags?.readonly === false && (entity.expiresAt ?? 0n) >= BigInt(String(step.expiresAfter)) && String(entity.owner).toLowerCase() === String(step.curator).toLowerCase() :
        name === "union_reply" ? entity !== null && !!entityFlags?.readonly && String(entity.creator).toLowerCase() === String(step.curator).toLowerCase() :
        name === "history_at_block" ? entity !== null && (await historyHolds(step)) :
        name === "permissionless_extend" ? !!entityFlags?.permissionlessExtension && String(step.extendedBy).toLowerCase() !== String(entity?.owner).toLowerCase() :
        entity !== null && !!entityFlags?.readonly;
      console.log(`${verdict ? "ok  " : "FAIL"} ${name}: ${key}${entity ? ` creator ${entity.creator}` : " (gone)"}`);
    }
    break;
  }
  case "audit": {
    const page = await fetchRawEntities(client);
    if (page.truncated) throw new Error("more entities than one audit reads; nothing was judged");
    const report = auditEntities(page.raw);
    if (flags.has("json")) {
      json({ query: page.query, blockNumber: page.blockNumber, ...report });
    } else {
      console.log(`query @ block ${page.blockNumber}:\n  ${page.query}\n`);
      console.log(`${report.checked} entities claim to be Nexora data`);
      console.log(`  shown by readers: ${report.shown.shift} earnings days, ${report.shown.incident} incidents, ${report.shown.reply} replies, ${report.shown.trust_list} trust lists`);
      console.log(`  rejected by readers (never shown or counted): ${report.rejected.length}`);
      for (const r of report.rejected) console.log(`    ${r.key}  ${r.reason}`);
      console.log(`\nstrict schema + personal-data scan over every shown entry: ${report.violations.length} violation(s)`);
      for (const v of report.violations) console.log(`  FAIL ${v.kind} ${v.key} by ${v.creator}${v.demo ? " (demo)" : ""}\n       ${v.problems.join("\n       ")}`);
      const { real, demo } = report.linkability;
      console.log("\nincident wallets that also wrote earnings (so a report can be linked to pay):");
      console.log(`  workers' entries: ${real.alsoWroteEarnings.length} of ${real.incidentWallets}`);
      console.log(`  demo data: ${demo.alsoWroteEarnings.length} of ${demo.incidentWallets} (seed wallets write both by design; the app defaults to a one-time wallet)`);
      console.log(report.passed ? "\nPASS: every entry readers show follows the published contract and carries no personal data in clear text" : "\nFAIL");
    }
    if (!report.passed) process.exitCode = 1;
    break;
  }
  case "guides": {
    const curator = flag("curator");
    const result = await fetchGuides(client, curator ? getAddress(curator) : undefined);
    for (const g of result.items) {
      console.log(`${g.scope.padEnd(10)} ${g.topic.padEnd(7)} ${g.title}\n           ${g.status}\n           checked ${g.checked}; by ${g.creator}; ${g.key}`);
      for (const point of g.points) console.log(`           - ${point}`);
      if (g.scores) console.log(`           scores: ${Object.entries(g.scores).map(([p, s]) => `${p} ${s}/10`).join(", ")}`);
      for (const source of g.sources) console.log(`           source: ${source.label} <${source.url}>`);
    }
    console.log(`\n${result.items.length} guides, ${result.rejected.length} rejected by the contract\nquery: ${result.query}${curator ? "" : "\nAnyone can publish a guide; pass --curator <address> to read only one you trust."}`);
    break;
  }
  case "lists": {
    const result = await fetchTrustLists(client);
    for (const list of result.items) console.log(`${list.key}  "${list.name}" (${list.scope}) by ${list.creator}: ${list.members.length} members`);
    console.log(`\nquery: ${result.query}`);
    break;
  }
  case "watch": {
    const live = liveClient(flag("ws"));
    console.log(`watching for new Nexora entries…\n  filter: ${queryText(entryPredicate({ includeDemo: true }))}`);
    // Events carry no attributes: batch new keys and check them with one $key-filtered query.
    const pending: Hex[] = [];
    live.watchEntityEvents({
      onEntityCreated: (event) => {
        pending.push(event.entityKey);
      },
      onError: (error) => console.error(`watch error: ${explainError(error)}`),
    });
    setInterval(async () => {
      const batch = pending.splice(0, 25);
      if (batch.length === 0) return;
      try {
        const found = await fetchEntries(client, { keys: batch, includeDemo: true }, 25);
        for (const e of found.items) {
          const what = e.kind === "shift" ? `${rupees(e.netHourly)}/h` : e.type;
          console.log(`+ ${e.key} ${e.kind} ${e.platform}/${e.work} ${e.city} ${what} by ${getAddress(e.creator)}`);
        }
      } catch (error) {
        console.error(`lookup failed: ${explainError(error)}`);
      }
    }, 5_000);
    break;
  }
  default:
    console.log("commands: earnings | compare --city <c> | incidents | show <key> | at <key> --date <d> | proof <file> | guides | lists | watch | verify | audit   (see header of ledger/cli.ts)");
}
} catch (error) {
  console.error(`error: ${explainError(error)}`);
  // exitCode, not process.exit(): exiting with sockets still closing trips a libuv assertion on Windows.
  process.exitCode = 1;
}
