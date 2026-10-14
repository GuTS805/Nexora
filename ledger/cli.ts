#!/usr/bin/env -S npx tsx
/**
 * nexora — read the public gig-worker ledger straight from Arkiv. No Nexora server, account or
 * wallet involved: if nexora's website disappeared tomorrow, this still works.
 *
 *   nexora earnings  [--platform swiggy] [--work food_delivery] [--city bengaluru] [--vehicle ev_scooter]
 *                    [--since 202608] [--demo] [--trust <listKey> | --creator <address>] [--json]
 *   nexora compare   --city <city> [--work <work>] [--vehicle <vehicle>] [--demo] [--trust <listKey>]
 *   nexora incidents [--platform …] [--city …] [--type id_blocked] [--demo] [--trust <listKey>] [--json]
 *   nexora show      <entityKey>
 *   nexora lists
 *   nexora verify    re-check every feature recorded in arkiv/evidence.json against the chain
 *   nexora watch     live feed of new entries over WebSocket
 *
 *   --rpc <url>      use another Arkiv node (default: Tiramisu public RPC)
 */
import { readFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import {
  HOURS_BAND_LABELS, comparePlatforms, entryPredicate, explainError, fetchEntries, fetchEntry, fetchIncidents,
  fetchShifts, fetchTrustList, fetchTrustLists, getEntityOrNull, incidentStats, liveClient, queryText, readClient,
  type EntryFilters, type IncidentFilters, type ShiftFilters,
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

const rupees = (n: number) => `₹${n}`;

try {
switch (command) {
  case "earnings": {
    const filters: ShiftFilters = { ...(await commonFlags()), vehicle: flag("vehicle") as ShiftFilters["vehicle"] };
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
      fetchShifts(client, { ...filters, vehicle: flag("vehicle") as ShiftFilters["vehicle"] }),
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
        const updates = await fetchIncidents(client, { parent: key, includeDemo: true });
        console.log(`updates and "same here" reports: ${updates.items.map((c) => c.key).join(", ") || "none"}`);
      }
    } else {
      const list = await fetchTrustList(client, key);
      if (list.ok) json(list.value);
      else console.log(`not a valid Nexora entry: ${decoded.reason}`);
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
      const entityFlags = entity?.creationFlags;
      const verdict =
        name === "owner_delete" ? entity === null :
        name === "trust_list_create" || name === "trust_list_patch" ? entity !== null && entityFlags?.readonly === false :
        name === "permissionless_extend" ? !!entityFlags?.permissionlessExtension && String(step.extendedBy).toLowerCase() !== String(entity?.owner).toLowerCase() :
        entity !== null && !!entityFlags?.readonly;
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
    console.log("commands: earnings | compare --city <c> | incidents | show <key> | lists | watch | verify   (see header of ledger/cli.ts)");
}
} catch (error) {
  console.error(`error: ${explainError(error)}`);
  // exitCode, not process.exit(): exiting with sockets still closing trips a libuv assertion on Windows.
  process.exitCode = 1;
}
