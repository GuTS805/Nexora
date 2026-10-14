# Nexora data contract on Arkiv (schema v1)

Network: **Tiramisu testnet**, chain ID `7738577`, RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network`.
SDK: `@arkiv-network/sdk` **0.8.1**. The contract is implemented in [`ledger/src/schema.ts`](../ledger/src/schema.ts) (vocabularies, banding), [`ledger/src/codec.ts`](../ledger/src/codec.ts) (writes and validation) and [`ledger/src/queries.ts`](../ledger/src/queries.ts) (reads). The web app, the CLI and the seed script all go through these files, so they write identical entity shapes.

Every Nexora entity carries `app = "nexora"`, `kind`, and `v = 1`. Readers **must** validate entities against this document before using them: anyone can write an entity that claims `app = "nexora"`. The reference decoder rejects anything outside the vocabularies below, and the UI reports how many entities it rejected.

## Shared vocabularies

| Name | Values |
| --- | --- |
| `platform` | `swiggy` `zomato` `blinkit` `zepto` `bigbasket` `amazon` `flipkart` `uber` `ola` `rapido` `porter` `urban_company` `other` |
| `work` | `food_delivery` `grocery_delivery` `parcel_delivery` `cab` `bike_taxi` `auto` `home_services` |
| `city` | `delhi_ncr` `mumbai` `bengaluru` `hyderabad` `chennai` `kolkata` `pune` `ahmedabad` `jaipur` `lucknow` `indore` `kochi` `chandigarh` `other_city` |
| `vehicle` | `bicycle` `ev_scooter` `petrol_bike` `auto` `car` `none` |
| `period` | the month, as an `i32` `YYYYMM` (e.g. `202610`), 202401–203012 |

Every string attribute comes from a closed list, and there is **no free-text attribute**. A worker cannot type a name, phone number, rider ID or address into anything queryable.

## Entity 1: `shift` (one day's earnings)

### Attributes (queryable)

| Name | Type | Values | Why it is an attribute |
| --- | --- | --- | --- |
| `app` `kind` `v` | str, str, i32 | `nexora`, `shift`, `1` | Namespace, entity type, schema version |
| `platform` `work` `city` `vehicle` | str | see vocabularies | Filters: "workers like me", and grouping for comparisons |
| `period` | i32 | `YYYYMM` | Range query: "since August" is `period >= i32(202608)` |
| `hours_band` | i32 | 0–5 (`< 4 h`, `4–8 h`, `8–10 h`, `10–12 h`, `12–14 h`, `14 h +`) | Hours logged in, banded so the exact figure is never published |
| `net_hourly` | i32 | −500…2000, multiples of 10 | Take-home per logged-in hour after the day's costs, in rupees. Range query: `net_hourly >= i32(100)` |
| `cost_pct` | i32 | 0–100, multiples of 10 | Fuel, repairs and data as a share of the day's pay |
| `demo` | bool | `true` for synthetic seed data | Default views exclude demo data with `demo = false` |

`net_hourly` = (what the app paid, incentives and tips included − the day's costs) ÷ logged-in hours, waiting time included, rounded to ₹10. Waiting is in the denominator on purpose: it is time the worker could not spend elsewhere.

### Payload (`application/json`, not queryable, at most 4 KB)

```json
{ "v": 1, "incentive": "met",
  "sealed": { "alg": "AES-256-GCM", "kdf": "PBKDF2-SHA256", "iter": 310000, "salt": "…", "iv": "…", "ct": "…" } }
