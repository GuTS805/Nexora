# Nexora Ledger v1: an open data contract on Arkiv

This is a specification, not only a description of one app. Any team can write entries that Nexora (and every other conforming reader) shows, or build its own reader, from this page alone, without asking us and without our code. The key words **MUST**, **MUST NOT** and **SHOULD** are used as in RFC 2119.

Network: **Tiramisu testnet**, chain ID `7738577`, RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network`.
SDK: `@arkiv-network/sdk` **0.8.1**. The contract is implemented in [`ledger/src/schema.ts`](../ledger/src/schema.ts) (vocabularies, banding), [`ledger/src/codec.ts`](../ledger/src/codec.ts) (writes and validation) and [`ledger/src/queries.ts`](../ledger/src/queries.ts) (reads). The web app, the CLI and the seed script all go through these files, so they write identical entity shapes.

Every Nexora entity carries `app = "nexora"`, `kind`, and `v = 1`. Readers **must** validate entities against this document before using them: anyone can write an entity that claims `app = "nexora"`. The reference decoder rejects anything outside the vocabularies below, and the UI reports how many entities it rejected.

**Machine-checkable copy.** [`schema/shift.schema.json`](schema/shift.schema.json), [`schema/incident.schema.json`](schema/incident.schema.json), [`schema/reply.schema.json`](schema/reply.schema.json) and [`schema/trust-list.schema.json`](schema/trust-list.schema.json) are JSON Schema (2020-12) for each entity kind. They are checked against the entity's content type, creation flags, typed attributes (`{ "type": "str" | "i32" | "bool" | "key", "value": … }`, as the SDK reads them) and decoded JSON payload. They are generated from the same constants as the codec ([`ledger/src/contract.ts`](../ledger/src/contract.ts), `npm run schemas -w nexora-ledger`), and a test fails if the committed files fall behind. They are strict: every attribute is listed and nothing else is allowed. Readers are more forgiving and ignore unknown attributes, so a stricter check is needed.

**Public privacy audit.** `nexora audit` (in the CLI and the npm package) reads every entity with `app = "nexora"`, holds each entry readers would show to these schemas, and scans every clear-text string for phone numbers, email addresses and 12-digit ID numbers. It also reports how many incident wallets also wrote earnings, which would let a report be linked to pay. It exits non-zero on any violation. The [audit workflow](../.github/workflows/audit.yml) runs it every day.

## Conformance

**A conforming writer:**

1. MUST set `app = "nexora"` (str), `kind` (str, one of `shift`, `incident`, `reply`, `trust_list`) and `v = 1` (i32) on every entity.
2. MUST use only the attributes listed below for that kind, with the listed types and values from the closed vocabularies, and MUST NOT add others. The JSON Schemas reject extra attributes, because an extra attribute is how a name or phone number would leak.
3. MUST publish hours only as `hours_band`, take-home per hour rounded to ₹10 and cost share rounded to 10%. Exact rupees, hours and free text MUST NOT appear in clear text; they MAY go into a sealed box (AES-256-GCM, PBKDF2-SHA256, see `seal.ts`). Writers SHOULD pad the box's plaintext with trailing spaces to 256, 1,024 or 4,096 bytes (`padPlaintext`), so its length does not reveal how long a note is; readers need no change, because JSON ignores the spaces.
4. MUST use content type `application/json` and a payload of at most 4 KB in the shape given for the kind.
5. MUST create shifts, incidents and replies with `readonly = true` and `permissionlessExtension = true`, and trust lists with both `false`.
6. SHOULD publish incident reports from a fresh one-time wallet, so a report cannot be joined to the author's earnings by `$creator`.
7. SHOULD check every entity before sending it: `validateEntity(kind, params)` from `nexora-ledger/contract`, or any JSON Schema 2020-12 validator with the files in [`schema/`](schema).

**A conforming reader:**

1. MUST validate every entity against this contract and leave out those that fail, because anyone can write an entity that claims `app = "nexora"`. That includes entries not created `readonly` (their writer could change them after people relied on them) and payloads that are not `application/json`. It SHOULD show how many it left out. It MAY ignore attributes and payload fields it does not know.
2. MUST take authorship from Arkiv's `$creator`, never from an attribute.
3. SHOULD count distinct `$creator` wallets, not entities, and call a figure confirmed only when at least two wallets back it (two members, when a trust list is applied).
4. MUST treat a reply as a claim by its own `$creator`. Only an update from the report's own `$creator` marks a report resolved.
5. SHOULD tell its users that deletion and expiry remove an entry from the current state, not from history (friction F9).

**Checking an implementation:** [`vectors/`](vectors) holds conformance vectors: entities a writer or reader must accept or reject, each with the reason and the JSON Pointer where a validator must report the problem. They run in any language with a JSON Schema 2020-12 validator; [`examples/check_vectors.py`](../examples/check_vectors.py) does it in Python, and [`examples/nexora_reader.py`](../examples/nexora_reader.py) reads the live ledger with the Python standard library alone.

**Checking a deployment:** `npx -p nexora-ledger nexora audit` holds every entity on chain that claims `app = "nexora"` to the strict schemas and scans it for personal data. Anyone can run it against anyone's entries.

**Versioning.**

- A new value in a vocabulary (a city, a platform, a kind of work) keeps `v = 1`. Readers that do not know the value reject those entities rather than misread them, so nothing is ever misinterpreted, and they pick the value up when they update.
- Anything else, such as a new, renamed or retyped attribute, or a changed meaning or rounding, is `v = 2`.
- `v` is part of every query, so v1 and v2 entities coexist on chain. A reader that understands both queries each version and decodes each with its own rules.
- The v1 JSON Schemas require `v = 1`, so a v2 entity never passes a v1 check by accident.

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
| `hours_band` | i32 | 0–5 (`< 4 h`, `4–8 h`, `8–10 h`, `10–12 h`, `12–14 h`, `14 h +`) | Hours logged in, banded so the exact figure is never published. Range query for day length: "8 h or more" is `hours_band >= i32(2)` (Earnings, Compare, CLI `--day`) |
| `net_hourly` | i32 | −500…2000, multiples of 10 | Take-home per logged-in hour after the day's costs, in rupees. Range query: `net_hourly >= i32(100)` |
| `cost_pct` | i32 | 0–100, multiples of 10 | Fuel, repairs and data as a share of the day's pay. Range query: days where costs took 30% or more is `cost_pct >= i32(30)` (CLI `--min-cost`) |
| `demo` | bool | `true` for synthetic seed data | Default views exclude demo data with `demo = false` |

`net_hourly` = (what the app paid, incentives and tips included − the day's costs) ÷ logged-in hours, waiting time included, rounded to ₹10. Waiting is in the denominator on purpose: it is time the worker could not spend elsewhere.

### Payload (`application/json`, not queryable, at most 4 KB)

```json
{ "v": 1, "incentive": "met",
  "sealed": { "alg": "AES-256-GCM", "kdf": "PBKDF2-SHA256", "iter": 600000, "salt": "…", "iv": "…", "ct": "…" } }
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

