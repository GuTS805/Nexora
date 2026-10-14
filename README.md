# Nexora Ledger

**What delivery and ride work in India really pays — reported by workers, owned by no company.** Nexora is an open ledger where gig workers (food and grocery delivery riders, cab and bike-taxi drivers) log what a day actually paid after fuel and costs, and report what happened to them at work: ID blocks, pay cuts, unexplained penalties. It is stored on [Arkiv](https://arkiv.network). Anyone can read it, nobody can quietly rewrite it, no platform can take it down, and no worker has to give their name.

- **Live app:** https://nexora-pi-snowy.vercel.app
- **Demo video (≤ 3 min):** _add link_
- **Data contract:** [`arkiv/schema.md`](arkiv/schema.md)
- **Friction report:** [`arkiv/friction.md`](arkiv/friction.md)
- **Per-track write-up:** [`docs/SUBMISSION.md`](docs/SUBMISSION.md)
- **Threat model:** [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
- **On-chain evidence:** [`arkiv/evidence.json`](arkiv/evidence.json) (every feature, with tx hashes) and [`arkiv/e2e-report.md`](arkiv/e2e-report.md)

Built for the Arkiv Global Tour Stop (pre-Devcon 8), 9–18 October 2026. Tracks: Best Indian Use Case, Privacy, Censorship Resistance, Security, Open Source.

## Why

India had about 77 lakh gig workers in 2020-21, and NITI Aayog projects 2.35 crore by 2029-30. In the 2024 *Prisoners on Wheels?* survey of app-based workers across eight Indian cities, 43% of cab drivers took home under ₹500 a day after costs, 34% of delivery workers took home under ₹10,000 a month, and 87% of delivery workers said ID blocking and deactivation affected them. Rajasthan (2023) and Karnataka (2025) have passed gig-worker laws, but the only complete record of what the work pays sits with the platforms, and a worker who complains under their own name risks the ID that is their income.

## What it does

| Page | What happens | Arkiv features used |
| --- | --- | --- |
| **Earnings** | Filter by city, kind of work, app, vehicle and month; take-home per hour per app · work · city, with independent-worker counts; live feed | typed attribute queries, `period` range queries, cursor paging, WebSocket entity events batched into one `$key` query |
| **Compare** | "Which app pays best for my work in my city?" Confirmed figures (≥ 2 independent *trusted* workers) rank first, with month-on-month change and incidents beside pay; share to WhatsApp | distinct `$creator` counting against a trust list |
| **Log my day** | One day's earnings (or a week by CSV): exact ₹ and hours become a band and a rounded rate, or are encrypted in the browser. Incident reports default to a fresh one-time wallet | `createEntity`, `executeBatch`, `readonly` flag, user-chosen expiry |
| **Incidents** | ID blocks, pay cuts, penalties: how often, days without work, whether a reason was given, how many got sorted out | `type` filter, `key`-typed `parent` for updates and "same here" reports |
| **Entry page** | Creator, owner, flags, expiry; keep alive, delete, unlock sealed details, post an update; share to WhatsApp | `getEntity`, `extendEntity` (`permissionlessExtension`), `deleteEntity`, `parent = key(…)` |
| **Trust lists** | Unions or riders' groups vouch for worker wallets; every page can filter by a list | `$creator` `OR` filter, owner-only `patchEntity` (`set` mutations) |
| **My data** | Everything this browser published, including one-time wallets; key backup | `$creator = addr(…)` `OR` over both entry kinds |
| **Proof** | Every Arkiv feature the app claims, as a recorded Tiramisu transaction, with a button that re-checks it against the chain | `getEntity`, creation flags, `$owner` |

Every list shows the **exact Arkiv query** it ran, plus the equivalent CLI command. The UI is in English and Hindi (toggle in the header; shared links carry the sender's language).

## Repository layout

```
ledger/          @nexora/ledger: the MIT data contract (schema, codec, sealing, queries, insights) + CLI
  src/           reusable library: what the web app, CLI and scripts all use
  cli.ts         read the ledger without any Nexora server
  test/          contract tests + every write shape run through the real SDK up to signing
web/             static React app (Vite); reads Arkiv directly from the browser
api/             optional Vercel functions, the only server code: sponsor.ts (gas for new wallets)
                 and read.ts (cached arkiv_query fallback, used only after the public RPC rate-limits a visitor)
scripts/         wallets, demo seed (records every feature on chain), end-to-end check, secret check
examples/        read-without-nexora.mjs: the dataset with only the official SDK
arkiv/           schema.md, friction.md, evidence.json, e2e-report.md
docs/            SUBMISSION.md (per-track answers), THREAT_MODEL.md
```

## Run it

Requires Node.js 20+.

```bash
npm install
npm test                       # contract, SDK-encoding, API and translation tests
npm run test:ui                # 14 UI checks in headless Chrome against the production build
npm run typecheck
npm run dev                    # http://localhost:5173

# read the public ledger from the command line, no wallet or server needed
npx tsx ledger/cli.ts earnings --demo --city bengaluru
npx tsx ledger/cli.ts compare --demo --city delhi_ncr --work cab
npx tsx ledger/cli.ts incidents --demo
npx tsx ledger/cli.ts lists
npx tsx ledger/cli.ts show <entityKey>
npx tsx ledger/cli.ts watch    # live feed over WebSocket
npx tsx ledger/cli.ts verify   # re-check every recorded feature in arkiv/evidence.json against the chain
node examples/read-without-nexora.mjs delhi_ncr
# any CLI command accepts --rpc <url>; ARKIV_RPC_URL sets a keyed RPC for CLI and scripts
```

The public Tiramisu RPC has a small anonymous query budget per IP. When it runs out, every command says so within seconds (see friction F6); use an [Arkiv Hub access key](https://docs.arkiv.network/start-here/access-keys/) via `ARKIV_RPC_URL`.

### Maintainers: demo data and live checks

```bash
npm run wallets                # creates test keys in .env.local (gitignored), prints addresses
# fund the sponsor wallet at https://hub.arkiv.network/faucet
npm run wallets -- --fund      # sponsor → seed wallets
npm run seed                   # dataset + one transaction per claimed feature → arkiv/evidence.json
npm run e2e                    # gas, latency, OR-query, extend, readonly, delete → arkiv/e2e-report.md
npm run check:secrets          # also runs as a pre-commit hook: git config core.hooksPath .githooks
```

### Deploy

Import the repository in Vercel and keep **Root Directory = repository root**. [`vercel.json`](vercel.json) installs the workspaces (`npm ci`), builds `web`, serves `web/dist`, and exposes the two functions in [`api/`](api). Set `NEXORA_SPONSOR_KEY` (and optionally `ARKIV_RPC_URL` with a Hub key) as secrets if you want the gas sponsor; without it, visitors fund their own wallet from the faucet. The `web/dist/` folder also works on any static host or IPFS gateway.

**Portable single file:** `npm run build:portable -w web` writes `web/dist-portable/nexora.html`, the whole app in one file (JS and CSS inlined; CI attaches it to every run). It opens from disk, an email attachment or a WhatsApp/Telegram file share, and reads Arkiv directly. If every website hosting Nexora disappeared, this file would still work.

## Judge reproduction

1. Open the live app. No signup is needed. Earnings shows synthetic demo data (labelled).
2. Open *Exact Arkiv query* under any list and run the printed CLI command from a fresh clone. You get the same entities, straight from Tiramisu.
3. *Log my day* → *Use test wallet* → fill in the form → *Publish to Arkiv*. The public column of the privacy preview shows what goes on chain, and the exact rupees never appear in it. You get an entity key and a transaction link on the Tiramisu explorer.
4. Open the entry: the creator is your test wallet, and the flags show read-only with community extension. Click *Keep alive +30 days* to send an `extendEntity` transaction.
5. In *Compare* (Bengaluru, bike taxi) with **All workers**, the spammer's ₹400/hour days are counted but marked unconfirmed: confirmation only counts workers on the recommended trust list. Switch to that list and those entries disappear entirely.
6. Open *Incidents*, then an ID-block report with an update: the update is a separate read-only entity linked with `parent = key(…)`.
7. Open the sealed demo day (its key is in `arkiv/evidence.json` under `sealed_payload`) and unlock it with the public demo passphrase `nexora-demo-2026`. On the explorer, the payload is only ciphertext.
8. Open *Proof*: each claimed feature (batches, incident follow-ups, sealed payload, trust-list patch, non-owner extension, refused readonly patch, owner delete) links to its transaction, and *verify on chain* re-reads it.
9. Download `nexora.html` from the latest CI run's artifacts, double-click it, and the same data loads with no website involved.

## Safety

Testnet only. Demo data is synthetic, calibrated to ranges in public surveys, and built with no difference between platforms, so it says nothing about any real company. No personal data, keys or secrets are stored on Arkiv. Self-reported entries are claims signed by a wallet, not verified payslips. The UI says so, and trust lists exist because of it.

## License

[MIT](LICENSE)
