# nexora-ledger

The open data contract behind [Nexora](https://github.com/GuTS805/Nexora): a worker-written record, stored on [Arkiv](https://arkiv.network), of what gig work in India pays and what happens to workers (ID blocks, pay cuts, penalties).

This package is what the Nexora web app itself uses. With it, any union, researcher, journalist or app can read, check and write the same data without Nexora's website or servers.

```bash
npm install nexora-ledger
```

## Read

```js
import { comparePlatforms, fetchIncidents, fetchShifts, readClient } from "nexora-ledger";

const client = readClient(); // public Tiramisu RPC; pass another URL to use your own node
const shifts = await fetchShifts(client, { city: "delhi_ncr", work: "cab", includeDemo: true });
const incidents = await fetchIncidents(client, { city: "delhi_ncr", includeDemo: true });

for (const row of comparePlatforms(shifts.items, incidents.items)) {
  console.log(row.platform, `₹${row.medianHourly}/h`, row.confirmed ? "confirmed" : "unconfirmed");
}
console.log(shifts.query); // the exact Arkiv query, to paste into any other client
```

Every entity is validated before it is used, because anyone can write data that claims to be Nexora's. Entities that fail are returned in `rejected` with a reason, never silently dropped.

To count only workers a union vouches for, pass `creators: list.members` from `fetchTrustList(client, key)`. That filter runs on Arkiv's `$creator`, which no writer can forge.

A trust list is a 180-day lease only its curator can renew: `trustRenewal(list.expiresAt, currentBlock)` gives the block to renew to with `extendEntity`, or `null` when renewing would not add time.

To read what was on record at a past time, `blockAtDate(client, date)` finds the block at that moment and `entityAtBlock(client, key, block)` returns the entity as it stood then, or `null`. It works for entities deleted or expired since: deletion removes them from the current state, not from history. `memberChanges(listThen.members, listNow.members)` says who joined or left a trust list since.

Replies to a report (from a union, a worker group or the platform) come from `fetchReplies(client, { parent: reportKey })`. `repliesTo(report, replies, trusted?)` leaves out the reporter's own wallet and, given a set of wallets, keeps only theirs.

## Check (JSON Schema and privacy audit)

```js
import { JSON_SCHEMAS, auditEntities, validateEntity } from "nexora-ledger/contract";
import shiftSchema from "nexora-ledger/schema/shift.schema.json" with { type: "json" };
```

- `JSON_SCHEMAS` and the files in `schema/` are JSON Schema 2020-12, one per entity kind (`shift`, `incident`, `reply`, `trust-list`). They are strict: every attribute is listed and nothing else is allowed, because an extra attribute is how a name or phone number would leak.
- `validateEntity(kind, entity)` checks an entity read from Arkiv, or `createEntity` parameters before you send them.
- `auditEntities(entities)` runs the public privacy audit. It holds every entry readers would show to the strict schema and scans every clear-text string for phone numbers, email addresses and 12-digit ID numbers.

## Write

```js
import { shiftCreate } from "nexora-ledger";

const params = shiftCreate({
  platform: "swiggy", work: "food_delivery", city: "bengaluru", vehicle: "petrol_bike",
  period: 202610, grossInr: 1180, costsInr: 240, hours: 10, incentive: "met", expiresInDays: 90,
});
// await walletClient.createEntity(params)   (an @arkiv-network/sdk wallet client)
```

A union answers a report with `replyCreate({ parent: reportKey, status: "taken_up", period: 202610, expiresInDays: 365 })`; statuses are `received`, `taken_up`, `escalated`, `resolved` and `cannot_help`.

Exact rupees and hours never reach the chain. They become an hours band and a take-home-per-hour figure rounded to ₹10. Exact figures go only into an optional sealed box (`seal()`), AES-256-GCM encrypted on the device.

## CLI

```bash
npx -p nexora-ledger nexora earnings --demo --city bengaluru
npx -p nexora-ledger nexora compare --demo --city delhi_ncr --work cab
npx -p nexora-ledger nexora earnings --demo --city bengaluru --day 8plus   # days of 8 h or more (hours_band >= 2)
npx -p nexora-ledger nexora at <entityKey> --date 2026-10-15   # as it stood then, even if later deleted
npx -p nexora-ledger nexora audit      # every Nexora entity on chain vs the schemas
npx -p nexora-ledger nexora verify     # re-check the project's recorded on-chain evidence
```

The CLI uses `ARKIV_RPC_URL` if it is set (for example the public RPC with an Arkiv Hub access key appended), or `--rpc <url>`.

## Contract

Human-readable: [`arkiv/schema.md`](https://github.com/GuTS805/Nexora/blob/main/arkiv/schema.md). Network: Arkiv Tiramisu testnet, SDK `@arkiv-network/sdk` 0.8.1. Schema version 1.

MIT licensed. Platform names identify where the work was done. Demo entries are synthetic and say nothing about any real company.
