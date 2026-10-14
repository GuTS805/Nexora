# Nexora data contract on Arkiv (schema v1)

Network: **Tiramisu testnet**, chain ID `7738577`, RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network`.
SDK: `@arkiv-network/sdk` **0.8.1**. The contract is implemented in [`ledger/src/codec.ts`](../ledger/src/codec.ts) (writes and validation) and [`ledger/src/queries.ts`](../ledger/src/queries.ts) (reads). The web app, the CLI and the seed script all go through these two files, so they write identical entity shapes.

Every Nexora entity carries `app = "nexora"`, `kind`, and `v = 1`. Readers **must** validate entities against this document before using them: anyone can write an entity that claims `app = "nexora"`. The reference decoder rejects anything outside the vocabularies below, and the UI reports how many entities it rejected.

## Entity 1: `experiment`

One ad experiment run by a small seller: what they tried, where, and roughly how it went.

### Attributes (queryable)

| Name | Type | Values | Why it is an attribute |
| --- | --- | --- | --- |
| `app` | str | `nexora` | Namespace filter |
| `kind` | str | `experiment` | Entity type filter |
| `v` | i32 | `1` | Schema version, so v2 readers can coexist |
| `category` | str | 15 fixed values, e.g. `tea_coffee`, `sarees_textiles`, `coaching_tuition` | Filter: "sellers like me" |
| `platform` | str | `instagram` `facebook` `whatsapp` `youtube` `google_search` `meesho` `amazon` `flipkart` `sharechat` `moj` `telegram` | Filter, and recommendation grouping |
| `format` | str | `reel` `story` `carousel` `static_image` `long_video` `search_text` `status` `broadcast` `influencer` `listing_boost` | Filter, and recommendation grouping |
| `lang` | str | `hi` `en` `hinglish` `ta` `te` `kn` `ml` `mr` `bn` `gu` `pa` `or` | Filter by ad language |
| `tier` | str | `metro` `tier1` `tier2` `tier3` `rural` `pan_india` | Filter by where the buyers are |
| `season` | str | `none` `diwali` `holi` `eid` `wedding` `rakhi` `onam_pongal` `monsoon` `sale_event` | Filter by festival |
| `spend_band` | i32 | 0–5 (`<₹500`, `₹500–2k`, `₹2k–5k`, `₹5k–20k`, `₹20k–1L`, `≥₹1L`) | Range query: "budgets near mine" (`spend_band >= b-1 AND spend_band <= b+1`) |
| `roi_pct` | i32 | −100…1000, multiples of 10 | Range query: `roi_pct >= 0` gives only profitable runs |
| `demo` | bool | `true` for synthetic seed data | Default views exclude demo data with `demo = false` |
| `parent` | key | entity key of another experiment (optional) | Lineage: `parent = <key>` finds every variant of an experiment |

Every string attribute comes from a closed list, and there is **no free-text attribute**. A seller cannot type a name, a phone number or a shop address into anything queryable.

### Payload (`application/json`, not queryable, at most 4 KB)

```json
{ "v": 1, "tone": "festive", "cta": "whatsapp_us", "offer": "combo", "days": 7,
  "sealed": { "alg": "AES-256-GCM", "kdf": "PBKDF2-SHA256", "iter": 310000, "salt": "…", "iv": "…", "ct": "…" } }
