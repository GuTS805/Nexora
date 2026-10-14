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
 *   nexora verify    re-check every feature recorded in arkiv/evidence.json against the chain
 *   nexora watch     live feed of new entities over WebSocket
 *
 *   --rpc <url>      use another Arkiv node (default: Tiramisu public RPC)
 */
import { readFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import {
  SPEND_BAND_LABELS, explainError, getEntityOrNull, experimentPredicate, fetchExperiment, fetchExperiments,
  fetchTrustList, fetchTrustLists, liveClient, queryText, readClient, suggest,
  type ExperimentFilters,
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

try {
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
  case "verify": {
    // Re-check the seed script's recorded evidence against the chain (same checks as the Proof page).
    const file = new URL("../arkiv/evidence.json", import.meta.url);
    const evidence = JSON.parse(readFileSync(file, "utf8")) as { features: Record<string, Record<string, unknown>> };
    const steps = Object.entries(evidence.features);
    if (steps.length === 0) console.log("no recorded evidence yet: run npm run seed with a funded wallet");
    for (const [name, step] of steps) {
      const key = (step.key ?? (step.keys as Hex[] | undefined)?.[0]) as Hex | undefined;
      if (!key) {
        console.log(`-    ${name}: no entity to check`);
        continue;
      }
      const entity = await getEntityOrNull(client, key);
      const flags = entity?.creationFlags;
      const verdict =
        name === "owner_delete" ? entity === null :
        name === "trust_list_create" || name === "trust_list_patch" ? entity !== null && flags?.readonly === false :
        name === "permissionless_extend" ? !!flags?.permissionlessExtension && String(step.extendedBy).toLowerCase() !== String(entity?.owner).toLowerCase() :
        entity !== null && !!flags?.readonly;
      console.log(`${verdict ? "ok  " : "FAIL"} ${name}: ${key}${entity ? ` creator ${entity.creator}` : " (gone)"}`);
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
        const found = await fetchExperiments(client, { keys: batch, includeDemo: true }, 25);
        for (const e of found.items) console.log(`+ ${e.key} ${e.platform}/${e.format} ROI ${e.roiPct}% by ${getAddress(e.creator)}`);
      } catch (error) {
        console.error(`lookup failed: ${explainError(error)}`);
      }
    }, 5_000);
    break;
  }
  default:
    console.log("commands: query | recommend | show <key> | lists | watch | verify   (see header of ledger/cli.ts)");
}
} catch (error) {
  console.error(`error: ${explainError(error)}`);
  // exitCode, not process.exit(): exiting with sockets still closing trips a libuv assertion on Windows.
  process.exitCode = 1;
}
