#!/usr/bin/env -S npx tsx
/**
 * nexora — read the public ad-experiment ledger straight from Arkiv. No Nexora server, account or
 * wallet involved: if nexora's website disappeared tomorrow, this still works.
 *
 *   nexora query     [--category tea_coffee] [--platform instagram] [--tier tier2] [--lang hi]
 *                    [--season diwali] [--min-roi 0] [--min-band 1] [--max-band 3] [--demo]
 *                    [--trust <listKey> | --creator <address>] [--json]
 *   nexora recommend --category <c> [--tier <t>] [--demo] [--trust <listKey>]
 *   nexora show      <entityKey>
 *   nexora lists
 *   nexora watch     live feed of new entities over WebSocket
 *
 *   --rpc <url>      use another Arkiv node (default: Tiramisu public RPC)
 */
import { getAddress, type Address, type Hex } from "viem";
import {
  SPEND_BAND_LABELS, decodeExperiment, experimentPredicate, fetchExperiment, fetchExperiments,
  fetchTrustList, fetchTrustLists, liveClient, queryText, readClient, suggest,
  type ExperimentFilters, type RawEntity,
} from "./src/index.ts";

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

async function filtersFromFlags(): Promise<ExperimentFilters> {
  let creators: Address[] | undefined;
  const trust = flag("trust");
  if (trust) {
    const list = await fetchTrustList(client, trust as Hex);
    if (!list.ok) throw new Error(`Trust list ${trust} is invalid: ${list.reason}`);
    creators = list.value.members;
    console.error(`trust list "${list.value.name}" by ${list.value.creator}: ${creators.length} publishers`);
  }
  const creator = flag("creator");
  if (creator) creators = [getAddress(creator)];
  const minRoi = flag("min-roi");
  const num = (name: string) => (flag(name) === undefined ? undefined : Number(flag(name)));
  return {
    minBand: num("min-band"),
    maxBand: num("max-band"),
    category: flag("category") as ExperimentFilters["category"],
    platform: flag("platform") as ExperimentFilters["platform"],
    tier: flag("tier") as ExperimentFilters["tier"],
    lang: flag("lang") as ExperimentFilters["lang"],
    season: flag("season") as ExperimentFilters["season"],
    minRoi: minRoi === undefined ? undefined : Number(minRoi),
    includeDemo: flags.has("demo"),
    creators,
  };
}

switch (command) {
  case "query": {
    const filters = await filtersFromFlags();
    const result = await fetchExperiments(client, filters);
    if (flags.has("json")) {
      json(result);
      break;
    }
    console.log(`query @ block ${result.blockNumber}:\n  ${result.query}\n`);
    for (const e of result.items) {
      console.log(`${e.key}  ${e.category.padEnd(18)} ${`${e.platform}/${e.format}`.padEnd(26)} ${e.tier.padEnd(9)} ${e.lang.padEnd(8)} ${(SPEND_BAND_LABELS[e.spendBand] ?? "").padEnd(9)} ROI ${String(e.roiPct).padStart(5)}%  by ${e.creator}`);
    }
    console.log(`\n${result.items.length} valid, ${result.rejected.length} rejected by the contract${result.truncated ? ", truncated" : ""}`);
    break;
  }
  case "recommend": {
    const filters = await filtersFromFlags();
    if (!filters.category) throw new Error("--category is required");
    const result = await fetchExperiments(client, filters);
    console.log(`based on ${result.items.length} experiments matching:\n  ${result.query}\n`);
    for (const s of suggest(result.items)) {
      if (s.kind === "proven") {
        const c = s.combo;
        console.log(`TRY      ${c.platform}/${c.format} — ${c.trustedPublishers} independent sellers, median ROI ${Math.round(c.medianRoi)}%, ${Math.round(c.winRate * 100)}% of runs profitable`);
        console.log(`         evidence: ${c.evidence.slice(0, 5).join(", ")}${c.evidence.length > 5 ? ", …" : ""}`);
      } else {
        console.log(`EXPLORE  ${s.platform}/${s.format} — barely tested neighbour of ${s.basedOn.platform}/${s.basedOn.format}; try with ~10% of budget and publish the result`);
      }
    }
    break;
  }
  case "show": {
    const key = positional[0] as Hex | undefined;
    if (!key) throw new Error("usage: nexora show <entityKey>");
    const decoded = await fetchExperiment(client, key);
    if (decoded.ok) {
      json(decoded.value);
      const children = await fetchExperiments(client, { parent: key, includeDemo: true });
      console.log(`variants published by others: ${children.items.map((c) => c.key).join(", ") || "none"}`);
    } else {
      const list = await fetchTrustList(client, key);
      if (list.ok) json(list.value);
      else console.log(`not a valid Nexora entity: ${decoded.reason}`);
    }
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
    console.log(`watching for new Nexora experiments…\n  filter: ${queryText(experimentPredicate({ includeDemo: true }))}`);
    live.watchEntityEvents({
      onEntityCreated: async (event) => {
        const entity = await client.getEntity(event.entityKey).catch(() => null);
        if (!entity) return;
        const decoded = decodeExperiment(entity as RawEntity);
        if (decoded.ok) console.log(`+ ${decoded.value.key} ${decoded.value.platform}/${decoded.value.format} ROI ${decoded.value.roiPct}% by ${getAddress(decoded.value.creator)} (block ${event.blockNumber})`);
      },
      onError: (error) => console.error(`watch error: ${error.message}`),
    });
    break;
  }
  default:
    console.log("commands: query | recommend | show <key> | lists | watch   (see header of ledger/cli.ts)");
}