```

The fields `tone`, `cta`, `offer` and `days` are only displayed and aggregated, never filtered on, so they live in the payload and do not consume attribute indexes. `sealed` is optional. It holds the exact rupee spend, sales, orders and a private note, encrypted in the browser with a passphrase that never leaves the device ([`ledger/src/seal.ts`](../ledger/src/seal.ts)).

### Creation flags and lifetime

| Setting | Value | Reason |
| --- | --- | --- |
| `readonly` | `true` | Once others rely on a published result, nobody (the author included) can quietly rewrite it. The author can still delete it. |
| `permissionlessExtension` | `true` | Any reader who finds a result useful can pay to keep it alive ("Keep alive +30 days"). This takes no permission and grants no write access. |
| Expiry | The seller chooses 7, 30, 90 or 365 days (`ExpirationTime.fromDays`) | Privacy: the author decides how long the data stays public. Demo rows use 90 or 365 days. |
| Extension | `ExpirationTime.atBlock(currentExpiresAt + 30 days of blocks)` | Extension sets a new absolute deadline, so the app computes it from the current expiry (see friction report F2). |

### Authorship

Authorship is always read from Arkiv's engine-set **`$creator`**, never from an attribute. Writers cannot set or fake it. `$owner` decides who may delete an entity.

## Entity 2: `trust_list`

A curated set of publisher wallets that someone vouches for, such as a seller association, a marketplace community or one person.

| Name | Type | Values |
| --- | --- | --- |
| `app` | str | `nexora` |
| `kind` | str | `trust_list` |
| `v` | i32 | `1` |
| `name` | str | 3–48 characters, public |
| `scope` | str | a category, or `all` |

Payload: `{ "v": 1, "description": "<at most 280 chars>", "members": ["0x…", …] }`, with 1–25 checksummed, de-duplicated addresses.

Flags: `readonly = false`, `permissionlessExtension = false`. The curator edits membership in place with `patchEntity`, and only the owner can patch it.
Expiry: 180 days, which the curator can extend.

## Queries the app runs

These strings are produced by the SDK's `Expression.toString()`. The UI shows the exact one under every list, next to the equivalent CLI command.

| Where | Query |
| --- | --- |
| Explore (no filters) | `app = str('nexora') AND kind = str('experiment') AND v = i32(1)` |
| Explore, filtered, demo hidden | `… AND category = str('tea_coffee') AND tier = str('tier2') AND demo = false` |
| What to try (budget band 2) | `… AND category = str('tea_coffee') AND spend_band >= i32(1) AND spend_band <= i32(3)`. With *All sellers*, rows from everyone are used, but only creators on the recommended trust list count toward "proven". |
| Any view with a trust list | `… AND ($creator = addr(0xA…) OR $creator = addr(0xB…) OR …)` |
| My data | `… AND ($creator = addr(<test wallet>) OR $creator = addr(<one-time wallet>) OR …)` (up to 25) |
| Variants of an experiment | `… AND parent = key(0x…)` |
| Trust lists | `app = str('nexora') AND kind = str('trust_list') AND v = i32(1)` |
| Entity page | `getEntity(key)` |
| Live feed | `watchEntityEvents` over WebSocket (`wss://…`) collects `EntityCreated` keys; every 10 s one query `… AND ($key = key(0x…) OR …)` (≤ 25 keys) returns only the Nexora experiments among them. Events carry no attributes (friction F3), and this replaces one `getEntity` per chain event. |

Results are paged with the SDK cursor (200 per page, up to 600 per view). Arkiv has no server-side ordering, so sorting and the recommendation statistics (median and quartiles of ROI, distinct `$creator` count) run on the client, in [`ledger/src/insights.ts`](../ledger/src/insights.ts).

## Mutations

| Operation | Where | SDK call |
| --- | --- | --- |
| Publish one experiment | Log a result | `createEntity(experimentCreate(input))` |
| Import a spreadsheet | Log a result → CSV | `executeBatch({ creates })`, 20 per transaction |
| Seed demo data | `scripts/seed.ts` | `executeBatch({ creates })` |
| Keep alive | Entity page, any wallet | `extendEntity({ entityKey, expires: atBlock(…) })` |
| Delete | Entity page, owner only | `deleteEntity({ entityKey })` |
| Create or edit a trust list | Trust lists | `createEntity` / `patchEntity({ entityKey, payload, set: attributes })`. Arkiv patches are mutations, so every attribute is re-set. |
| Publish from a one-time wallet | Log a result (option) | `createEntity` from a freshly generated key, so the result is unlinkable by `$creator`; the key stays in the browser for later extend or delete |

## What is deliberately not on Arkiv

Seller names, phone numbers, shop names, product names, images, ad copy, customer data, exact rupee amounts (unless sealed), passphrases and wallet keys. There is no Nexora database. The burner wallet key and UI preferences stay in the visitor's `localStorage`, and the optional gas sponsor stores nothing.

## Recorded evidence

`npm run seed` performs one transaction per feature above and records its hash and entity keys in [`evidence.json`](evidence.json): batch creates, lineage, sealed payload, trust list create and patch, permissionless extension by a non-owner, a refused patch on a readonly entity, and an owner delete. The recommended trust list is pinned there **by entity key**. `npm run e2e` writes measured gas, latency and limits to [`e2e-report.md`](e2e-report.md).

## Wallets that create entities

| Address | Role |
| --- | --- |
| `0xf00b81c90dF57B2924A3d165a670FcF656d0e492` | Sponsor: curates the demo trust list and funds visitors' gas (the sponsor) |
| `0xF732ffac374A3dd89D756DeA0C96189C7FDddc56` | Seed publisher 1 (synthetic honest seller) |
| `0xBe04e55C3B4621aB684D506D285dDDd7Fd61332f` | Seed publisher 2 (synthetic honest seller; also publishes variants of publisher 1's results) |
| `0xb1b26E0adD353D4696DE256Cffc57bF1300dEf33` | Seed publisher 3 (synthetic honest seller) |
| `0x74223d52e2a0a4ff6E46a569C77b2b11B0AD4d77` | Seed publisher 4 (synthetic **spammer** that publishes implausible ShareChat wins, used to demonstrate trust lists) |

Visitors publish from their own wallets, so their addresses appear as `$creator` on their entities.