## Entity 3: `reply` (where a report stands)

A union, a worker group or the platform says what happened to a report. A reply is its own entry: it never changes the report, and only the reporter's own update (an `incident` with `parent`) can mark the report resolved.

| Name | Type | Values | Why it is an attribute |
| --- | --- | --- | --- |
| `app` `kind` `v` | str, str, i32 | `nexora`, `reply`, `1` | Namespace, entity type, schema version |
| `parent` | key | entity key of the incident report | `parent = key(…)` finds every reply to one report |
| `status` | str | `received` `taken_up` `escalated` `resolved` `cannot_help` | Closed vocabulary, so a reply cannot carry a name or a phone number either |
| `period` | i32 | `YYYYMM` | Month of the reply |
| `demo` | bool | `true` for synthetic seed data | Default views exclude demo data |

Payload: `{ "v": 1 }`. Anyone can reply, so readers decide whose replies count. The app marks a reply when its `$creator` runs the recommended trust list, and ignores replies from the reporter's own wallet (`repliesTo` in [`insights.ts`](../ledger/src/insights.ts)). Replies are sent from the replier's connected wallet, not a one-time one, because a union wants to be recognisable.

## Creation flags and lifetime (shifts, incidents and replies)

| Setting | Value | Reason |
| --- | --- | --- |
| `readonly` | `true` | Once published, nobody, the author included, can quietly rewrite an entry, so nobody can be pressured into "correcting" it. The author can still delete it. Corrections and updates are new entries linked by `parent`. |
| `permissionlessExtension` | `true` | Any reader who finds an entry useful (a union, a researcher, another worker) can pay to keep it alive ("Keep alive +30 days"). This takes no permission and grants no write access. |
| Expiry | The worker chooses 7, 30, 90 or 365 days (`ExpirationTime.fromDays`) | Privacy: the author decides how long the entry stays in Arkiv's current state. Deletion and expiry do not erase history: a query as of an earlier block still returns it (friction F9), so only data that is safe to stay public is published. Demo entries use 365 days (the spammer's 90). |
| Extension | `ExpirationTime.atBlock(currentExpiresAt + 30 days of blocks)` | Extension sets a new absolute deadline, so the app computes it from the current expiry (see friction report F2). |

