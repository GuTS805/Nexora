# Friction report: building Nexora on Arkiv

Environment for every entry unless stated otherwise: `@arkiv-network/sdk` **0.8.1**, `viem` 2.x, Node **24.19.0** on Windows 11, Tiramisu (chain `7738577`), browser build with Vite 8.
Every entry has been reproduced against Tiramisu (status: live).

Entries are ordered by when we hit them. F6 cost us the most time; F4 and F6 change how a browser-first app has to be designed; F7 and F8 came up while building the report lock and the offline queue; F9 while adding reads as of past blocks, and it changed what our privacy copy promises. A short list of what worked well is at the end, kept separate from the friction.

---

## F1. Faucet cannot fund a script-generated key without a browser wallet (status: live)

- **Surface:** Faucet (`hub.arkiv.network/faucet`)
- **Steps:**
  1. `npm run wallets` generates five keys with `viem`'s `generatePrivateKey()` and writes them to `.env.local`.
  2. Open the faucet to fund the sponsor address.
- **Expected:** paste an address (or call an HTTP endpoint) and receive GLM, the way most testnet faucets work, so CI, seed scripts and server wallets can be funded headlessly.
- **Actual:** the page is a wallet-connect flow ("Connecting wallet", "One claim per wallet, per cooldown window"). It documents no paste-address mode, no API, no amount and no cooldown length. Funding a server-side key means importing that private key into a browser wallet, which is the opposite of good key hygiene.
- **Impact:** blocked our first write until a human did it by hand. The first Nexora entity landed at 19:30 IST on 14 Oct, only after a person funded the sponsor from a browser wallet.
- **Suggested fix:** a paste-address mode with captcha, or a documented rate-limited `POST /faucet {address}`. At minimum, state the amount and cooldown on the page.

## F2. `extendEntity` with `ExpirationTime.fromDays(n)` sets a deadline relative to *now*, not to the current expiry (status: live)

- **Surface:** TypeScript SDK, `extendEntity` / `ExpirationTime`
- **Code:** `src/utils/arkivTransactions.ts` notes that "an extension resolves its expiry exactly as a create does", which means `max(expiresAt, currentBlock + minLifetime)`. `src/entity/operations.ts` says "Extending is allowed; shortening reverts", and the ABI includes `error ExpiryNotExtended(bytes32, uint64 newExpiresAt, uint64 currentExpiresAt)`.
- **Expected (from the word "extend"):** `extendEntity({ expires: ExpirationTime.fromDays(30) })` adds 30 days to the current expiry.
- **Actual:** it sets the expiry to *now + 30 days*. Take an entity created with 365 days of life: "extend by 30 days" resolves to a block earlier than its current expiry and reverts with `ExpiryNotExtended`.
- **Reproduce:** create an entity with `ExpirationTime.fromDays(365)`, then call `extendEntity({ entityKey, expires: ExpirationTime.fromDays(30) })`. `npm run e2e` does exactly this.
- **Live (14 Oct 2026, reproduced in every [`e2e-report.md`](e2e-report.md) run since):** the call reverted with *"entity 0xd24130ab…b44dd0 already expires at block 16348151, so extending it to 1876153 would shorten its life"*. The message is clear once you see it, but nothing in the API name or JSDoc warns you first. The same run extended a 7-day entity with `atBlock(current + 30 days)`: expiry 882542 → 2178542.
- **Our workaround:** [`web/src/pages/Entity.tsx`](../web/src/pages/Entity.tsx) uses `ExpirationTime.atBlock(entity.expiresAt + 30 × 43_200n)`.
- **Suggested fix:** add `ExpirationTime.extendBy(lifetime)` (relative to the current expiry), or rename the parameter to `newExpiry`. Either way, document the semantics on `extendEntity`'s JSDoc.

## F3. Entity events carry no attributes, so filtering a live feed costs extra queries per event (status: live)

- **Surface:** `watchEntityEvents` (WebSocket)
- **Code:** in `src/types/events.ts`, `EntityCreatedEvent` has `entityKey`, `owner`, `expiresAt` and `creationFlags`, and no attributes, content type or payload.
- **Live (14 Oct 2026, block ~567 330):** a 90 s subscription received **61** `EntityCreated` events from other apps, about 40 per minute. A real event, in full:
  ```
  {"type":"EntityCreated","blockNumber":"567332","transactionHash":"0x2c5e…ff75","logIndex":0,
   "entityKey":"0xeb1a…ff72","owner":"0x679B…7B59","expiresAt":"568232",
   "creationFlags":{"readonly":false,"permissionlessExtension":false,"raw":0}}
  ```
