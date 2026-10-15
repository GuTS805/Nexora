# Threat model

Nexora is a public ledger: anyone can read it and anyone can write to it. This document lists what we protect, from whom, how, and what we do *not* defend against. Every mitigation points to the code that implements it.

## What we protect

| Asset | Why it matters |
| --- | --- |
| A worker's identity (name, phone, rider ID, vehicle number) | If a report or an earnings history can be tied to a rider ID, the platform can block or deactivate that worker. It must never reach a public, permanent ledger. |
| A worker's exact earnings and hours | Personal financial data: lenders, landlords, and the platform itself. |
| The integrity of the figures | A worker who joins an app on the strength of fake "₹40,000 a month" figures loses real income; a policymaker misled by flooded data makes worse rules. |
| Availability of the data | The whole point is that no single party, platform included, can take it down. |
| Visitors' wallets and gas | Test GLM only, but the sponsor's balance can be drained. |

## Actors

- **Honest workers.** They publish their own days and incidents.
- **Platforms and their agents.** They want their app to look good (fake high earnings, fake "sorted out" outcomes), or want critical reports buried, deleted, or traced to the worker who wrote them.
- **Recruiters and agencies.** They want inflated earnings figures to attract sign-ups.
- **A host or operator under pressure.** They receive a legal notice and want the data gone, or want to block access.
- **Freeloaders.** They want the sponsor's gas.

## Threats and mitigations

### T1. Fake figures from a single wallet (spam)

- **Attack:** one wallet publishes many days claiming that an app pays ₹400 an hour.
- **Mitigations:**
  - Figures count *distinct* `$creator` wallets, not rows (`earningsStats` / `comparePlatforms` in [`ledger/src/insights.ts`](../ledger/src/insights.ts)).
  - A figure needs at least two independent workers to be "confirmed" (`MIN_WORKERS_FOR_CONFIRMED`), and unconfirmed figures never outrank confirmed ones.
  - The tables mark single-wallet figures "unconfirmed".
- **Test:** *one wallet repeating a figure stays unconfirmed and never outranks confirmed pay*.

### T2. Sybil: many free wallets pose as independent workers

- **Attack:** wallets cost nothing, and the sponsor pays their gas, so five fake "workers", perhaps a platform's own staff, are cheap.
- **Mitigations:**
  - With a trust set (the selected trust list, or the recommended one when viewing "All workers"), only trusted creators count toward confirmation. Everyone's entries stay visible (`InsightOptions.trusted`).
  - Month-on-month changes ("pay fell 20%") are reported only when both months are confirmed, so a handful of wallets cannot fake a trend (`monthChange`).
  - *Compare* tells the visitor this in plain language.
  - The sponsor gives at most 3 drips per IP per day ([`api/sponsor.ts`](../api/sponsor.ts)).
