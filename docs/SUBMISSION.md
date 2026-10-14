# Nexora: Arkiv Global Tour Stop submission notes

Tracks entered: **Best Indian Use Case**, **Censorship Resistance**, **Open Source**, **Privacy**, **Security**.
Each section answers the rubric's question for that track and points to the code that backs every claim.

## The problem

India has over six crore small businesses. More and more of them sell through Instagram reels, WhatsApp status and broadcast lists, Meesho listings and Google ads. Each seller pays to learn the same lessons alone: does a Hinglish reel beat a Hindi WhatsApp status for a tier-2 tea brand at Diwali? Does cash-on-delivery matter in rural orders? Today that knowledge lives in three places, and each one fails the seller:

1. **Platform dashboards.** They report only that platform's numbers, the platform can change or withdraw them, and they are built to sell more ads.
2. **Paid "growth" consultants and course sellers.** Their screenshots of results cannot be checked, and their incentive is to exaggerate.
3. **WhatsApp groups.** Advice there disappears in the scroll, cannot be searched, and anyone can fake a screenshot.

Nexora is a shared, permanent-unless-you-choose-otherwise notebook of ad experiments. Every entry is signed by the seller's wallet, can never be silently edited, and anyone can query it without asking anybody.

## Best Indian Use Case: who in India uses it, and what changes for them

- **Users:** first-time and small online sellers in tier-2, tier-3 and rural India: home kitchens, saree resellers, handicraft makers, local coaching centres. They typically spend ₹500–₹20,000 on a test and cannot afford to waste it.
- **What changes on day one:**
  - Before spending, a seller opens *What to try*, picks their category, region tier, language and budget, and sees which platform and format combinations independent sellers have actually confirmed, with every claim linked to its evidence.
  - After spending, they log the result in under a minute, in Hindi or English. Rupees become a band, so they never reveal their exact turnover.
- **India-specific design:**
  - Region tiers (metro to rural).
  - Twelve Indian ad languages, including Hinglish.
  - Festival seasons (Diwali, Eid, wedding season, Onam/Pongal, Rakhi).
  - India-first platforms (Meesho, ShareChat, Moj, WhatsApp broadcast) and offers (cash on delivery).
  - INR bands.
  - A Hindi UI toggle.
- **Works today:** the app is live and needs no signup. A wallet is created in the browser and gas is sponsored. Demo data is synthetic and labelled; every real entry is a real seller's own result.

## Censorship Resistance: who is harmed if this data is censored or shut down

- **Harmed today:** a seller whose honest review of an ad network or a marketplace's paid boost is unflattering. Today such reviews live on a platform forum, a consultant's blog or a SaaS dashboard, and the platform or the vendor can delete them. When an ad-analytics startup shuts down, its users' history goes with it.
- **What changes:**
  - Experiments are Arkiv entities created by the seller's own wallet (`$creator`).
  - The web app is a static bundle that reads Tiramisu straight from the browser (`ledger/src/queries.ts`, `readClient`). There is **no Nexora backend or database to take down**; the only server code is an optional gas sponsor.
  - With Nexora's website gone, anyone can run `npx tsx ledger/cli.ts query --demo` or paste the exact query shown in the UI into any Arkiv client.
  - The RPC endpoint is user-configurable (`About → Network`, `--rpc` on the CLI), so blocking one endpoint does not block readers.
  - The build uses relative paths and hash routing, so it runs from any static host or IPFS gateway.
  - `npm run build:portable -w web` produces **one self-contained `nexora.html`** (JS and CSS inlined) that opens straight from disk. A seller can receive the whole app as a WhatsApp or Telegram file and use it without any website. Browsers block module scripts from `file://`, which is why the normal build cannot do this.
- **Proof for judges:** run the CLI from a fresh clone with only the public RPC. Then build the portable file, double-click `web/dist-portable/nexora.html`, and the same data loads with no server involved.

## Open Source: can another team build on it without asking?

- **Data contract:** [`arkiv/schema.md`](../arkiv/schema.md) documents every attribute, type, vocabulary, flag and lifetime, plus the exact queries.
- **Reusable library:** [`ledger/`](../ledger) (`@nexora/ledger`, MIT) gives any TypeScript project:
  - `experimentCreate` to write valid entities;
  - `decodeExperiment` to validate untrusted ones;
  - `fetchExperiments` with typed filters;
  - `suggest` / `comboStats` for the analytics;
  - `seal` / `unseal` for the encrypted figures.
- **Permissionless writes and reads:** any app can publish compatible experiments from its own wallet and they show up in Nexora automatically; any app can read Nexora's data the same way. Examples: a Meesho-seller WhatsApp bot, a D2C analytics tool, a seller association's portal.
- **Versioning:** `v = 1` is part of every predicate, so a v2 can coexist.
- **Tests:** `npm test` runs the contract tests (codec round trip, rejection of malformed entities, sealing, query rendering, Sybil dampening, CSV parsing).

