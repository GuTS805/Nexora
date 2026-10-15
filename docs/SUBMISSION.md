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
  - After a day's work, they log it in under a minute, in Hindi or English: pay, costs, hours. Or they tap **"Say your day"** and say "1200 कमाए, 300 का पेट्रोल, 9 घंटे" (or "earned 1200, petrol 300, 9 hours"), and the three numbers fill themselves in for the worker to check. Exact rupees and hours become a band and a rounded rate, so no entry fingerprints one worker's income.
  - **No network, no lost day.** With no signal (a basement parking, a patchy 2G zone) the entry is saved on the phone exactly as it will be published, already banded, and published as soon as the network is back. The hosted app opens offline too.
  - When something happens (an ID block, a pay cut, an unexplained penalty), they report it from a fresh one-time wallet, and later post an update ("unblocked after 6 days"). Unions get a running, unfakeable count of what happens to whom, with how many days of work it cost.
  - **A report leads to action.** The report's page drafts a complaint letter to the platform's grievance officer, a union, or the state labour department or welfare board. It includes what happened, the days lost, whether a reason was given, a specific request for each kind of incident, and links anyone can use to check the record. The worker adds their name and ID only after copying; the app never asks for them. A "Where to send it" note gives the general routes: the Code on Social Security, 2020 (in force since 21 November 2025) recognises gig and platform workers; Karnataka's 2025 law sends payout, deduction and termination complaints to the platform's internal committee, then the welfare board; Rajasthan's 2023 law takes grievances through a state portal or a designated officer. It says plainly that it is not legal advice. *Incidents* prints, or saves as PDF, a report a union can take to a labour office: the summary, every entry with its explorer link, and the exact query. Workers who have not registered are pointed to **e-Shram**, the Labour Ministry's portal where platform workers sign up for government social security schemes.
  - **A report gets an answer.** A union, a worker group or the platform can reply to a report: received, taken up, escalated to the labour department or board, resolved, or cannot help. A reply is its own read-only entry linked to the report by `parent`; it never changes the report, and only the worker's own update can mark the report resolved. The report page shows every reply and marks the ones from the wallet that runs the recommended trust list; replies from the reporter's own wallet do not count. *Incidents* says how many reports have been answered, and by whom. Seed step `union_reply` records three such replies on chain.
