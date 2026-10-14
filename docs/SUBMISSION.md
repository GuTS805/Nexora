# Nexora: Arkiv Global Tour Stop submission notes

**In one line:** Indian gig workers record what a day of delivery or ride work really paid after costs, and what happened to them at work, without giving their name, in a ledger no platform can edit or take down.

The headline is **Best Indian Use Case** with **Privacy**: the product only works if a delivery rider in Bengaluru can say "my take-home fell to ₹70 an hour" or "my ID was blocked for six days with no reason" without being identified and losing the ID that is their income. Censorship resistance, security and open source follow from building it on Arkiv, and each has its own section below.

Tracks entered: **Best Indian Use Case**, **Privacy**, **Censorship Resistance**, **Security**, **Open Source**.
Each section answers the rubric's question for that track and points to the code that backs every claim.

## The problem

India had about **77 lakh gig workers in 2020-21**, and NITI Aayog projects **2.35 crore by 2029-30** (*India's Booming Gig and Platform Economy*, 2022). Most of the platform work is food and grocery delivery and ride-hailing. The *Prisoners on Wheels?* survey (2024) covered app-based cab drivers and delivery workers in eight cities: Delhi, Lucknow, Jaipur, Indore, Hyderabad, Bengaluru, Mumbai and Kolkata. It found:

- **43%** of cab drivers took home **under ₹500 a day** after all costs;
- **34%** of delivery workers took home **under ₹10,000 a month** after expenses;
- **83%** of cab drivers worked more than 10 hours a day;
- **87%** of delivery workers were affected by **ID blocking or deactivation**.

Rajasthan (2023) and Karnataka (2025) have passed laws for platform workers. But what the work actually pays is known in full only to the platforms. They set the per-order rate, change incentive targets without notice, and can block an ID without giving a reason. A worker who complains under their own name risks exactly that block. What workers know about real pay lives in three places, and each one fails them:

1. **The platform's own earnings screen.** It shows one worker one platform, the platform can change how it presents the numbers, and nobody can compare across apps or over time.
2. **WhatsApp groups and union surveys.** Screenshots disappear in the scroll, cannot be searched or aggregated, can be faked, and the group may include someone who reports back to the company.
3. **Social media posts.** A public complaint ties the worker's face or handle to the claim. The post can be reported, hidden or deleted.

Nexora is a shared, worker-written record of pay and incidents. Every entry is signed by a worker's wallet, carries no name, can never be silently edited, and anyone can query it without asking anybody.

## Best Indian Use Case: who in India uses it, and what changes for them

- **Users:** food and grocery delivery riders, cab, auto and bike-taxi drivers, and parcel and home-services workers. They work 8–14 hours a day across Swiggy, Zomato, Blinkit, Zepto, Uber, Ola, Rapido and others, in metros and tier-2 cities. Then the people who act for them: unions, riders' WhatsApp groups, labour researchers, journalists and state welfare boards.
- **What changes on day one:**
  - Before joining an app or a new city, a worker opens *Compare*, picks city and kind of work, and sees take-home per hour after fuel and costs, per app. Only figures that at least two independent workers confirm rank first, and every figure links to its evidence.
  - After a day's work, they log it in under a minute, in Hindi or English: pay, costs, hours. Exact rupees and hours become a band and a rounded rate, so no entry fingerprints one worker's income.
  - When something happens (an ID block, a pay cut, an unexplained penalty), they report it from a fresh one-time wallet, and later post an update ("unblocked after 6 days"). Unions get a running, unfakeable count of what happens to whom, with how many days of work it cost.
- **India-specific design:**
  - India's platforms and kinds of work (quick commerce, bike taxis, autos).
  - Indian cities, tier-2 included.
  - The incentive-target system ("target met or missed").
  - Take-home per logged-in hour, waiting included, because time spent waiting for orders is unpaid but still spent.
  - ₹ figures.
  - A Hindi UI.
  - WhatsApp sharing, which carries the link in the sender's language.
- **Works today:** the app is live at https://nexora-pi-snowy.vercel.app and needs no signup. A wallet is created in the browser and gas is sponsored. Demo data is synthetic and labelled: it is calibrated to the survey ranges above, and the generator builds in no difference between platforms, so it says nothing about any real company. Every non-demo entry is a real worker's own report.

## Privacy: who is harmed if this data leaks

- **Harmed today:** a worker whose complaint, or whose earnings history, can be tied to their rider ID. The platform can block or deactivate them, which 87% of delivery workers in the survey above said affects them. Earnings histories are also what lenders and landlords key off. Workers will not share data that exposes them, so no shared picture of pay forms.
- **What is on the explorer (and nothing more):**
  - Closed-vocabulary attributes only: app, kind of work, city, vehicle, month. There is **no free-text attribute anywhere**, so a name, phone number, rider ID or vehicle number cannot be entered even by mistake.
  - Hours as one of six bands.
  - Take-home per hour rounded to ₹10.
  - Cost share rounded to 10%.
  - Incident type, days without work, and three yes/no outcomes.
  - The author's pseudonymous wallet address. The burner wallet is created in the browser and is linked to no identity.
- **Unlinkable incident reports:** incident reports are published from a fresh one-time wallet by default ([`Log.tsx:103`](../web/src/pages/Log.tsx#L103)), so a report cannot be joined to the worker's earnings history, or to their other reports, by `$creator`. The keys stay in the browser for later updates, extension or deletion, with a backup in *My data*.
- **Encrypted payload:** exact pay, costs, hours, orders and a private account of what happened are sealed in the browser with AES-256-GCM, using a key derived via PBKDF2-SHA256 (310k iterations) from a passphrase that never leaves the device ([`ledger/src/seal.ts`](../ledger/src/seal.ts)). A worker can hand the passphrase to a union or a lawyer. GCM authentication makes a tampered box fail to open. Without a passphrase, exact figures are discarded after banding.
- **User-controlled expiry:** the worker picks 7, 30, 90 or 365 days and can delete earlier (owner-only `deleteEntity`).
- **Shown before publishing:** the *Log my day* page has a three-column "Public on Arkiv / Sealed / Never leaves this device" preview, rendered from the actual values about to be written. A UI test checks that the exact rupees and hours never appear in the public column.

## Censorship Resistance: who is harmed if this data is censored or shut down

- **Harmed today:** workers whose evidence of a pay cut or an unfair block lives somewhere a platform can reach. A forum post gets reported and removed. A worker is pressured to delete a video. A union's survey spreadsheet is a single file on a single account. An NGO's portal is one legal notice away from going offline.
- **What changes:**
  - Entries are Arkiv entities created by the worker's own wallet (`$creator`). Entries are `readonly`, so nobody, not even the author under pressure, can quietly "correct" them. Only the author can delete. Anyone can keep a useful entry alive past its expiry (`permissionlessExtension`).
  - The web app is a static bundle that reads Tiramisu straight from the browser (`ledger/src/queries.ts`, `readClient`). There is **no Nexora backend or database to take down**. The only server code is an optional gas sponsor and a cached read fallback that the browser uses only after the public RPC rate-limits it. Deleting both loses no data and breaks no reader.
  - With Nexora's website gone, anyone can run `npx tsx ledger/cli.ts earnings --demo` or paste the exact query shown in the UI into any Arkiv client. [`examples/read-without-nexora.mjs`](../examples/read-without-nexora.mjs) rebuilds the per-app comparison with only the official SDK.
  - The RPC endpoint is user-configurable (`How it works → Network`, `--rpc` on the CLI), so blocking one endpoint does not block readers.
  - `npm run build:portable -w web` produces **one self-contained `nexora.html`** that opens straight from disk. A union can hand the whole app to members as a WhatsApp or Telegram file, and it works with no website at all.
- **Proof for judges:** run the CLI from a fresh clone with only the public RPC. Then build the portable file, double-click `web/dist-portable/nexora.html`, and the same data loads with no server involved.

## Security: who is misled if this data is forged

- **Misled today:** a worker who joins an app because of an "earn ₹40,000 a month" claim from a recruiter, an agency or a faked screenshot. A policymaker reading a platform-sponsored "earnings report". A union whose survey is flooded with fake happy responses.
- **Defences in the product:**
  1. **Authorship from `$creator`.** Every view and filter keys authorship off Arkiv's engine-set `$creator` ([`queries.ts:193-197`](../ledger/src/queries.ts#L193-L197)), never off a self-declared field.
  2. **Trust lists.** Unions and riders' groups publish lists of wallets they vouch for. Choosing one adds an `OR` of `$creator` clauses to every query. There is no central gatekeeper: lists compete, and the curator edits membership with owner-only `patchEntity`.
  3. **Sybil dampening.** Figures count *distinct workers*, not rows. A figure is "confirmed" only when at least two independent workers, and when a trust list is in use, two trusted workers, report it (`MIN_WORKERS_FOR_CONFIRMED = 2`, [`insights.ts:15`](../ledger/src/insights.ts#L15)). Unconfirmed figures never outrank confirmed ones ([`insights.ts:119`](../ledger/src/insights.ts#L119)). A month-on-month "pay cut" is reported only when both months are confirmed, so one wallet cannot fake a trend. The tests *one wallet repeating a figure stays unconfirmed* and *with a trust set, free throwaway wallets cannot manufacture independent confirmation* cover this.
  4. **Immutability.** Entries are created `readonly`: after others rely on a figure, its author cannot rewrite it. Corrections and updates are new entries linked by `parent`.
  5. **Contract validation on read.** `decodeShift` and `decodeIncident` reject entities with unknown vocabulary, off-grid rates, impossible months, wrong attribute types or oversized payloads. The UI shows the rejection count and reasons instead of silently trusting `app = "nexora"`.
- **Demo:** demo wallet 10 is a deliberate spammer that claims ₹350–450 an hour for bike taxis in Bengaluru. In *Compare* with *All workers*, its days are counted but marked unconfirmed. Select the *Nexora demo: honest seed workers* trust list and they disappear.
- **Operational:**
  - Keys exist only in the gitignored `.env.local` and the deployment's secrets.
  - The sponsor validates input and enforces per-address, per-IP, global and sponsor-floor limits.
  - Strict security headers and a CSP are set in `vercel.json`.
  - `npm audit` reports 0 vulnerabilities.

The full threat model, with residual risks, is in [`THREAT_MODEL.md`](THREAT_MODEL.md).

## Open Source: can another team build on it without asking?

- **Data contract:** [`arkiv/schema.md`](../arkiv/schema.md) documents every attribute, type, vocabulary, flag and lifetime, plus the exact queries.
- **Reusable library:** [`ledger/`](../ledger) (`@nexora/ledger`, MIT) gives any TypeScript project:
  - `shiftCreate` / `incidentCreate` to write valid entities;
  - `decodeShift` / `decodeIncident` to validate untrusted ones;
  - `fetchShifts` / `fetchIncidents` with typed filters;
  - `comparePlatforms`, `earningsStats`, `monthChange` and `incidentStats` for the analytics;
  - `seal` / `unseal` for the encrypted details.
- **Permissionless writes and reads:** any app can publish compatible entries from its own wallet, and they show up in Nexora automatically. Any app can read Nexora's data the same way. Examples: a union's WhatsApp bot that logs members' days, a researcher's dashboard, a state welfare board's monitoring page, a journalist's notebook.
- **Versioning:** `v = 1` is part of every predicate, so a v2 can coexist.
- **Tests:** `npm test` runs the contract tests: codec round trip, rejection of malformed entities, sealing, query rendering against the node's measured limits, Sybil dampening, month-on-month confirmation, CSV parsing, the read fallback, and every write shape through the real SDK up to signing.
- **Checked in public:** [GitHub Actions](../.github/workflows/ci.yml) runs typecheck, tests, the build, a headless-Chrome UI test, the single-file build and `npm audit` on every push and pull request.
- **Ready for contributors:** [`CONTRIBUTING.md`](../CONTRIBUTING.md) explains setup, how to add a city, platform, kind of work or language, and the rules that keep the data trustworthy (no personal data on chain, fixed lists, versioned contract). There are issue templates for bugs and new vocabulary, a pull-request checklist, a [security policy](../SECURITY.md) for private privacy reports, and a [code of conduct](../CODE_OF_CONDUCT.md).
- **Visible in the app:** the header links to the repository, and *How it works* has an "Open source: build on it" section with the CLI command, the data contract, the library and the CI.

## How we use each Arkiv feature

Each row says what the feature changes for the user and why we chose it. Every claim is backed by a transaction recorded in [`arkiv/evidence.json`](../arkiv/evidence.json) by `npm run seed`. The app's **Proof** page lists those transactions and re-checks each against the chain on demand; `npx tsx ledger/cli.ts verify` does the same from a terminal.

| Feature | Where | What the user sees / why |
| --- | --- | --- |
| **Typed attributes vs payload** | [`codec.ts:191-216`](../ledger/src/codec.ts#L191-L216) | Only what people filter on is an attribute (app, work, city, vehicle, month, hours band, take-home, cost share). Display-only fields (incentive outcome, the incident's yes/no outcomes, the sealed box) live in a 4 KB JSON payload, so they stay out of the queryable surface. |
| **Range queries on `i32`** | [`queries.ts:185-186`](../ledger/src/queries.ts#L185-L186) | "Since August" is `period >= i32(202608)`; `net_hourly >= i32(…)` finds days above a threshold. Banding and rounding are privacy decisions that still allow ranges. |
| **`$creator` filters** | [`queries.ts:193-197`](../ledger/src/queries.ts#L193-L197) | Trust lists and *My data* filter with `OR` over `$creator`, which writers cannot forge. This one feature carries the Security track. |
| **`key`-typed attribute** | [`codec.ts:233`](../ledger/src/codec.ts#L233), [`queries.ts:211`](../ledger/src/queries.ts#L211) | An incident's updates ("unblocked after 6 days") and "same here" reports point at it with `parent = key(…)`. Because entries are read-only, this is how a story evolves without anyone rewriting history. |
| **`readonly` creation flag** | [`codec.ts:182-185`](../ledger/src/codec.ts#L182-L185) | A published entry cannot be edited after others relied on it, not even by its author, so nobody can be pressured into "correcting" it. Seed step `readonly_enforced` records the refused patch. |
| **`permissionlessExtension` flag + `extendEntity`** | [`Entity.tsx:123`](../web/src/pages/Entity.tsx#L123) | "Keep alive +30 days" lets a union or researcher keep important evidence alive past the author's chosen lifetime, without write access. Seed step `permissionless_extend` has a non-owner extending. We use `atBlock(current + 30 d)` because extension sets an absolute deadline (friction F2). |
| **Expiration** | [`codec.ts:213`](../ledger/src/codec.ts#L213) | The worker picks 7, 30, 90 or 365 days, and data disappears on schedule. This is the Privacy track's "expiry the user controls". |
| **`deleteEntity` (owner)** | [`Entity.tsx:132`](../web/src/pages/Entity.tsx#L132) | The author can withdraw an entry early, including from a one-time wallet whose key the browser kept. |
| **`patchEntity` with `set`** | [`Trust.tsx:28`](../web/src/pages/Trust.tsx#L28), [`codec.ts:414`](../ledger/src/codec.ts#L414) | A union edits its trust list's members in place (mutable on purpose, owner-only). Seed step `trust_list_patch`. |
| **`executeBatch`** | [`Log.tsx:317`](../web/src/pages/Log.tsx#L317) | A week of days is logged in one transaction from CSV (20 per transaction). The seed and e2e scripts use batches for creates and deletes. |
| **Cursor paging** | [`queries.ts:240-249`](../ledger/src/queries.ts#L240-L249) | Lists follow the SDK cursor (200 per page). Wallet or key lists longer than 25 are split into several queries, because the node refuses more than 64 predicates or 8192 bytes (friction F4, measured live). |
| **WebSocket entity events** | [`Explore.tsx:107-126`](../web/src/pages/Explore.tsx#L107-L126) | The live feed shows new days and incidents without reloading. Keys are batched into one `$key` query, because events carry no attributes (friction F3). |
| **`Expression.toString()`** | [`queries.ts:228-230`](../ledger/src/queries.ts#L228-L230) | Every list shows the exact query and the equivalent CLI command, so anyone can reproduce it without us. |

## Why Arkiv (what would break elsewhere)

| Alternative | What breaks |
| --- | --- |
| Signed records in our own database | Signatures stop forgery but nothing else. We would still decide which reports are shown, and we could be made to delete them; a platform's legal notice reaches one company. The data dies with our server, expiry depends on us honouring it, and unions could read it only through our API, on our terms. |
| Postgres + our API | We become the gatekeeper and the single point of failure. A worker has to trust us not to edit, delete or hand over their data, and that is the trust this problem lacks. |
| IPFS | Content is immutable and addressable, but there are no typed queries (`city`, `period` ranges, `$creator IN list`). We would have to run an indexer, which is our API again. There is no expiry either, so a worker cannot make data go away. |
| Subgraph over contract events | Needs a contract plus an indexer we operate. Multi-attribute filters plus `OR` over creators are awkward, and storing payloads as events is expensive. There is no native expiry or owner-controlled deletion. |
| Arkiv | Typed attributes with equality and range queries; unforgeable `$creator`; `readonly` and `permissionlessExtension` creation flags; per-entity expiry; owner deletion; batch writes; WebSocket events; and a public RPC anyone can read. These map one-to-one onto the product's needs. |

**Deliberately off Arkiv:** names, phone numbers, rider and partner IDs, vehicle numbers, addresses, exact rupees and hours (unless sealed), passphrases, wallet keys and UI preferences.

## Pre-existing work

None. Everything in this repository was written between 14 and 18 October 2026. Third-party code is limited to the open-source dependencies listed in `package.json` files (Arkiv SDK, viem, React/Preact, Vite).