### Authorship

Authorship is always read from Arkiv's engine-set **`$creator`**, never from an attribute. Writers cannot set or fake it. `$owner` decides who may delete an entity. A **locked** entry has `$owner = 0x000000000000000000000000000000000000dEaD` (an address whose key nobody holds) while `$creator` stays the worker's wallet. Nobody can delete it before it expires, and readers need nothing special to read it. "Independent workers" in the app means distinct `$creator` wallets, and "confirmed" means at least two of them, counted only among a trust list's members when the reader looks at everyone's entries.

## Entity 4: `trust_list`

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
Expiry: a 180-day **lease**. Only the curator can renew it, back to 180 days from that day ([`trustRenewal`](../ledger/src/lease.ts), *Trust lists → Renew*). A list nobody renews expires, so a group that stops curating, or no longer exists, stops vouching for anyone.

## Entity 5: `guide` (workers' rights and platform ratings, with sources)

What the law gives gig workers in India or in a state, or an independent rating of platforms. Every point carries its sources and the day it was checked. Readers take guides only from curators they trust, by `$creator`: the app reads the recommended trust list's curator, recorded in [`guides-onchain.json`](guides-onchain.json). The published wording is in [`guides.json`](guides.json).

| Name | Type | Values |
| --- | --- | --- |
| `app` | str | `nexora` |
| `kind` | str | `guide` |
| `v` | i32 | `1` |
| `scope` | str | `india`, `rajasthan`, `karnataka`, `bihar`, `jharkhand`, `telangana` |
| `topic` | str | `law` or `rating` |

Payload: `{ "v": 1, "title", "status", "points": [1–6 lines], "sources": [1–4 { "label", "url" }], "actions"?: [0–3 links], "scores"?: { "<platform>": 0–10 }, "checked": "YYYY-MM-DD", "hi"?: { "title", "status", "points", "actions"? } }`, at most 8 KB. Links must be `https`. `scores` is allowed only on a rating, keyed by the platform vocabulary. A Hindi translation has exactly one line per English line.

Flags: `readonly = false`, `permissionlessExtension = false`, like a trust list: when a law changes, the curator patches the guide in place, and what it said on any earlier date stays readable at past blocks (*What was on record at a past time* on each guide). Expiry: 365 days.

## Queries the app runs

These strings are produced by the SDK's `Expression.toString()`. The UI shows the exact one under every list, next to the equivalent CLI command.

| Where | Query |
| --- | --- |
| Earnings (no filters) | `app = str('nexora') AND kind = str('shift') AND v = i32(1)` |
| Earnings or Compare by day length | `… AND hours_band >= i32(2)` ("8 h or more"; "under 8 h" is `hours_band <= i32(1)`) |
| Earnings, filtered, demo hidden | `… AND city = str('bengaluru') AND work = str('food_delivery') AND period >= i32(202608) AND demo = false` |
| Compare | shifts and incidents with the same `city` (and `work`). With *All workers*, entries from everyone are used, but only creators on the recommended trust list count toward "confirmed". |
| Incidents | `app = str('nexora') AND kind = str('incident') AND v = i32(1) AND type = str('id_blocked') …` |
| Any view with a trust list | `… AND ($creator = addr(0xA…) OR $creator = addr(0xB…) OR …)` |
| My data | `app = str('nexora') AND (kind = str('shift') OR kind = str('incident')) AND v = i32(1) AND ($creator = addr(<test wallet>) OR $creator = addr(<one-time wallet>) OR …)`, 25 wallets per query; more wallets become several queries whose results are merged |
| Updates to an incident | `… AND kind = str('incident') … AND parent = key(0x…)` |
| Replies to an incident | `app = str('nexora') AND kind = str('reply') AND v = i32(1) AND parent = key(0x…)` |
| Replies on the Incidents page | `app = str('nexora') AND kind = str('reply') AND v = i32(1)` (one query for every report shown) |
| Trust lists | `app = str('nexora') AND kind = str('trust_list') AND v = i32(1)` |
| Entry page | `getEntity(key)` |
| Live feed | `watchEntityEvents` over WebSocket (`wss://…`) collects `EntityCreated` keys; every 10 s one query `… AND ($key = key(0x…) OR …)` (≤ 25 keys) over both entry kinds returns only the Nexora entries among them. Events carry no attributes (friction F3), and this replaces one `getEntity` per chain event. |