- **Expected:** to subscribe to "entities where `app = nexora`", or at least to receive attributes with each event.
- **Actual:** every client receives every entity created on the chain and must look each one up to learn whether it is relevant. `getEntity` is itself an `arkiv_query` (see F6), so a naive live view spends ~40 queries per minute per open tab on other apps' data, at today's traffic.
- **Reproduce:** run `npx tsx ledger/cli.ts watch` and count the events against the Nexora rows it prints.
- **Workaround:** our live feed (`web/src/pages/Explore.tsx`, `ledger/cli.ts watch`) collects keys and every 5–10 s checks up to 25 of them with one `$key = key(…) OR …` query, then runs the contract decoder. That is 6–12 queries per minute however busy the chain is.
- **Suggested fix:** an optional query predicate on `watchEntityEvents` evaluated by the node, or indexed event topics for a few well-known attributes.

## F4. Query limits are undocumented, and the node enforces two that are not in the SDK at all (status: live)

- **Surface:** Docs (Tiramisu page, Querying Data), `arkiv_query`
- **Expected:** the docs state the maximum page size, how many predicates or `OR` branches a query may have, and the maximum query length.
- **Actual:** `MAX_LIMIT = 200` is in the SDK source (`src/query/engine.ts`), and nothing else is written down. We measured the rest on the public Tiramisu RPC, using raw `arkiv_query` calls with one `app = str('nexora')` clause plus N `$creator = addr(0x…)` branches:

  | Query | Result |
  | --- | --- |
  | 1 + 63 predicates (3 991 bytes) | ok |
  | 1 + 64 predicates (4 054 bytes) | `-32004 query has too many predicates` |
  | 60 short predicates, 8 192 bytes in total | passes the length check |
  | same, 8 193 bytes | `-32004 query is too long` |
  | one `str('…')` literal over 128 bytes | `str values are limited to 128 bytes of UTF-8` |

  So a query may hold at most **64 predicates** and **8 192 bytes**. The errors name neither number, and the SDK does not check either before sending.
- **Why it matters:** "show me results from these wallets" is a natural `OR` over `$creator`, and it breaks at about 60 wallets. Before we measured this, our *My data* page silently capped its wallet list at 25, which hid entries from a user's 26th one-time wallet onwards.
- **Reproduce:**
  ```
  node -e 'const a=i=>"0x"+i.toString(16).padStart(40,"0");
    for (const n of [63,64]) fetch("https://rpc.tiramisu.db-chain.testnet.arkiv.network",{method:"POST",
      headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"arkiv_query",
      params:["app = str(\x27nexora\x27) AND ("+Array.from({length:n},(_,i)=>"$creator = addr("+a(i+1)+")").join(" OR ")+")",{limit:1}]})})
      .then(r=>r.json()).then(j=>console.log(n+1,"predicates:",j.error?.message??"ok"))'
  ```
- **Our workaround:** [`ledger/src/queries.ts`](../ledger/src/queries.ts) caps one query at `MAX_OR_BRANCHES = 25` `$creator` or `$key` branches (at most 38 predicates and 1 900 bytes with every earnings filter set). The fetch functions split longer lists into several queries and merge the results. A test checks the heaviest filter against both limits.
- **Suggested fix:** a "Limits" table on the network page covering page size, predicates per query, query bytes, payload bytes (`MAX_PAYLOAD_BYTES = 128 KiB`, also only in source), attribute count (`MAX_ATTRIBUTES = 32`) and string length (128 bytes). Put the limit in the error message (`query has 65 predicates, max 64`), and validate in the SDK's query builder so the error appears before a network round trip. An `IN` operator (`$creator IN (…)`) would make the common case one predicate.

## F5. Entity URL format on the block explorer is undocumented (status: live)

- **Surface:** Block Explorer
- **Steps:** we needed `https://tiramisu.explorer.arkiv.network/<?>/<entityKey>` for "view on explorer" links.
- **Actual:** the docs do not give it. The explorer is a SPA that answers `200` for every path, including a nonsense key, so links cannot be validated with a HEAD request. We recovered `/entity/<key>`, `/tx/<hash>` and `/address/<addr>` by reading the explorer's JS bundle.
- **Suggested fix:** document the deep-link formats, and return 404 from `/api/entity/<key>` for unknown keys so links are checkable.

