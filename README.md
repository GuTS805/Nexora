# Nexora Ledger

**What actually worked for sellers like you.** Nexora is an open ledger of ad experiments run by Indian small sellers: which platform, format, language, region and festival, and roughly what return. It is stored on [Arkiv](https://arkiv.network). Anyone can read it, nobody can quietly rewrite it, and there is no company database to shut down.

- **Live app:** _add deployment URL_
- **Demo video (≤ 3 min):** _add link_
- **Data contract:** [`arkiv/schema.md`](arkiv/schema.md)
- **Friction report:** [`arkiv/friction.md`](arkiv/friction.md)
- **Per-track write-up:** [`docs/SUBMISSION.md`](docs/SUBMISSION.md)
- **Threat model:** [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
- **On-chain evidence:** [`arkiv/evidence.json`](arkiv/evidence.json) (every feature, with tx hashes) and [`arkiv/e2e-report.md`](arkiv/e2e-report.md)

Built for the Arkiv Global Tour Stop (pre-Devcon 8), 9–18 October 2026. Tracks: Best Indian Use Case, Censorship Resistance, Open Source, Privacy, Security.

## What it does

| Page | What happens | Arkiv features used |
| --- | --- | --- |
| **Explore** | Filter by category, platform, region tier, language and festival; leaderboard; live feed | typed attribute queries, cursor paging, WebSocket entity events batched into one `$key` query |
| **What to try** | Advice from combos that at least two independent *trusted* sellers confirmed, each linked to its evidence; share to WhatsApp | range queries on `spend_band`, distinct `$creator` counting against a trust list |
| **Log a result** | Publish one result, or import a CSV in batches; exact ₹ banded, or encrypted in the browser; optional one-time wallet | `createEntity`, `executeBatch`, `readonly` flag, user-chosen expiry |
| **Result page** | Creator, owner, flags, expiry; keep alive, delete, unlock sealed figures, see variants; share to WhatsApp | `getEntity`, `extendEntity` (`permissionlessExtension`), `deleteEntity`, `key`-typed `parent` |
| **Trust lists** | Communities vouch for publisher wallets; every page can filter by a list | `$creator` `OR` filter, owner-only `patchEntity` (`set` mutations) |
| **My data** | Everything this browser published, including one-time wallets; key backup | `$creator = addr(…)` `OR` |
| **Proof** | Every Arkiv feature the app claims, as a recorded Tiramisu transaction, with a button that re-checks it against the chain | `getEntity`, creation flags, `$owner` |

Every list shows the **exact Arkiv query** it ran, plus the equivalent CLI command. The UI is in English and Hindi (toggle in the header; shared links carry the sender's language).

## Repository layout

```
ledger/          @nexora/ledger: the MIT data contract (schema, codec, sealing, queries, insights) + CLI
  src/           reusable library: what the web app, CLI and scripts all use
  cli.ts         read the ledger without any Nexora server
  test/          contract tests + every write shape run through the real SDK up to signing
web/             static React app (Vite); reads Arkiv directly from the browser
api/sponsor.ts   optional gas sponsor (Vercel function): the only server code
scripts/         wallets, demo seed (records every feature on chain), end-to-end check, secret check
examples/        read-without-nexora.mjs: the dataset with only the official SDK
arkiv/           schema.md, friction.md, evidence.json, e2e-report.md
docs/            SUBMISSION.md (per-track answers), THREAT_MODEL.md
```

## Run it

Requires Node.js 20+.

```bash
npm install
npm test                       # contract, SDK-encoding and translation tests
npm run test:ui                # 11 UI checks in headless Chrome against the production build
npm run typecheck
npm run dev                    # http://localhost:5173

# read the public ledger from the command line, no wallet or server needed
npx tsx ledger/cli.ts query --demo --category tea_coffee
npx tsx ledger/cli.ts recommend --demo --category tea_coffee --tier tier2
npx tsx ledger/cli.ts lists
npx tsx ledger/cli.ts show <entityKey>
npx tsx ledger/cli.ts watch    # live feed over WebSocket
npx tsx ledger/cli.ts verify   # re-check every recorded feature in arkiv/evidence.json against the chain
node examples/read-without-nexora.mjs sarees_textiles
# any CLI command accepts --rpc <url>; ARKIV_RPC_URL sets a keyed RPC for CLI and scripts
```

The public Tiramisu RPC has a small anonymous query budget per IP. When it runs out, every command says so within seconds (see friction F9); use an [Arkiv Hub access key](https://docs.arkiv.network/start-here/access-keys/) via `ARKIV_RPC_URL`.

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

Import the repository in Vercel and keep **Root Directory = repository root**. [`vercel.json`](vercel.json) installs the workspaces (`npm ci`), builds `web`, serves `web/dist`, and exposes the sponsor from [`api/sponsor.ts`](api/sponsor.ts). Set `NEXORA_SPONSOR_KEY` (and optionally `ARKIV_RPC_URL` with a Hub key) as secrets if you want the gas sponsor; without it, visitors fund their own wallet from the faucet. The `web/dist/` folder also works on any static host or IPFS gateway.

**Portable single file:** `npm run build:portable -w web` writes `web/dist-portable/nexora.html`, the whole app in one file (JS and CSS inlined; CI attaches it to every run). It opens from disk, an email attachment or a WhatsApp/Telegram file share, and reads Arkiv directly. If every website hosting Nexora disappeared, this file would still work.

## Judge reproduction

1. Open the live app. No signup is needed. Explore shows synthetic demo data (labelled).
2. Open *Exact Arkiv query* under any list and run the printed CLI command from a fresh clone. You get the same entities, straight from Tiramisu.
3. *Log a result* → *Use test wallet* → fill in the form → *Publish to Arkiv*. You get an entity key and a transaction link on the Tiramisu explorer.
4. Open the result: the creator is your test wallet, and the flags show read-only with community extension. Click *Keep alive +30 days* to send an `extendEntity` transaction.
5. In *What to try* with **All sellers**, the spammer's ShareChat rows are counted but never suggested: proof only counts sellers on the recommended trust list. Switch to that list and the rows disappear entirely.
6. Open the sealed demo row (its key is in `arkiv/evidence.json` under `sealed_payload`) and unlock it with the public demo passphrase `nexora-demo-2026`. On the explorer, the payload is only ciphertext.
7. Open *Proof*: each claimed feature (batch, lineage, sealed payload, trust-list patch, non-owner extension, refused readonly patch, owner delete) links to its transaction, and *verify on chain* re-reads it.
8. Download `nexora.html` from the latest CI run's artifacts, double-click it, and the same data loads with no website involved.

## Safety

Testnet only. Demo data is synthetic. No personal data, keys or secrets are stored on Arkiv. Self-reported results are claims signed by a wallet, not verified sales. The UI says so, and trust lists exist because of it.

## License

[MIT](LICENSE)
