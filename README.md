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
| **Explore** | Filter experiments by category, platform, tier, language and festival; see a leaderboard and a live feed | typed attribute queries, cursor paging, WebSocket entity events |
| **What to try** | Recommendations from combos at least two independent sellers confirmed, each linked to evidence | range queries on `spend_band`, distinct `$creator` counting |
| **Log a result** | Publish one experiment, or import a CSV in batches; exact ₹ banded or encrypted in the browser | `createEntity`, `executeBatch`, `readonly` flag, user-chosen expiry |
| **Experiment page** | Creator, owner, flags, expiry; keep alive, delete, unseal, see variants | `getEntity`, `extendEntity` (`permissionlessExtension`), `deleteEntity`, `key`-typed `parent` |
| **Trust lists** | Communities vouch for publisher wallets; every page can filter by a list | `$creator` `OR` filter, owner-only `patchEntity` |
| **My data** | Everything your wallet published | `$creator = addr(me)` |

Every list shows the **exact Arkiv query** it ran, plus the equivalent CLI command.

## Repository layout

```
ledger/          @nexora/ledger: the MIT data contract (schema, codec, sealing, queries, insights) + CLI
  src/           reusable library: what the web app, CLI and seed script all use
  cli.ts         read the ledger without any Nexora server
  test/          contract tests
web/             static React app (Vite); reads Arkiv directly from the browser
  api/sponsor.ts optional gas sponsor: the only server code
scripts/         wallet setup and the synthetic demo dataset
arkiv/           schema.md, friction.md
docs/            SUBMISSION.md (per-track answers, threat model, disclosure)
```

## Run it

Requires Node.js 20+.

```bash
npm install
npm test                       # data-contract tests
npm run dev                    # http://localhost:5173

# read the public ledger from the command line, no wallet or server needed
npx tsx ledger/cli.ts query --demo --category tea_coffee
npx tsx ledger/cli.ts recommend --demo --category tea_coffee --tier tier2
npx tsx ledger/cli.ts lists
npx tsx ledger/cli.ts show <entityKey>
npx tsx ledger/cli.ts watch    # live feed over WebSocket
# any command accepts --rpc <url> to use another Arkiv node
```

### Publishing the demo dataset (maintainers)

```bash
npm run wallets                # creates test keys in .env.local (gitignored), prints addresses
# fund the sponsor wallet address at https://hub.arkiv.network/faucet
npm run wallets -- --fund      # sponsor → seed wallets
npm run seed                   # ~110 synthetic experiments, variants, and a trust list
```

### Deploy

Vercel project rooted at `web/`, with build `npm run build` and output `dist`. Set `NEXORA_SPONSOR_KEY` as a secret if you want the gas sponsor; without it, visitors fund their own wallet from the faucet. The `dist/` folder also works on any static host or IPFS gateway.

**Portable single file:** `npm run build:portable -w web` writes `web/dist-portable/nexora.html`, the whole app in one file (JS and CSS inlined). It opens from disk, an email attachment or a WhatsApp/Telegram file share, and reads Arkiv directly. If every website hosting Nexora disappeared, this file would still work.

## Judge reproduction

1. Open the live app. No signup is needed. Explore shows synthetic demo data (labelled).
2. Open *Exact Arkiv query* under the list, then run the printed CLI command from a fresh clone. You get the same entities, straight from Tiramisu.
3. *Log a result* → *Use test wallet* → fill in the form → *Publish to Arkiv*. You get an entity key and a transaction link on the Tiramisu explorer.
4. Open the entity: the creator is your test wallet, and the flags show read-only with community extension. Click *Keep alive +30 days* to send an `extendEntity` transaction.
5. In *What to try*, choose **All publishers** and see the spammer's ShareChat combo marked "unconfirmed". Switch to the trust list **Nexora demo: honest seed sellers** and it is gone.
6. Publish with a passphrase, then open the entity and unlock the sealed figures. Inspect the payload on the explorer: only ciphertext.

## Safety

Testnet only. Demo data is synthetic. No personal data, keys or secrets are stored on Arkiv. Self-reported results are claims signed by a wallet, not verified sales. The UI says so, and trust lists exist because of it.

## License

[MIT](LICENSE)