The Tiramisu node refuses a query with more than 64 predicates or more than 8192 bytes (measured, friction F4). A Nexora query has at most 13 filter predicates plus 25 `$creator` or `$key` branches (`MAX_OR_BRANCHES`): 38 predicates and 1 900 bytes for the heaviest earnings query.

Results are paged with the SDK cursor (200 per page): pages read up to 400 entries, the CLI up to 600. The web app also caches identical reads for 30 s, because each visitor IP has a small anonymous query budget (friction F6). Arkiv has no server-side ordering, so sorting and the statistics (median and quartiles of take-home, month-on-month change, distinct `$creator` count) run on the client, in [`ledger/src/insights.ts`](../ledger/src/insights.ts).

## Mutations

| Operation | Where | SDK call |
| --- | --- | --- |
| Log one day | Log my day | `createEntity(shiftCreate(input))` |
| Log a week | Log my day → CSV | `executeBatch({ creates })`, 20 per transaction |
| Report an incident, or update one | Log my day → Something happened | `createEntity(incidentCreate(input))`, from a one-time wallet by default; an update sets `parent` |
| Renew a trust list's lease | Trust lists → "Renew for 180 days from today", curator only | `extendEntity({ entityKey, expires: ExpirationTime.atBlock(currentBlock + 180 × 43 200) })`; not offered when it would not move the expiry later |
| Reply to a report as a union or group | Entry page → "Reply as a union or group" | `createEntity(replyCreate({ parent, status, period, expiresInDays: 365 }))` from the connected wallet |
| Lock an entry (opt-in, either kind) | Log my day → "Lock it" | `predictEntityKeys({ owner, count: 1 })`, then one `executeBatch({ creates: [{ …params, salt }], ownershipChanges: [{ entityKey, newOwner: 0x…dEaD }] })` ([`createLocked`](../ledger/src/lock.ts)) |
| Seed demo data | `scripts/seed.ts` | `executeBatch({ creates })` |
| Keep alive | Entry page, any wallet | `extendEntity({ entityKey, expires: atBlock(…) })` |
| Delete | Entry page, owner only | `deleteEntity({ entityKey })` |
| What was on record at a past time | Entry and trust list pages; CLI `nexora at <key> --block <n>` or `--date …` | `select("*").where($key = key(…)).atBlock(n)`, with `n` found from the chosen moment by searching block timestamps (`blockAtDate`) |
| Create or edit a trust list | Trust lists | `createEntity` / `patchEntity({ entityKey, payload, set: attributes })`. Arkiv patches are mutations, so every attribute is re-set. |

## What is deliberately not on Arkiv

Worker names, phone numbers, rider or partner IDs, vehicle numbers, addresses, exact rupee amounts and hours (unless sealed), passphrases and wallet keys. There is no Nexora database. The burner wallet key, the worker's usual app/city/vehicle, UI preferences and any entries saved while offline (already sealed; never the passphrase) stay in the visitor's `localStorage`; the optional gas sponsor and read fallback store nothing.

## Recorded evidence

`npm run seed` performs one transaction per feature above and records its hash and entity keys in [`evidence.json`](evidence.json): batch creates of shifts and incidents, incident follow-ups (lineage), a sealed payload, trust list create and patch, a permissionless extension by a non-owner, a refused patch on a readonly entity, an owner delete, a locked incident whose author's own delete was refused, three replies from the trust list's curator in one batch, and the curator renewing the list's lease. One read-only step, `history_at_block`, records the list's members either side of its patch and the deleted day either side of its deletion, read as of those blocks. The recommended trust list is pinned there **by entity key**. `npm run e2e` writes measured gas, latency and limits to [`e2e-report.md`](e2e-report.md).

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
