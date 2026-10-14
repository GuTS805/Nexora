# Threat model

Nexora is a public ledger: anyone can read it and anyone can write to it. This document lists what we protect, from whom, how, and what we do *not* defend against. Every mitigation points to the code that implements it.

## What we protect

| Asset | Why it matters |
| --- | --- |
| A seller's exact spend and revenue | Commercially sensitive: competitors, lenders and tax inferences. |
| A seller's identity (name, phone, shop) | Personal data. It must never reach a public, permanent ledger. |
| The integrity of advice | A seller who copies a fake "winning" ad loses real money. |
| Availability of the data | The whole point is that no single party can take it down. |
| Visitors' wallets and gas | Test GLM only, but the sponsor's balance can be drained. |

## Actors

- **Honest sellers.** They publish their own results.
- **Spammers and marketers.** They want their platform, course or agency to look good, either with fake wins or by burying honest results.
- **Competitors.** They want a specific seller's numbers.
- **A platform or host under pressure.** It wants the data gone, or wants to block access.
- **Freeloaders.** They want the sponsor's gas.

## Threats and mitigations

### T1. Fake results from a single wallet (spam)

- **Attack:** one wallet publishes many rows claiming that a combo works.
- **Mitigations:**
  - Recommendations count *distinct* `$creator` wallets, not rows (`comboStats` in [`ledger/src/insights.ts`](../ledger/src/insights.ts)).
  - A combo needs at least two independent publishers to be suggested (`MIN_PUBLISHERS_FOR_PROOF`).
  - Confidence is `k/(k+2)`.
  - The leaderboard marks single-wallet combos "unconfirmed".
- **Test:** *one wallet spamming rows is dampened and never suggested as proven*.

### T2. Sybil: many free wallets pose as independent sellers

- **Attack:** wallets cost nothing, and the sponsor pays their gas, so five fake "sellers" are cheap.
- **Mitigations:**
  - With a trust set (the selected trust list, or the recommended one when viewing "All sellers"), only trusted creators count toward proof. Everyone's rows stay visible (`InsightOptions.trusted`).
  - The Advisor tells the visitor this in plain language.
  - The sponsor gives at most 3 drips per IP per day ([`web/api/sponsor.ts`](../web/api/sponsor.ts)).
- **Test:** *with a trust set, free throwaway wallets cannot manufacture independent confirmation*.
- **Residual:** trust lists move the problem to curators. That is deliberate: curation is social, and there are many competing lists rather than one gatekeeper.

### T3. Forged authorship

- **Attack:** write an entity that *claims* to be from a trusted seller.
- **Mitigation:** authorship is Arkiv's engine-set `$creator`, which a writer cannot set. Every filter is `$creator = addr(…)`, never a self-declared field (`experimentPredicate` in [`ledger/src/queries.ts`](../ledger/src/queries.ts)).

### T4. Rewriting history after others relied on it

- **Attack:** publish a great result, let others copy it, then quietly edit it.
- **Mitigation:** experiments are created with `readonly: true` ([`ledger/src/codec.ts`](../ledger/src/codec.ts)).
- **Evidence:** the seed step `readonly_enforced` records a refused patch from the owner, and `npm run e2e` re-checks it.
- **Residual:** the owner can still *delete*. That is intended (privacy), and lineage links to a deleted parent simply dangle.

### T5. Malformed or hostile entities

- **Attack:** entities claiming `app = "nexora"` with off-vocabulary values, wrong attribute types, huge payloads, or script-like strings.
- **Mitigations:**
  - `decodeExperiment` / `decodeTrustList` check every attribute's type and vocabulary, the ROI grid, the payload size (4 KB) and the sealed-box shape. Rejected entities are counted and listed in the UI.
  - React escapes all rendered text, and nothing is rendered as HTML.
  - A CSP in [`web/vercel.json`](../web/vercel.json) blocks inline scripts.
- **Test:** *rejects an entity whose attributes were hand-written outside the vocabulary*.

### T6. Impersonating a trust list

- **Attack:** publish a list named like a known association.
- **Mitigation:** list names are not identities. The UI always shows the curator's address, and the recommended list is pinned by **entity key** in [`arkiv/evidence.json`](../arkiv/evidence.json), not by name.
- **Residual:** visitors must check the curator, as with any signed artefact.

### T7. Personal data reaching the ledger