```

`incentive` (`met`, `missed`, `none`) is only displayed and counted, never filtered on. `sealed` is optional. It holds the exact pay, costs, hours, orders and a private note, encrypted in the browser with a passphrase that never leaves the device ([`ledger/src/seal.ts`](../ledger/src/seal.ts)).

## Entity 2: `incident` (something that happened at work)

### Attributes (queryable)

| Name | Type | Values | Why it is an attribute |
| --- | --- | --- | --- |
| `app` `kind` `v` | str, str, i32 | `nexora`, `incident`, `1` | Namespace, entity type, schema version |
| `platform` `work` `city` | str | see vocabularies | Filters |
| `type` | str | `id_blocked` `deactivated` `pay_cut` `incentive_cut` `penalty` `payout_delayed` `unsafe_pressure` `harassment` | Filter: "how many ID blocks in Delhi?" |
| `period` | i32 | `YYYYMM` | Range queries over time |
| `days_lost` | i32 | 0–90 | Days without work because of it |
| `demo` | bool | `true` for synthetic seed data | Default views exclude demo data |
| `parent` | key | entity key of an earlier incident (optional) | An update ("unblocked after 6 days") or the same thing happening to another worker. `parent = key(…)` finds them all |

### Payload

```json
{ "v": 1, "reasonGiven": false, "appealed": true, "resolved": false, "sealed": { … } }
```

`sealed` is optional and holds what happened in the worker's own words. The app tells workers never to write their name, phone number or rider ID even there.

Incident reports are published from a **fresh one-time wallet by default**, so a report cannot be linked to the worker's earnings history, or to their other reports, by `$creator`. The key stays in the browser for a later update, extension or delete.

## Creation flags and lifetime (both entry kinds)

| Setting | Value | Reason |
| --- | --- | --- |
| `readonly` | `true` | Once published, nobody, the author included, can quietly rewrite an entry, so nobody can be pressured into "correcting" it. The author can still delete it. Corrections and updates are new entries linked by `parent`. |
| `permissionlessExtension` | `true` | Any reader who finds an entry useful (a union, a researcher, another worker) can pay to keep it alive ("Keep alive +30 days"). This takes no permission and grants no write access. |
| Expiry | The worker chooses 7, 30, 90 or 365 days (`ExpirationTime.fromDays`) | Privacy: the author decides how long the data stays public. Demo entries use 365 days (the spammer's 90). |
| Extension | `ExpirationTime.atBlock(currentExpiresAt + 30 days of blocks)` | Extension sets a new absolute deadline, so the app computes it from the current expiry (see friction report F2). |

### Authorship

Authorship is always read from Arkiv's engine-set **`$creator`**, never from an attribute. Writers cannot set or fake it. `$owner` decides who may delete an entity. "Independent workers" in the app means distinct `$creator` wallets, and "confirmed" means at least two of them, counted only among a trust list's members when the reader looks at everyone's entries.

## Entity 3: `trust_list`

A curated set of worker wallets that someone vouches for, such as a union, a riders' WhatsApp group, a researcher or one person.

| Name | Type | Values |
| --- | --- | --- |
| `app` | str | `nexora` |
| `kind` | str | `trust_list` |
| `v` | i32 | `1` |
| `name` | str | 3–48 characters, public |
| `scope` | str | a `work` value, or `all` |

Payload: `{ "v": 1, "description": "<at most 280 chars>", "members": ["0x…", …] }`, with 1–25 checksummed, de-duplicated addresses.

Flags: `readonly = false`, `permissionlessExtension = false`. The curator edits membership in place with `patchEntity`, and only the owner can patch it.
Expiry: 180 days, which the curator can extend.

## Queries the app runs

These strings are produced by the SDK's `Expression.toString()`. The UI shows the exact one under every list, next to the equivalent CLI command.

| Where | Query |
| --- | --- |
| Earnings (no filters) | `app = str('nexora') AND kind = str('shift') AND v = i32(1)` |
| Earnings, filtered, demo hidden | `… AND city = str('bengaluru') AND work = str('food_delivery') AND period >= i32(202608) AND demo = false` |
| Compare | shifts and incidents with the same `city` (and `work`). With *All workers*, entries from everyone are used, but only creators on the recommended trust list count toward "confirmed". |
| Incidents | `app = str('nexora') AND kind = str('incident') AND v = i32(1) AND type = str('id_blocked') …` |
| Any view with a trust list | `… AND ($creator = addr(0xA…) OR $creator = addr(0xB…) OR …)` |
| My data | `app = str('nexora') AND (kind = str('shift') OR kind = str('incident')) AND v = i32(1) AND ($creator = addr(<test wallet>) OR $creator = addr(<one-time wallet>) OR …)`, 25 wallets per query; more wallets become several queries whose results are merged |
| Updates to an incident | `… AND kind = str('incident') … AND parent = key(0x…)` |
| Trust lists | `app = str('nexora') AND kind = str('trust_list') AND v = i32(1)` |
| Entry page | `getEntity(key)` |
| Live feed | `watchEntityEvents` over WebSocket (`wss://…`) collects `EntityCreated` keys; every 10 s one query `… AND ($key = key(0x…) OR …)` (≤ 25 keys) over both entry kinds returns only the Nexora entries among them. Events carry no attributes (friction F3), and this replaces one `getEntity` per chain event. |