## Privacy: who is harmed if this data leaks

- **Harmed today:** a small seller whose exact spend and revenue reach a competitor or a lender. Turnover figures are commercially sensitive, and in India they are also what tax and credit decisions key off. Sellers will not share data that exposes them, so no shared knowledge forms.
- **What is on the explorer (and nothing more):**
  - Eleven closed-vocabulary attributes. There is **no free-text attribute anywhere**, so a name, phone number or shop address cannot be entered even by mistake.
  - Spend as one of six bands.
  - ROI rounded to 10%.
  - The publisher's pseudonymous wallet address. The burner wallet is created in the browser and is linked to no identity.
- **Encrypted payload:** exact spend, sales, orders and a private note are sealed in the browser with AES-256-GCM, using a key derived via PBKDF2-SHA256 (310k iterations) from a passphrase that never leaves the device ([`ledger/src/seal.ts`](../ledger/src/seal.ts)). GCM authentication makes a tampered box fail to open. Without a passphrase, exact figures are discarded after banding.
- **User-controlled expiry:** the seller picks 7, 30, 90 or 365 days and can delete earlier (owner-only `deleteEntity`).
- **Shown before publishing:** the Log page has a three-column "Public on Arkiv / Sealed / Never leaves this device" preview, rendered from the actual values about to be written.
- **No real personal data:** all demo data is synthetic and flagged `demo = true`.

## Security: who is misled if this data is forged

- **Misled today:** a seller who copies a "₹500 → ₹5,000 on ShareChat" strategy from a faked screenshot and loses their budget.
- **Defences in the product:**
  1. **Authorship from `$creator`.** Every view and filter keys authorship off Arkiv's engine-set `$creator` (`experimentPredicate`, `creators` → `$creator = addr(...)`), never off a self-declared field.
  2. **Trust lists.** Communities publish lists of wallets they vouch for, and choosing one adds an `OR` of `$creator` clauses to every query. There is no central gatekeeper; lists compete, and the curator edits membership with owner-only `patchEntity`.
  3. **Sybil dampening.** Recommendations count *distinct creators*, not rows. A combination backed by a single wallet is never suggested as proven, however many rows it writes (`MIN_PUBLISHERS_FOR_PROOF = 2`, confidence `k/(k+2)`), and the leaderboard marks it "unconfirmed". The test *one wallet spamming rows is dampened and never suggested as proven* covers this.
  4. **Immutability.** Experiments are created `readonly`: after others rely on a result, its author cannot rewrite it.
  5. **Contract validation on read.** `decodeExperiment` rejects entities with unknown vocabulary, off-grid ROI, wrong attribute types or oversized payloads. The UI shows the rejection count and reasons instead of silently trusting `app = "nexora"`.
- **Demo:** seed wallet 4 is a deliberate spammer. Select the *Nexora demo: honest seed sellers* trust list and its ShareChat rows disappear; with *All publishers* they appear but are flagged as unconfirmed.
- **Operational:**
  - Keys exist only in the gitignored `.env.local` and the deployment's secrets.
  - The sponsor validates input and enforces per-address, per-IP, global and sponsor-floor limits.
  - Strict security headers and a CSP are set in `web/vercel.json`.
  - `npm audit` reports 0 vulnerabilities.

The full threat model, with residual risks, is in [`THREAT_MODEL.md`](THREAT_MODEL.md).

## Why Arkiv (what would break elsewhere)

| Alternative | What breaks |
| --- | --- |
| Postgres + our API | We become the gatekeeper and the single point of failure. A seller has to trust us not to edit, delete or sell their data, and the data dies with our company. |
| IPFS | Content is immutable and addressable, but there are no typed queries (`spend_band` ranges, `roi_pct >= 0`, `$creator IN list`). We would have to run an indexer, which is our API again. There is no expiry either, so a seller cannot make data go away. |
| Subgraph over contract events | Needs a contract plus an indexer we operate. Multi-attribute range filters plus `OR` over creators are awkward, and storing the payload as events is expensive. There is no native expiry or owner-controlled deletion. |
| Arkiv | Typed attributes with equality and range queries; unforgeable `$creator`; `readonly` and `permissionlessExtension` creation flags; per-entity expiry; owner deletion; batch writes; WebSocket events; and a public RPC anyone can read. These map one-to-one onto the product's needs. |

**Deliberately off Arkiv:** identities, contact details, product names, images, ad copy, exact rupees (unless sealed), passphrases, wallet keys and UI preferences.

## Pre-existing work

None. Everything in this repository was written between 14 and 18 October 2026. Third-party code is limited to the open-source dependencies listed in `package.json` files (Arkiv SDK, viem, React, Vite).