- **India-specific design:**
  - India's platforms and kinds of work (quick commerce, bike taxis, autos).
  - Indian cities, tier-2 included.
  - The incentive-target system ("target met or missed").
  - Take-home per logged-in hour, waiting included, because time spent waiting for orders is unpaid but still spent.
  - ₹ figures.
  - A Hindi UI, Hindi voice input, and "Listen" buttons that read a comparison, a report or a complaint letter aloud, for workers who would rather listen than read.
  - Built for patchy mobile networks: a small bundle, an offline shell and an offline queue.
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
- **Unlinkable incident reports:** incident reports are published from a fresh one-time wallet by default ([`Log.tsx:114`](../web/src/pages/Log.tsx#L114)), so a report cannot be joined to the worker's earnings history, or to their other reports, by `$creator`. The keys stay in the browser for later updates, extension or deletion, with a backup in *My data*.
- **Encrypted payload:** exact pay, costs, hours, orders and a private account of what happened are sealed in the browser with AES-256-GCM, using a key derived via PBKDF2-SHA256 (600k iterations, OWASP's current figure) from a passphrase that never leaves the device ([`ledger/src/seal.ts`](../ledger/src/seal.ts)). A worker can hand the passphrase to a union or a lawyer. GCM authentication makes a tampered box fail to open. Without a passphrase, exact figures are discarded after banding.
- **Voice and offline, without new leaks:** voice input is opt-in and says on screen that the browser does the speech-to-text (Chrome sends the audio to Google); only the three numbers reach the form, and nothing is published until the worker presses Publish. An entry saved offline is stored on the phone exactly as it will be published, already banded, with private details sealed; the exact rupees and hours and the passphrase are never stored ([`web/src/queue.ts`](../web/src/queue.ts)).
- **User-controlled expiry:** the worker picks 7, 30, 90 or 365 days and can delete earlier (owner-only `deleteEntity`).
- **Shown before publishing:** the *Log my day* page has a three-column "Public on Arkiv / Sealed / Never leaves this device" preview, rendered from the actual values about to be written. A UI test checks that the exact rupees and hours never appear in the public column.
- **Audited in public:** `nexora audit` reads every entity on chain that claims `app = "nexora"`. It holds every entry readers would show to the strict [JSON Schemas](../arkiv/schema) (no attribute outside the contract, no exact figures, only well-formed sealed boxes) and scans all clear-text strings for phone numbers, emails and 12-digit ID numbers. Anyone can run it with `npx -p nexora-ledger nexora audit`; the [audit workflow](../.github/workflows/audit.yml) runs it daily. Result on 15 October 2026: 181 entities (including the replies), 0 violations. It also reports how many incident wallets also wrote earnings. That is 0 for workers' entries; the demo seed data reuses its wallets on purpose and is labelled as such.

## Censorship Resistance: who is harmed if this data is censored or shut down

- **Harmed today:** workers whose evidence of a pay cut or an unfair block lives somewhere a platform can reach. A forum post gets reported and removed. A worker is pressured to delete a video. A union's survey spreadsheet is a single file on a single account. An NGO's portal is one legal notice away from going offline.
- **What changes:**
  - Entries are Arkiv entities created by the worker's own wallet (`$creator`). Entries are `readonly`, so nobody, not even the author under pressure, can quietly "correct" them. Only the author can delete. Anyone can keep a useful entry alive past its expiry (`permissionlessExtension`).
  - **Deleting can itself be coerced** ("take that report down or stay blocked"). So a worker can **lock** a report: it is created and handed to `0x…dEaD` in the same `executeBatch`, and from then on nobody, the author included, can delete it before the lifetime they chose ends. It is opt-in, because for most entries the right to delete is a privacy protection. Seed step `ownership_lock` records it on chain, including the author's own refused delete, and the Proof page re-checks it.
  - The web app is a static bundle that reads Tiramisu straight from the browser (`ledger/src/queries.ts`, `readClient`). There is **no Nexora backend or database to take down**. The only server code is an optional gas sponsor and a cached read fallback that the browser uses only after the public RPC rate-limits it. Deleting both loses no data and breaks no reader.
  - With Nexora's website gone, anyone can run `npx tsx ledger/cli.ts earnings --demo` or paste the exact query shown in the UI into any Arkiv client. [`examples/read-without-nexora.mjs`](../examples/read-without-nexora.mjs) rebuilds the per-app comparison with only the official SDK.
  - The RPC endpoint is user-configurable (`How it works → Network`, `--rpc` on the CLI), so blocking one endpoint does not block readers.
  - `npm run build:portable -w web` produces **one self-contained `nexora.html`** that opens straight from disk. A union can hand the whole app to members as a WhatsApp or Telegram file, and it works with no website at all.
- **Proof for judges:** run the CLI from a fresh clone with only the public RPC. Then build the portable file, double-click `web/dist-portable/nexora.html`, and the same data loads with no server involved.

## Security: who is misled if this data is forged

- **Misled today:** a worker who joins an app because of an "earn ₹40,000 a month" claim from a recruiter, an agency or a faked screenshot. A policymaker reading a platform-sponsored "earnings report". A union whose survey is flooded with fake happy responses.
- **Defences in the product:**
  1. **Authorship from `$creator`.** Every view and filter keys authorship off Arkiv's engine-set `$creator` ([`queries.ts:199-203`](../ledger/src/queries.ts#L199-L203)), never off a self-declared field.
  2. **Trust lists.** Unions and riders' groups publish lists of wallets they vouch for. Choosing one adds an `OR` of `$creator` clauses to every query. There is no central gatekeeper: lists compete, and the curator edits membership with owner-only `patchEntity`.
  3. **Sybil dampening.** Figures count *distinct workers*, not rows. A figure is "confirmed" only when at least two independent workers, and when a trust list is in use, two trusted workers, report it (`MIN_WORKERS_FOR_CONFIRMED = 2`, [`insights.ts:15`](../ledger/src/insights.ts#L15)). Unconfirmed figures never outrank confirmed ones ([`insights.ts:119`](../ledger/src/insights.ts#L119)). A month-on-month "pay cut" is reported only when both months are confirmed, so one wallet cannot fake a trend. The tests *one wallet repeating a figure stays unconfirmed* and *with a trust set, free throwaway wallets cannot manufacture independent confirmation* cover this.
  4. **Immutability.** Entries are created `readonly`: after others rely on a figure, its author cannot rewrite it. Corrections and updates are new entries linked by `parent`.
  5. **Contract validation on read.** `decodeShift`, `decodeIncident` and `decodeReply` reject entities with unknown vocabulary, off-grid rates, impossible months, wrong attribute types or oversized payloads. The UI shows the rejection count and reasons instead of silently trusting `app = "nexora"`.
- **Replies cannot be faked into authority:** anyone can publish a reply, so the app marks only replies whose `$creator` runs the recommended trust list, and ignores replies from the reporter's own wallet ([`repliesTo`](../ledger/src/insights.ts)). A platform cannot make a report look "resolved": a reply never changes the report.
- **Demo:** demo wallet 10 is a deliberate spammer that claims ₹350–450 an hour for bike taxis in Bengaluru. In *Compare* with *All workers*, its days are counted but marked unconfirmed. Select the *Nexora demo: honest seed workers* trust list and they disappear.
- **Operational:**
  - Keys exist only in the gitignored `.env.local` and the deployment's secrets.
  - The sponsor validates input and enforces per-address, per-IP, global and sponsor-floor limits.
  - Strict security headers are set in `vercel.json`: a CSP with no inline or third-party scripts, no plugins and no framing, plus `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` and HSTS.
  - The read fallback is not an open gateway. It forwards only Nexora-scoped queries (no top-level `OR` can widen them) or one entity by key, with a per-IP cap, so the deployment's Arkiv access key cannot be spent on other data. The sponsor refuses other websites' origins.
  - `npm audit` reports 0 vulnerabilities, [CodeQL](../.github/workflows/codeql.yml) scans every push with the `security-extended` queries, gitleaks scans the full git history, every Action is pinned to a commit SHA, and Dependabot proposes dependency updates weekly.
  - The sponsor's limits are in [`api/_limits.ts`](../api/_limits.ts) with their own tests: a wallet is refused while its first request is still in flight, expired entries are dropped, and the caller's address comes from the platform's own header.
  - The functions in `api/` are type-checked in strict mode as part of `npm run typecheck`.

The full threat model, with residual risks and a plain list of known limitations, is in [`THREAT_MODEL.md`](THREAT_MODEL.md#known-limitations).

## Open Source: can another team build on it without asking?

- **Data contract:** [`arkiv/schema.md`](../arkiv/schema.md) documents every attribute, type, vocabulary, flag and lifetime, plus the exact queries.
- **Machine-checkable contract:** [`arkiv/schema/*.schema.json`](../arkiv/schema) are JSON Schema 2020-12 files, one per entity kind, usable from any language. They are generated from the same constants as the codec, and a test fails if the committed files drift.
- **On npm:** `npm install nexora-ledger` gives the library, the schemas (`nexora-ledger/contract`, `nexora-ledger/schema/*.json`) and the `nexora` CLI. CI packs the package and installs it into a clean project on every push.
- **Reusable library:** [`ledger/`](../ledger) (`nexora-ledger`, MIT) gives any JavaScript or TypeScript project:
  - `shiftCreate` / `incidentCreate` / `replyCreate` to write valid entities;
  - `decodeShift` / `decodeIncident` / `decodeReply` to validate untrusted ones;
  - `fetchShifts` / `fetchIncidents` / `fetchReplies` with typed filters, and `repliesTo` / `answeredReports` for who answered what;
  - `comparePlatforms`, `earningsStats`, `monthChange` and `incidentStats` for the analytics;
  - `seal` / `unseal` for the encrypted details;
  - `validateEntity` / `auditEntities` to check data against the JSON Schemas and for personal data.
- **Permissionless writes and reads:** any app can publish compatible entries from its own wallet, and they show up in Nexora automatically. Any app can read Nexora's data the same way. Examples: a union's WhatsApp bot that logs members' days, a researcher's dashboard, a state welfare board's monitoring page, a journalist's notebook.
- **Versioning:** `v = 1` is part of every predicate, so a v2 can coexist.
- **Tests:** `npm test` runs 106 tests in 18 files, with one file per library module ([`ledger/test`](../ledger/test)) plus the server functions. They cover the codec round trip, rejection of malformed entities, the JSON Schemas (accepting every shape the codec writes, rejecting leaks), the personal-data scan, sealing, query rendering against the node's measured limits, Sybil dampening, month-on-month confirmation, CSV parsing, the read fallback, the sponsor's limits, and every write shape through the real SDK up to signing, the spoken-day parser and the offline queue. A headless-Chrome UI test adds 26 checks against the production build, including the complaint letter, the printable union report, a locked entry, a union's reply, the offline save and the offline shell.
- **Checked in public:** [GitHub Actions](../.github/workflows/ci.yml) runs typecheck, tests, the build, the UI test, the single-file build, `npm audit` and an npm pack-and-install check on every push and pull request. CodeQL runs separately, and so does the daily [privacy audit](../.github/workflows/audit.yml) of live data.
- **Ready for contributors:** [`CONTRIBUTING.md`](../CONTRIBUTING.md) explains setup, how to add a city, platform, kind of work or language, and the rules that keep the data trustworthy (no personal data on chain, fixed lists, versioned contract). There are issue templates for bugs and new vocabulary, a pull-request checklist, a [security policy](../SECURITY.md) for private privacy reports, and a [code of conduct](../CODE_OF_CONDUCT.md).
- **Visible in the app:** the header links to the repository, and *How it works* has an "Open source: build on it" section with the CLI command, the data contract, the library and the CI.

## How we use each Arkiv feature

Each row says what the feature changes for the user and why we chose it. Every claim is backed by a transaction recorded in [`arkiv/evidence.json`](../arkiv/evidence.json) by `npm run seed`. The app's **Proof** page lists those transactions and re-checks all of them against the chain from the visitor's browser on arrival; `npx tsx ledger/cli.ts verify` does the same from a terminal.

| Feature | Where | What the user sees / why |
| --- | --- | --- |
| **Typed attributes vs payload** | [`codec.ts:216-241`](../ledger/src/codec.ts#L216-L241) | Only what people filter on is an attribute (app, work, city, vehicle, month, hours band, take-home, cost share). Display-only fields (incentive outcome, the incident's yes/no outcomes, the sealed box) live in a 4 KB JSON payload, so they stay out of the queryable surface. |
| **Range queries on `i32`** | [`queries.ts:191-192`](../ledger/src/queries.ts#L191-L192) | "Since August" is `period >= i32(202608)`; `net_hourly >= i32(…)` finds days above a threshold. Banding and rounding are privacy decisions that still allow ranges. |
| **`$creator` filters** | [`queries.ts:199-203`](../ledger/src/queries.ts#L199-L203) | Trust lists and *My data* filter with `OR` over `$creator`, which writers cannot forge. This one feature carries the Security track. |
| **`key`-typed attribute** | [`codec.ts:258`](../ledger/src/codec.ts#L258), [`queries.ts:217`](../ledger/src/queries.ts#L217), [`queries.ts:223`](../ledger/src/queries.ts#L223) | An incident's updates ("unblocked after 6 days"), "same here" reports and replies from unions all point at it with `parent = key(…)`. Because entries are read-only, this is how a story evolves, and how others answer it, without anyone rewriting history. Seed steps `incident_followup` and `union_reply`. |
| **`readonly` creation flag** | [`codec.ts:207-210`](../ledger/src/codec.ts#L207-L210) | A published entry cannot be edited after others relied on it, not even by its author, so nobody can be pressured into "correcting" it. Seed step `readonly_enforced` records the refused patch. |
| **`permissionlessExtension` flag + `extendEntity`** | [`Entity.tsx:149`](../web/src/pages/Entity.tsx#L149) | "Keep alive +30 days" lets a union or researcher keep important evidence alive past the author's chosen lifetime, without write access. Seed step `permissionless_extend` has a non-owner extending. We use `atBlock(current + 30 d)` because extension sets an absolute deadline (friction F2). |
| **Expiration** | [`codec.ts:238`](../ledger/src/codec.ts#L238) | The worker picks 7, 30, 90 or 365 days, and data disappears on schedule. This is the Privacy track's "expiry the user controls". |
| **`deleteEntity` (owner)** | [`Entity.tsx:159`](../web/src/pages/Entity.tsx#L159) | The author can withdraw an entry early, including from a one-time wallet whose key the browser kept, unless they locked it. |
| **Ownership transfer (`ownershipChanges`) + `predictEntityKeys`** | [`lock.ts:27-38`](../ledger/src/lock.ts#L27-L38), [`Log.tsx:118`](../web/src/pages/Log.tsx#L118) | "Lock it": the create carries a predicted key's salt, so the same atomic batch can hand that key to `0x…dEaD`. If the prediction were wrong, the whole batch fails, so an unlocked copy is never left behind. Seed step `ownership_lock`; the author's own delete afterwards was refused by the chain. |
| **`patchEntity` with `set`** | [`Trust.tsx:28`](../web/src/pages/Trust.tsx#L28), [`codec.ts:476`](../ledger/src/codec.ts#L476) | A union edits its trust list's members in place (mutable on purpose, owner-only). Seed step `trust_list_patch`. |
| **`executeBatch`** | [`Log.tsx:340`](../web/src/pages/Log.tsx#L340) | A week of days is logged in one transaction from CSV (20 per transaction). The seed and e2e scripts use batches for creates and deletes; the demo union's three replies went out in one batch. |
| **Cursor paging** | [`queries.ts:252-261`](../ledger/src/queries.ts#L252-L261) | Lists follow the SDK cursor (200 per page). Wallet or key lists longer than 25 are split into several queries, because the node refuses more than 64 predicates or 8192 bytes (friction F4, measured live). |
| **WebSocket entity events** | [`Explore.tsx:109-128`](../web/src/pages/Explore.tsx#L109-L128) | The live feed shows new days and incidents without reloading. Keys are batched into one `$key` query, because events carry no attributes (friction F3). |
| **`Expression.toString()`** | [`queries.ts:240-242`](../ledger/src/queries.ts#L240-L242) | Every list shows the exact query and the equivalent CLI command, so anyone can reproduce it without us. |

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
