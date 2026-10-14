# Friction report: building Nexora on Arkiv

Environment for every entry unless stated otherwise: `@arkiv-network/sdk` **0.8.1**, `viem` 2.x, Node **24.19.0** on Windows 11, Tiramisu (chain `7738577`), browser build with Vite 8.
Each entry gives its **status**:
- **live**: reproduced against Tiramisu.
- **source**: established by reading the SDK's shipped TypeScript source, live check pending.

Smooth paths are documented with the same rigour as problems.

---

## F1. Faucet cannot fund a script-generated key without a browser wallet (status: live)

- **Surface:** Faucet (`hub.arkiv.network/faucet`)
- **Steps:**
  1. `npm run wallets` generates five keys with `viem`'s `generatePrivateKey()` and writes them to `.env.local`.
  2. Open the faucet to fund the sponsor address.
- **Expected:** paste an address (or call an HTTP endpoint) and receive GLM, the way most testnet faucets work, so CI, seed scripts and server wallets can be funded headlessly.
- **Actual:** the page is a wallet-connect flow ("Connecting wallet", "One claim per wallet, per cooldown window"). It documents no paste-address mode, no API, no amount and no cooldown length. Funding a server-side key means importing that private key into a browser wallet, which is the opposite of good key hygiene.
- **Impact:** blocked our first write until a human did it by hand. We moved first-entity time from minutes to "whenever a person is at a browser".
- **Suggested fix:** a paste-address mode with captcha, or a documented rate-limited `POST /faucet {address}`. At minimum, state the amount and cooldown on the page.

## F2. `extendEntity` with `ExpirationTime.fromDays(n)` sets a deadline relative to *now*, not to the current expiry (status: source)

- **Surface:** TypeScript SDK, `extendEntity` / `ExpirationTime`
- **Code:** `src/utils/arkivTransactions.ts` notes that "an extension resolves its expiry exactly as a create does", which means `max(expiresAt, currentBlock + minLifetime)`. `src/entity/operations.ts` says "Extending is allowed; shortening reverts", and the ABI includes `error ExpiryNotExtended(bytes32, uint64 newExpiresAt, uint64 currentExpiresAt)`.
- **Expected (from the word "extend"):** `extendEntity({ expires: ExpirationTime.fromDays(30) })` adds 30 days to the current expiry.
- **Actual:** it sets the expiry to *now + 30 days*. Take an entity created with 365 days of life: "extend by 30 days" resolves to a block earlier than its current expiry and reverts with `ExpiryNotExtended`.
- **Reproduce:** create an entity with `ExpirationTime.fromDays(365)`, then call `extendEntity({ entityKey, expires: ExpirationTime.fromDays(30) })`.
- **Our workaround:** [`web/src/pages/Entity.tsx`](../web/src/pages/Entity.tsx) uses `ExpirationTime.atBlock(entity.expiresAt + 30 × 43_200n)`.
- **Suggested fix:** add `ExpirationTime.extendBy(lifetime)` (relative to the current expiry), or rename the parameter to `newExpiry`. Either way, document the semantics on `extendEntity`'s JSDoc.

## F3. Entity events carry no attributes, so filtering a live feed costs one extra RPC call per event (status: source)

- **Surface:** `watchEntityEvents` (WebSocket)
- **Code:** in `src/types/events.ts`, `EntityCreatedEvent` has `entityKey`, `owner`, `expiresAt` and `creationFlags`, and no attributes, content type or payload.
- **Expected:** to subscribe to "entities where `app = nexora`", or at least to receive attributes with each event.
- **Actual:** every client receives every entity created on the chain and must call `getEntity` on each one to learn whether it is relevant. On a busy chain, a live view for one app is O(chain traffic) in RPC calls.
- **Workaround:** our live feed (`web/src/pages/Explore.tsx`, `ledger/cli.ts watch`) calls `getEntity` and then runs the contract decoder, dropping anything that fails.
- **Suggested fix:** an optional query predicate on `watchEntityEvents` evaluated by the node, or indexed event topics for a few well-known attributes.

## F4. Limits you need for paging and for `OR` filters are only in the source (status: source)