## F6. Exhausted anonymous query budget looks like a silent hang of several minutes (status: live)

- **Surface:** public RPC (`arkiv_query`) together with TypeScript SDK 0.8.1 / viem `http()` transport
- **What happened (14 Oct 2026):** a working day of development reads from one IP (CLI runs, about 30 headless-browser page loads) used up the anonymous budget. From then on, every `select().fetch()` and `getEntity` blocked with no output: `npx tsx ledger/cli.ts query --demo` was still silent after 90 s. `eth_getBalance` and `eth_blockNumber` kept working, which made it look like an SDK or query bug.
- **Root cause, found with curl:**
  ```
  $ curl -sD - -X POST https://rpc.tiramisu.db-chain.testnet.arkiv.network \
      -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["v = i32(1)",{"limit":1}]}'
  HTTP/1.1 429 Too Many Requests
  ratelimit: limit=10000, remaining=0, reset=2165
  retry-after: 2165
  {"error":"ANON_COST_LIMITED","message":"unauthenticated query budget exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}
  ```
  viem's HTTP transport honours `Retry-After` on 429 and retries up to 3 times (`viem/utils/buildRequest.ts`). With a 2165 s header, one call can block for hours. The SDK passes viem's transport through unchanged, so nothing reaches the user.
- **Expected:**
  - an error within seconds that says "query budget exhausted, resets in ~36 min, use an access key";
  - documentation of the anonymous budget size and of what a query costs. The `ratelimit` header says `limit=10000` cost units, but the docs give no cost per query or per row.
- **Also:** `getEntity` is implemented as an `arkiv_query` (`$key = key(…)`, see `src/actions/public/getEntity.ts`), so even single-entity lookups draw on the same scarce budget. Only `eth_*` calls sit in a separate bucket (`ratelimit: limit=600` per short window, observed on `eth_blockNumber`).
- **Budget not visible until it is gone (live, 17:23 IST, after the window reset):** successful `arkiv_query` responses carry only the short request bucket (`ratelimit: limit=600, remaining=592, reset=29`). The 10,000-unit cost budget shows up in headers only on the 429. A client therefore cannot see that it is about to run out and slow down; the first sign is a hard stop of about an hour.
- **Impact on apps:** a browser dApp that reads Arkiv directly (our censorship-resistance design) inherits this per visitor IP. Visitors on a shared NAT, such as an office, a college Wi-Fi or a mobile carrier's CGNAT in India, share one anonymous budget. Access keys are explicitly not safe in browsers ([docs](https://docs.arkiv.network/start-here/access-keys/)).
- **Our workaround:** [`ledger/src/queries.ts`](../ledger/src/queries.ts) `arkivHttp()`:
  - throws `ArkivRateLimitError` from `onFetchResponse` on 429, which surfaces in about 2.5 s in our test instead of hanging;
  - the CLI prints `Arkiv RPC query budget exhausted (HTTP 429 ANON_COST_LIMITED); resets in about 35 min…` and exits 1;
  - the web app shows a translated notice;
  - `ARKIV_RPC_URL` lets the CLI, scripts and sponsor use a keyed URL server-side;
  - the live feed batches up to 25 new keys into one `$key`-filtered query instead of one `getEntity` per chain event;
  - after a 429 the web app retries that query through [`api/read.ts`](../api/read.ts), a 30 s CDN-cached `arkiv_query` relay, until the `Retry-After` passes. The browser still asks Arkiv first. This is the server-side read path the next suggestion is meant to make unnecessary.
- **Suggested fix:**
  1. Have the SDK's default transport not sleep on long `Retry-After` values (cap at a few seconds, then throw a typed `RateLimitError` carrying `retryAfter`).
  2. Document the anonymous budget and the cost model, and return the remaining cost budget on every response (e.g. a second `ratelimit` entry), so clients can back off before the hour-long stop.
  3. Consider a per-origin or per-dApp read allowance, so browser-first apps do not have to proxy reads through a server, which reintroduces the central point that Arkiv removes.

## F7. The documented `predictEntityKeys` example cannot run: no client has both methods it calls (status: live)

