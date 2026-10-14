# Friction report: building Nexora on Arkiv

Environment for every entry unless stated otherwise: `@arkiv-network/sdk` **0.8.1**, `viem` 2.x, Node **24.19.0** on Windows 11, Tiramisu (chain `7738577`), browser build with Vite 8.
Each entry gives its **status**:
- **live**: reproduced against Tiramisu.
- **source**: established by reading the SDK's shipped TypeScript source, live check pending.

Entries are ordered by when we hit them. F6 cost us the most time; F4 and F6 change how a browser-first app has to be designed. A short list of what worked well is at the end, kept separate from the friction.

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
- **Why it matters:** "show me results from these wallets" is a natural `OR` over `$creator`, and it breaks at about 60 wallets. Before we measured this, our *My data* page silently capped its wallet list at 25, which hid results from a seller's 26th one-time wallet onwards.
- **Reproduce:**
  ```
  node -e 'const a=i=>"0x"+i.toString(16).padStart(40,"0");
    for (const n of [63,64]) fetch("https://rpc.tiramisu.db-chain.testnet.arkiv.network",{method:"POST",
      headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"arkiv_query",
      params:["app = str(\x27nexora\x27) AND ("+Array.from({length:n},(_,i)=>"$creator = addr("+a(i+1)+")").join(" OR ")+")",{limit:1}]})})
      .then(r=>r.json()).then(j=>console.log(n+1,"predicates:",j.error?.message??"ok"))'
  ```
- **Our workaround:** [`ledger/src/queries.ts`](../ledger/src/queries.ts) caps one query at `MAX_OR_BRANCHES = 25` `$creator` or `$key` branches (at most 39 predicates and about 2 KB with every filter set). `fetchExperiments` splits longer lists into several queries and merges the results. A test checks the heaviest filter against both limits.
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
  - the live feed batches up to 25 new keys into one `$key`-filtered query instead of one `getEntity` per chain event.
- **Suggested fix:**
  1. Have the SDK's default transport not sleep on long `Retry-After` values (cap at a few seconds, then throw a typed `RateLimitError` carrying `retryAfter`).
  2. Document the anonymous budget and the cost model, and return the remaining cost budget on every response (e.g. a second `ratelimit` entry), so clients can back off before the hour-long stop.
  3. Consider a per-origin or per-dApp read allowance, so browser-first apps do not have to proxy reads through a server, which reintroduces the central point that Arkiv removes.

---

## What worked well (not friction)

- **Query text you can paste anywhere.** `and([...]).toString()` renders the exact predicate the node runs, with typed literals, e.g. `app = str('nexora') AND spend_band >= i32(1)`. We show it under every list, so reproducibility took no extra code. One docs example of the `str('…')` literal format would have saved us a failing test.
- **Types that prevent mistakes.** Out-of-range values throw an `InvalidValueError` that names the fix ("use u64(...) for … timestamps"). Expiries can only be built with `ExpirationTime.*`, so raw seconds do not compile. The package ships its TypeScript source, which is how we could pin down F2 and F3 precisely.
- **Reading needs no account.** `select().where(...).fetch()` worked first time from Node and the browser, with no key and no CORS problems, until the budget in F6 ran out.

---

## Pending live checks (to be filled in after funding, with transaction hashes)

- Gas cost of one `createEntity` and of a 20-create `executeBatch`.
- Read-after-write latency: blocks until a new entity appears in `select()` results.
- Live confirmation of F2 (expected `ExpiryNotExtended` revert).

Already confirmed live without funds: the query limits in F4 (including a 25-branch `$creator` query) and the event shape in F3.