The Tiramisu node refuses a query with more than 64 predicates or more than 8192 bytes (measured, friction F4). A Nexora query has at most 12 filter predicates plus 25 `$creator` or `$key` branches (`MAX_OR_BRANCHES`), about 2 KB.

Results are paged with the SDK cursor (200 per page): pages read up to 400 entries, the CLI up to 600. The web app also caches identical reads for 30 s, because each visitor IP has a small anonymous query budget (friction F6). Arkiv has no server-side ordering, so sorting and the statistics (median and quartiles of take-home, month-on-month change, distinct `$creator` count) run on the client, in [`ledger/src/insights.ts`](../ledger/src/insights.ts).

## Mutations

| Operation | Where | SDK call |
| --- | --- | --- |
| Log one day | Log my day | `createEntity(shiftCreate(input))` |
| Log a week | Log my day → CSV | `executeBatch({ creates })`, 20 per transaction |
| Report an incident, or update one | Log my day → Something happened | `createEntity(incidentCreate(input))`, from a one-time wallet by default; an update sets `parent` |
| Seed demo data | `scripts/seed.ts` | `executeBatch({ creates })` |
| Keep alive | Entry page, any wallet | `extendEntity({ entityKey, expires: atBlock(…) })` |
| Delete | Entry page, owner only | `deleteEntity({ entityKey })` |
| Create or edit a trust list | Trust lists | `createEntity` / `patchEntity({ entityKey, payload, set: attributes })`. Arkiv patches are mutations, so every attribute is re-set. |

## What is deliberately not on Arkiv

Worker names, phone numbers, rider or partner IDs, vehicle numbers, addresses, exact rupee amounts and hours (unless sealed), passphrases and wallet keys. There is no Nexora database. The burner wallet key, the worker's usual app/city/vehicle and UI preferences stay in the visitor's `localStorage`; the optional gas sponsor and read fallback store nothing.

## Recorded evidence

`npm run seed` performs one transaction per feature above and records its hash and entity keys in [`evidence.json`](evidence.json): batch creates of shifts and incidents, incident follow-ups (lineage), a sealed payload, trust list create and patch, a permissionless extension by a non-owner, a refused patch on a readonly entity, and an owner delete. The recommended trust list is pinned there **by entity key**. `npm run e2e` writes measured gas, latency and limits to [`e2e-report.md`](e2e-report.md).

## Wallets that create entities

| Address | Role |
| --- | --- |
| `0xf00b81c90dF57B2924A3d165a670FcF656d0e492` | Sponsor: curates the demo trust list and funds visitors' gas |
| `0xF732ffac374A3dd89D756DeA0C96189C7FDddc56` | Demo worker 1: Bengaluru, food delivery, petrol bike |
| `0xBe04e55C3B4621aB684D506D285dDDd7Fd61332f` | Demo worker 2: Bengaluru, food and grocery delivery, EV scooter |
| `0xb1b26E0adD353D4696DE256Cffc57bF1300dEf33` | Demo worker 3: Bengaluru, bike taxi, petrol bike (also the sealed demo day) |
| `0x74223d52e2a0a4ff6E46a569C77b2b11B0AD4d77` | Demo worker 4: Bengaluru, grocery delivery, petrol bike |
| `0x2dAe7FD2618DFaf4f9E6134bB9E23861857ca0A9` | Demo worker 5: Delhi NCR, food delivery, petrol bike (posts the ID-block follow-up) |
| `0xfdF42901392e9D358b5bD761a8fCEF9EA37f2842` | Demo worker 6: Delhi NCR, food and grocery delivery, EV scooter |
| `0x738A8550803cECF4850a6BfD90E36c744A24e49d` | Demo worker 7: Delhi NCR, cab, car |
| `0x3EDe812B517517f58492553C4D8D6d20cadDa91d` | Demo worker 8: Delhi NCR, cab, car |
| `0xbB4510b3c15e10235fBE008A4a7852f86EC2A906` | Demo worker 9: Jaipur, food delivery, petrol bike |
| `0x47046B0414367E50F0b2864f0A2326a01f814AAF` | Demo wallet 10: deliberate **spammer** that publishes implausible ₹350–450/hour bike-taxi days, used to demonstrate trust lists |

All demo entries are synthetic and flagged `demo = true`; the seed's earnings model depends on kind of work, city and vehicle, never on the platform. Visitors publish from their own wallets, so their addresses appear as `$creator` on their entities.