- **Surface:** TypeScript SDK 0.8.1, `predictEntityKeys` + `executeBatch` (JSDoc in `src/actions/public/predictEntityKeys.ts`)
- **What we were doing (15 Oct 2026):** locking a report, which means creating it and handing it to `0x…dEaD` in one atomic batch. The transfer has to name the new entity's key before it exists, so we followed the `@example` "A batch whose second entity points at its first".
- **Expected:** the example's `client.predictEntityKeys({ owner, count })` followed by `client.executeBatch({ creates: [{ …, salt }] })` runs on one client.
- **Actual:** `predictEntityKeys` exists only on the public client and `executeBatch` only on the wallet client. TypeScript rejects the example as written, and at runtime:
  ```
  predictEntityKeys on public client: function | on wallet client: undefined
  executeBatch     on public client: undefined | on wallet client: function
  ```
- **Reproduce:** `createPublicClient({ chain: tiramisu, transport: http() })` and `createWalletClient({ chain: tiramisu, transport: http(), account })`, then compare `typeof client.predictEntityKeys` and `typeof client.executeBatch` on each.
- **Our workaround:** [`createLocked`](../ledger/src/lock.ts) takes a reader for the prediction and a wallet for the batch, then checks that the key the batch created and transferred is the predicted one. Once the two clients are passed separately it works first time: seed step `ownership_lock` locked a report, and the author's own delete afterwards was refused.
- **Suggested fix:** add `predictEntityKeys` to the wallet client's actions (it predicts keys for the account that will sign), or show two clients in the example.

## F8. Create parameters cannot be saved and restored as data (status: live)

- **Surface:** TypeScript SDK 0.8.1, `CreateEntityParameters`, `ExpirationTime`, attribute values (`@arkiv-network/sdk/attr`)
- **What we were doing (15 Oct 2026):** an offline queue. A worker with no signal fills in the form, and the entry is saved on the phone and sent when the network returns. The natural thing to save is the exact `createEntity` parameters.
- **Expected:** parameters survive `JSON.stringify` / `JSON.parse`, or the SDK offers a way to serialise them.
- **Actual:**
  - `JSON.stringify(params)` throws `Do not know how to serialize a BigInt`, because `ExpirationTime.fromDays(30)` is `{ minLifetime: 1296000n, expiresAt: 0n }`.
  - Attribute values carry a type-level brand. Passing a parsed `{ type: "str", value: "…" }` back is a TypeScript error (`TS2352 … Property '[validated]' is missing in type '{ type: "str"; value: string; }' but required in type 'StrValue'`), although the runtime only checks the shape.
- **Reproduce:** `JSON.stringify({ expires: ExpirationTime.fromDays(30) })`; and in TypeScript, assign `JSON.parse(JSON.stringify(str("x")))` to an attribute map.
- **Our workaround:** [`web/src/queue.ts`](../web/src/queue.ts) stores the attributes as `{ type, value }`, the payload as text and the lifetime in days. When sending, it rebuilds every attribute with `str` / `i32` / `bool` / `key`, rebuilds the expiry with `ExpirationTime.fromDays`, and runs the result through the same decoder readers use before it is sent.
- **Suggested fix:** `serializeCreate(params)` / `parseCreate(json)` helpers (or a `toJSON` on `ExpirationTime`), and an exported runtime check that turns a plain `{ type, value }` into a branded value.
- **Smaller, related:** read-back `creationFlags` carry an extra `raw` byte (`{"readonly":true,"permissionlessExtension":true,"raw":3}`). It is typed (`ResolvedCreationFlags`), but a strict comparison of write flags with read flags fails: our first JSON Schema audit flagged every entity until we compared only the two documented flags.

## F9. Deleting or expiring an entity does not remove it from history, and neither fact nor retention is documented (status: live)

- **Surface:** TypeScript SDK 0.8.1, `deleteEntity`, entity expiry, `SelectQueryBuilder.atBlock`; Tiramisu node
- **What we were doing (16 Oct 2026):** adding "What was on record at a past time" to every entry and trust list, and `nexora at <key> --block <n>` to the CLI.
- **Expected:** the docs to say whether a deleted or expired entity can still be read at earlier blocks, and how far back a node keeps history. An app that tells people "delete" or "expires" needs to know what that means.
- **Actual:**
  - `deleteEntity`'s JSDoc says only "Deletes the entity with the given key". `atBlock` says the block "must be within the range the node retains", and the range is not stated anywhere we looked.
  - Measured: worker 2's deleted day (`0x1685…261a`, deleted in block 580 130) comes back in full, payload included, from `$key = key(…)` at block 580 129, and is absent at 580 130. The trust list returns its 8 pre-patch members at block 580 117 and 9 at 580 118. A query at block 1 answers with an empty page, not a `"block"` error, so on Tiramisu today history seems to reach genesis.