- **Tests:** *with a trust set, free throwaway wallets cannot manufacture independent confirmation*; *reports a month-on-month change only when both months are confirmed*.
- **Residual:** trust lists move the problem to curators. That is deliberate: curation is social (unions, riders' groups), and there are many competing lists rather than one gatekeeper.

### T3. Forged authorship

- **Attack:** write an entity that *claims* to be from a trusted worker.
- **Mitigation:** authorship is Arkiv's engine-set `$creator`, which a writer cannot set. Every filter is `$creator = addr(…)`, never a self-declared field (`common` in [`ledger/src/queries.ts`](../ledger/src/queries.ts)).

### T4. Rewriting history, or pressure to "correct" a report

- **Attack:** publish figures, let others rely on them, then quietly edit them; or pressure a worker into editing a critical report.
- **Mitigation:** entries are created with `readonly: true` ([`ledger/src/codec.ts`](../ledger/src/codec.ts)). An update is a new entry linked by `parent`, so the original stays as written.
- **Evidence:** the seed step `readonly_enforced` records a refused patch from the owner, and `npm run e2e` re-checks it.
- **Residual:** the owner can still *delete*. That is intended (privacy), and a pressured worker could be made to delete. `permissionlessExtension` lets others keep an entry alive, but not resurrect a deleted one, and an update pointing at a deleted report simply dangles.

### T5. Malformed or hostile entities

- **Attack:** entities claiming `app = "nexora"` with off-vocabulary values, wrong attribute types, huge payloads, or script-like strings.
- **Mitigations:**
  - `decodeShift` / `decodeIncident` / `decodeTrustList` check every attribute's type and vocabulary, the rate and cost grids, the month, the payload size (4 KB) and the sealed-box shape. Rejected entities are counted and listed in the UI.
  - React escapes all rendered text, and nothing is rendered as HTML.
  - A CSP in [`vercel.json`](../vercel.json) blocks inline scripts.
- **Test:** *rejects an entity whose attributes were hand-written outside the vocabulary*.

### T6. Impersonating a trust list

- **Attack:** publish a list named like a known union.
- **Mitigation:** list names are not identities. The UI always shows the curator's address, and the recommended list is pinned by **entity key** in [`arkiv/evidence.json`](../arkiv/evidence.json), not by name.
- **Residual:** visitors must check the curator, as with any signed artefact.

### T7. Personal data reaching the ledger

- **Attack/accident:** a worker types their name, phone number or rider ID into a field.
- **Mitigations:**
  - There is **no free-text attribute**: every queryable value comes from a closed list.
  - The only free text (a private note) exists only inside the sealed box, and the form tells workers never to put their name, phone or rider ID even there.
  - Trust-list descriptions are public, capped at 280 characters, and labelled "no personal details".
  - Demo data is synthetic.

### T8. Exact figures leaking

- **Mitigations:**
  - Hours are published as one of six bands; take-home per hour is rounded to ₹10 and cost share to 10% (`hoursBand`, `netHourly`, `costPct` in [`ledger/src/schema.ts`](../ledger/src/schema.ts)).
  - Exact values are either discarded or sealed with AES-256-GCM, using a key from PBKDF2-SHA256 at 600,000 iterations (OWASP's current recommendation; each box records its count, so older boxes still open). The passphrase must be at least 10 characters ([`ledger/src/seal.ts`](../ledger/src/seal.ts)).
  - GCM authentication makes a tampered box fail to open.
- **Test:** *never writes rupee amounts or exact hours into attributes or the public payload*; the UI test checks the privacy preview's public column.
- **Residual:**
  - A weak passphrase can be brute-forced offline, because the ciphertext is public until expiry. The UI enforces a minimum length.
  - The band and the rounded rate still leak an approximate scale, by design.

### T9. Linking a worker's entries together, or to a person

- **Fact:** every entry from one wallet shares a `$creator`, so a reader can see that "this wallet logged 40 days of Bengaluru food delivery on an EV". Combined with a platform's own records (city, vehicle, days worked), a long history could narrow down who the worker is.
- **Trade-off:** the same link gives a worker a reputation, and lets trust lists work.
- **Mitigations:**
  - The burner wallet is not tied to any identity.
  - **Incident reports default to a fresh one-time wallet**, so a report about a block or a pay cut cannot be linked to the worker's earnings history, or to their other reports. Any entry can opt into a one-time wallet.
  - Month (not date) and banded hours make day-level matching against platform logs harder.
  - The one-time keys stay in the browser, so *My data* still lists, extends and deletes those entries, and can back the keys up and restore them (`createOneOff` / `walletFor` in [`web/src/arkiv.tsx`](../web/src/arkiv.tsx)).
- **Residual:** timing and gas funding (the sponsor's transfers) are public and can correlate wallets. A platform that sees an entry's exact block time could compare it with who was online. Workers who are at risk should log days in batches rather than right after a shift.

### T10. Censorship and takedown

- **Attack:** take down the website, block the domain, or send the operator a legal notice.
- **Mitigations:**
  - There is no Nexora database. The web app is a static bundle with hash routing and relative paths, so it runs from any host or IPFS gateway, and `npm run build:portable` produces a single `nexora.html` that opens from disk or a file share.
  - The CLI reads Arkiv directly, and [`examples/read-without-nexora.mjs`](../examples/read-without-nexora.mjs) needs only the official SDK.
  - The RPC is configurable in the UI and the CLI (`--rpc`, `ARKIV_RPC_URL`).
- **Residual:** the public Tiramisu RPC is a single default endpoint, and it rate-limits anonymous reads (friction F6). A blocked or exhausted RPC needs another node or an access key.

### T11. Read-budget exhaustion as denial of service

- **Fact:** the anonymous RPC budget is per IP, so heavy readers behind one NAT (a union office, a mobile carrier's CGNAT) starve each other.
- **Mitigations:**
  - 429 responses surface in seconds instead of hanging (`arkivHttp`).
  - The live feed batches lookups into one `$key` query.
  - Keyed RPC URLs can be used server-side.
  - After a 429, the browser sends that `arkiv_query` to the deployment's [`api/read.ts`](../api/read.ts), whose answers the CDN shares for 30 s, so one office costs a few upstream queries. It forwards only `arkiv_query` with at most 8 KB of query, and caches budget refusals for 15 s so a burst cannot hammer an exhausted budget.
  - The fallback is **not a general Arkiv gateway**: it forwards only queries scoped to `app = str('nexora')` with no top-level `OR` that could widen them, or a single `$key` lookup, and allows 60 uncached queries per IP per minute ([`isNexoraQuery`](../api/read.ts), tests in [`web/api/read.test.ts`](../web/api/read.test.ts)). Nobody can spend the deployment's access key on other data or drain it from one machine.
- **Residual:** the fallback is a server, so whoever runs it could alter answers. That adds no new trust: the same operator already serves the app's JavaScript. The CLI, the portable file and a custom RPC never use it, so anyone who doubts it can compare directly against Arkiv.

### T12. Sponsor drain

- **Mitigations:** the sponsor:
  - funds only wallets with less than 0.001 GLM;
  - allows one drip per address per hour (and refuses a second request for an address while the first is still being sent), 3 per IP per day, and a global hourly cap;
  - reads the caller's address from `x-vercel-forwarded-for`, which the platform sets itself, rather than a header a client can send;
  - forgets expired entries so a long-lived instance cannot be grown without bound;
  - stops below a 0.05 GLM floor;
  - refuses requests whose `Origin` is another website, so no other page can spend it through its visitors' browsers;
  - caps the drip at 0.05 GLM even if its optional `SPONSOR_DRIP_GLM` override is mistyped;
  - validates input, never writes entities and stores nothing.
- **Code and tests:** [`api/_limits.ts`](../api/_limits.ts), [`web/api/limits.test.ts`](../web/api/limits.test.ts).
- **Residual:** the limits live in memory per serverless instance; distributed abuse can still empty a testnet faucet. The impact is limited to visitors having to use the public faucet.

### T13. Burner key theft

- **Fact:** the test wallet key lives in `localStorage`, so a malicious browser extension or an XSS bug could read it.
- **Mitigations:**
  - It is a testnet key with a few test GLM.
  - The CSP blocks inline and third-party scripts, plugins (`object-src 'none'`) and framing. `connect-src` allows any `https:`/`wss:` host on purpose, because readers can switch to any Arkiv RPC (T10). So an injected script could send data out, and the CSP's job is to keep scripts from being injected. `Permissions-Policy` turns off camera, microphone, location and payment APIs, and `Cross-Origin-Opener-Policy: same-origin` cuts the window off from pages it opens.
  - Users can bring their own browser wallet instead.
- **Residual:** with the key, an attacker could delete that wallet's own entries, or learn which entries a phone published if they get the phone.

### T14. Supply chain

- **Mitigations:**
  - Dependencies are pinned in `package-lock.json`, and `npm audit` reports 0 known vulnerabilities.
  - The SDK version is pinned (`0.8.1`).
  - Private keys exist only in the gitignored `.env.local` and deployment secrets. `npm run check:secrets` fails if any of those values appears in a tracked or staged file; it runs as a pre-commit hook (`.githooks/pre-commit`; enable with `git config core.hooksPath .githooks`).
  - CI also runs [gitleaks](../.gitleaks.toml) over the **full git history** on every push. The binary is pinned to a version and checked against its SHA-256 before it runs.
  - Every GitHub Action is pinned to a full commit SHA, not a movable tag, and checkouts do not keep the token (`persist-credentials: false`). Dependabot updates the pins. Workflows get read-only permissions; only CodeQL may write security events.
  - CI publishes a SHA-256 checksum next to the portable `nexora.html`, so a union passing the file around can check it is the one CI built.
  - The sealed payload's key derivation uses PBKDF2-SHA256 at 600,000 iterations (OWASP's current figure). Boxes record their own count, so older ones still open.

## Known limitations

Stated plainly, so nobody has to find them:

1. **Confirmation is only as honest as the trust list you pick.** A curator who adds the wrong wallets can make a figure look confirmed. Lists are public, anyone can publish a competing one, and the reader chooses; there is no central authority to fix this and none is planned.
2. **Entries are claims, not verified payslips.** Nothing proves a worker earned what they say. Independent agreement between trusted workers is the only evidence the app offers, and the UI says so.
3. **The test-wallet key sits in the browser's local storage** (T13). A malicious extension on the same browser could read it.
4. **Sponsor limits are per serverless instance** (T12), a speed bump rather than a guarantee.
5. **Timing and wallet correlation.** Reports go out from a one-time wallet, but a very small group of workers publishing at the same moment could be correlated by someone watching the chain (T9).
6. **Testnet only.** Nothing here has been audited by an outside party; the checks are our own tests, `npm audit`, CodeQL and review.

## Out of scope

- **Verifying that a day's pay is real.** An entity proves *who* claimed it, not that it is true; we do not see payslips. The UI says so, and trust lists exist because of it.
- **Defending a worker whose phone is seized.** The one-time keys on the device show what it published.
- **Mainnet funds.** Everything here is Tiramisu testnet.