- **Surface:** Docs (Tiramisu page, Querying Data)
- **Expected:** the docs state the maximum page size, the maximum number of `OR` branches or the total predicate size, and the faucet amount.
- **Actual:** we found `MAX_LIMIT = 200` in `src/query/engine.ts`. We did not find an `OR`-branch limit anywhere. Our trust-list filter emits one `$creator = addr(…)` branch per member, so we capped lists at 25 members defensively. The Tiramisu docs page lists none of these values.
- **Suggested fix:** a "Limits" table on the network page: page size, predicate size, `OR` branches, payload bytes (`MAX_PAYLOAD_BYTES = 128 KiB`, also only in source), attribute count (`MAX_ATTRIBUTES = 32`) and string length (128 bytes).

## F5. Entity URL format on the block explorer is undocumented (status: live)

- **Surface:** Block Explorer
- **Steps:** we needed `https://tiramisu.explorer.arkiv.network/<?>/<entityKey>` for "view on explorer" links.
- **Actual:** the docs do not give it. The explorer is a SPA that answers `200` for every path, including a nonsense key, so links cannot be validated with a HEAD request. We recovered `/entity/<key>`, `/tx/<hash>` and `/address/<addr>` by reading the explorer's JS bundle.
- **Suggested fix:** document the deep-link formats, and return 404 from `/api/entity/<key>` for unknown keys so links are checkable.

## F9. Exhausted anonymous query budget looks like a silent hang of several minutes (status: live)

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
- **Impact on apps:** a browser dApp that reads Arkiv directly (our censorship-resistance design) inherits this per visitor IP. Visitors on a shared NAT, such as an office, a college Wi-Fi or a mobile carrier's CGNAT in India, share one anonymous budget. Access keys are explicitly not safe in browsers ([docs](https://docs.arkiv.network/start-here/access-keys/)).
- **Our workaround:** [`ledger/src/queries.ts`](../ledger/src/queries.ts) `arkivHttp()`:
  - throws `ArkivRateLimitError` from `onFetchResponse` on 429, which surfaces in about 2.5 s in our test instead of hanging;
  - the CLI prints `Arkiv RPC query budget exhausted (HTTP 429 ANON_COST_LIMITED); resets in about 35 min…` and exits 1;
  - the web app shows a translated notice;
  - `ARKIV_RPC_URL` lets the CLI, scripts and sponsor use a keyed URL server-side;
  - the live feed batches up to 25 new keys into one `$key`-filtered query instead of one `getEntity` per chain event.
- **Suggested fix:**
  1. Have the SDK's default transport not sleep on long `Retry-After` values (cap at a few seconds, then throw a typed `RateLimitError` carrying `retryAfter`).
  2. Document the anonymous budget and the cost model.
  3. Consider a per-origin or per-dApp read allowance, so browser-first apps do not have to proxy reads through a server, which reintroduces the central point that Arkiv removes.

## F6. Smooth: exact, rerunnable query text (status: live)

- **Surface:** TypeScript SDK query builder
- `and([...]).toString()` renders the exact predicate the node executes, with typed literals, e.g. `app = str('nexora') AND spend_band >= i32(1) AND ($creator = addr(0x…) OR …)`. We print it under every list in the UI, and judges can paste it into any client. Building reproducibility into the product took zero extra code.
- Note: the format is `category = str('tea_coffee')`, not `category = "tea_coffee"`. Our first test assumed the latter (`ledger/test/ledger.test.ts`). It is worth one example in the docs.

## F7. Smooth: SDK errors and types that teach (status: live)

- **Surface:** TypeScript SDK attribute and expiry types
- Out-of-range values throw an `InvalidValueError` that explains the fix ("use u64(...) for … timestamps … (Date.now() does not fit an i32)").
- Expiries can only be built with `ExpirationTime.*` (a branded type), so a raw number of seconds does not compile.
- `readonly` and `permissionlessExtension` are plain booleans with clear JSDoc.
- The package ships its TypeScript source (the `bun` export condition points to `src/`). That is how we could establish F2–F4 precisely instead of guessing.

## F8. Smooth: reading Tiramisu with no key and no account (status: live)

- **Surface:** public RPC, `createPublicClient({ chain: tiramisu, transport: http() })`
- `getBlockNumber()` and `select().where(...).fetch()` worked on the first try from Node and the browser, with no API key and no CORS problems. This is the property our censorship-resistance story depends on.

---

## Pending live checks (to be filled in after funding, with transaction hashes)

- Gas cost of one `createEntity` and of a 20-create `executeBatch`.
- Read-after-write latency: blocks until a new entity appears in `select()` results.
- Whether a 25-branch `$creator` `OR` query succeeds.
- Live confirmation of F2 (expected `ExpiryNotExtended` revert).