- **Why it matters:** "delete" and "expires" remove an entity from the current state, which is what every default query reads. They do not erase it. A privacy promise built on deletion alone would be wrong.
- **Reproduce:** `npx -p nexora-ledger nexora at 0x1685179bf008a2915b8f61777181fcccf226c65fd4f040d049fe7ce73945261a --block 580129`, then `--block 580130`. Seed step `history_at_block` records both, and the Proof page re-checks them.
- **What we changed:** the app now says an entry "leaves Arkiv's current records", not that it disappears, and that history keeps it. This was already why only bands and rounded figures are public and exact figures are sealed: what anyone can read at an old block is what was safe to publish in the first place.
- **Suggested fix:** state in the `deleteEntity` and expiry docs that history keeps deleted and expired entities readable through `atBlock`, and document each network's retention window (and whether mainnet nodes will prune).

---

## What worked well (not friction)

- **Query text you can paste anywhere.** `and([...]).toString()` renders the exact predicate the node runs, with typed literals, e.g. `app = str('nexora') AND spend_band >= i32(1)`. We show it under every list, so reproducibility took no extra code. One docs example of the `str('…')` literal format would have saved us a failing test.
- **Types that prevent mistakes.** Out-of-range values throw an `InvalidValueError` that names the fix ("use u64(...) for … timestamps"). Expiries can only be built with `ExpirationTime.*`, so raw seconds do not compile. The package ships its TypeScript source, which is how we could pin down F2 and F3 precisely.
- **Revert messages that explain themselves.** A refused patch on a `readonly` entity and a shortening extend both came back as plain sentences naming the entity, the blocks and what is still allowed, not as a raw custom-error selector.
- **Ownership transfer in the same batch as the create.** With F7 worked around, `executeBatch({ creates: [{ …, salt }], ownershipChanges: [{ entityKey, newOwner: 0x…dEaD }] })` was atomic and returned both the created key and the transferred key, so the app can check them. The refused delete afterwards named the problem plainly: *"entity … is owned by 0x…dEaD, not 0xfdF4…"*.
- **Leases are one call.** Renewing a trust list to 180 days from today is `extendEntity({ expires: ExpirationTime.atBlock(currentBlock + 180 days of blocks) })`, and because the list is created without permissionless extension, only its curator can do it.
- **History in one call.** `.atBlock(n)` on any query returns the state as of block `n`, and paging is pinned to the block a walk started at, so results cannot shift under a reader. That turned "who did this union vouch for when the figure was confirmed" and "was this report public before that date" into features rather than an indexer.
- **Reading needs no account.** `select().where(...).fetch()` worked first time from Node and the browser, with no key and no CORS problems, until the budget in F6 ran out.

---

## Measured on Tiramisu (14 Oct 2026, [`e2e-report.md`](e2e-report.md))

| What | Result |
| --- | --- |
| One `createEntity` (a Nexora shift entry, 12 attributes) | 140 672 gas, 0.00014 GLM |
| `executeBatch` with 20 creates | 2 813 440 gas, 0.0028 GLM (no saving per entity over single creates, but one signature and one confirmation) |
| Read-after-write | queryable 700 ms after the receipt, in the same block |
| 25-branch `$creator` `OR` query | ok, 1 636 characters |
| F2 revert | confirmed, see F2 |
| Patch on a `readonly` entity | refused: *"was created readonly, so its contents can never change. Its expiry can still be extended, and it can be transferred or deleted"* |
| Batch delete of 22 entities | one transaction, none queryable afterwards |

The seed run behind the Proof page (`arkiv/evidence.json`) wrote 159 days of earnings (15 of them from the deliberate spammer), 14 incidents with 2 linked follow-ups, a sealed day and a trust list, and recorded a permissionless extension, a refused readonly patch, an owner delete, and a locked incident: created and handed to `0x…dEaD` in one `executeBatch` (with a `predictEntityKeys` salt). Its author's own delete was then refused: *"entity … is owned by 0x…dEaD, not 0xfdF4…"*. The trust list's curator then sent three replies to reports in one batch, each linked by a key-typed `parent`, and renewed the list's lease (expiry block 8 356 114 → 8 399 045). Step `history_at_block` then read the list and the deleted day as of past blocks (F9). `npx tsx ledger/cli.ts verify` re-checks all 14 steps against the chain.