- **Attack/accident:** a seller types their name or phone number into a field.
- **Mitigations:**
  - There is **no free-text attribute**: every queryable value comes from a closed list.
  - The only free text (a private note) exists only inside the sealed box.
  - Trust-list descriptions are public, capped at 280 characters, and labelled "no personal details".
  - Demo data is synthetic.

### T8. Exact figures leaking

- **Mitigations:**
  - Spend is published as one of six bands and ROI rounded to 10% (`spendBand`, `roiPct` in [`ledger/src/schema.ts`](../ledger/src/schema.ts)).
  - Exact values are either discarded or sealed with AES-256-GCM, using a key from PBKDF2-SHA256 at 310,000 iterations. The passphrase must be at least 10 characters ([`ledger/src/seal.ts`](../ledger/src/seal.ts)).
  - GCM authentication makes a tampered box fail to open.
- **Residual:**
  - A weak passphrase can be brute-forced offline, because the ciphertext is public forever (until expiry). The UI enforces a minimum length, and the sealed data are business figures, not identity.
  - The band and the rounded ROI still leak an approximate scale, by design.

### T9. Linking a seller's experiments together

- **Fact:** every experiment from one wallet shares a `$creator`, so a reader can see that "this wallet ran 12 tests in tier-3 sarees".
- **Trade-off:** the same link gives a seller a reputation, and lets trust lists work.
- **Mitigation available:** the burner wallet is not tied to any identity. On *Log a result*, "Publish from a fresh one-time wallet" uses a new key for that one result, so it cannot be linked to the seller's other results by `$creator`. The keys stay in the browser, so *My data* still lists, extends and deletes those results, and can back the keys up and restore them (`createOneOff` / `walletFor` in [`web/src/arkiv.tsx`](../web/src/arkiv.tsx)).
- **Residual:** timing and gas funding (the sponsor's transfers) are public and can correlate wallets.

### T10. Censorship and takedown

- **Attack:** take down the website, block the domain, or pressure the operator.
- **Mitigations:**
  - There is no Nexora database. The web app is a static bundle with hash routing and relative paths, so it runs from any host or IPFS gateway, and `npm run build:portable` produces a single `nexora.html` that opens from disk or a file share.
  - The CLI reads Arkiv directly.
  - The RPC is configurable in the UI and the CLI (`--rpc`, `ARKIV_RPC_URL`).
- **Residual:** the public Tiramisu RPC is a single default endpoint, and it rate-limits anonymous reads (friction F9). A blocked or exhausted RPC needs another node or an access key.

### T11. Read-budget exhaustion as denial of service

- **Fact:** the anonymous RPC budget is per IP, so heavy readers behind one NAT starve each other.
- **Mitigations:**
  - 429 responses surface in seconds instead of hanging (`arkivHttp`).
  - The live feed batches lookups into one `$key` query.
  - Keyed RPC URLs can be used server-side.

### T12. Sponsor drain

- **Mitigations:** the sponsor:
  - funds only wallets with less than 0.001 GLM;
  - allows one drip per address per hour, 3 per IP per day, and a global hourly cap;
  - stops below a 0.05 GLM floor;
  - validates input, never writes entities and stores nothing.
- **Residual:** the limits live in memory per serverless instance; distributed abuse can still empty a testnet faucet. The impact is limited to visitors having to use the public faucet.

### T13. Burner key theft

- **Fact:** the test wallet key lives in `localStorage`, so a malicious browser extension or an XSS bug could read it.
- **Mitigations:**
  - It is a testnet key with a few test GLM.
  - The CSP blocks inline and third-party scripts.
  - Users can bring their own browser wallet instead.
- **Residual:** with the key, an attacker could delete that wallet's own entities.

### T14. Supply chain

- **Mitigations:**
  - Dependencies are pinned in `package-lock.json`, and `npm audit` reports 0 known vulnerabilities.
  - The SDK version is pinned (`0.8.1`).
  - Private keys exist only in the gitignored `.env.local` and deployment secrets. `npm run check:secrets` fails if any of those values appears in a tracked or staged file; it runs as a pre-commit hook (`.githooks/pre-commit`; enable with `git config core.hooksPath .githooks`).

## Out of scope

- **Verifying that a sale really happened.** An entity proves *who* claimed a result, not that it is true. The UI says so, and trust lists exist because of it.
- **Mainnet funds.** Everything here is Tiramisu testnet.
