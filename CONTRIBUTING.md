# Contributing to Nexora

Thanks for helping. Nexora is useful only if workers, unions and researchers can trust it, so changes are judged first on whether they keep the data honest and the workers private.

## Set up

Requires Node.js 20+.

```bash
git clone https://github.com/GuTS805/Nexora.git
cd Nexora
npm install
git config core.hooksPath .githooks   # pre-commit secret check
npm run dev                           # http://localhost:5173, reads live Tiramisu data
```

You do not need a wallet, a key or any Nexora server to work on reading, the UI or the CLI. To publish from the app, use its built-in test wallet; GLM comes from the [Arkiv faucet](https://hub.arkiv.network/faucet).

## Before you open a pull request

```bash
npm run typecheck
npm test              # ledger contract + web tests
npm run build
npm run test:ui       # headless Chrome; needs Chrome installed
npm run check:secrets
```

CI runs the same checks on every pull request, and also packs the npm package and installs it into a clean project.

Changed anything in [`ledger/src/schema.ts`](ledger/src/schema.ts)? Run `npm run schemas -w nexora-ledger` and `npm run vectors -w nexora-ledger`, and commit the regenerated [`arkiv/schema/*.schema.json`](arkiv/schema) and [`arkiv/vectors/vectors.json`](arkiv/vectors); a test fails until you do. Changed a dependency? Run `node scripts/notices.mjs` to refresh [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). A change to `nexora-ledger` gets a line in [`ledger/CHANGELOG.md`](ledger/CHANGELOG.md). To check live data against the contract yourself, run `npm run cli -- audit`.

Where things live in the library:

| Module | What it holds |
| --- | --- |
| [`schema.ts`](ledger/src/schema.ts) | The fixed lists (cities, platforms, work, vehicles, incident types) and banding |
| [`codec.ts`](ledger/src/codec.ts) | Building entities to write, and strict decoding of untrusted ones |
| [`contract.ts`](ledger/src/contract.ts) | JSON Schemas, `validateEntity` / `validateWire`, and the privacy audit |
| [`queries.ts`](ledger/src/queries.ts) | Typed filters, query predicates, paged reads, the fail-fast transport and read fallback |
| [`insights.ts`](ledger/src/insights.ts) | Medians, confirmation by distinct wallets, month-on-month change, incident counts |
| [`seal.ts`](ledger/src/seal.ts) | AES-256-GCM sealing with padding |
| [`history.ts`](ledger/src/history.ts), [`lease.ts`](ledger/src/lease.ts), [`lock.ts`](ledger/src/lock.ts), [`proof.ts`](ledger/src/proof.ts) | Past reads, leases, locked entries and authorship proofs, usable by any Arkiv app |

Tests live next to what they test: [`ledger/test`](ledger/test) has one file per module (`codec`, `contract`, `queries`, `insights`, `seal`, …) sharing [`fixtures.ts`](ledger/test/fixtures.ts), and [`web/api`](web/api) covers the server functions.

## Good first contributions

- **Your city, platform or kind of work.** Add it to the fixed lists in [`ledger/src/schema.ts`](ledger/src/schema.ts) (`CITIES`, `PLATFORMS`, `PLATFORM_WORK`, `WORK_TYPES`), give it English and Hindi names in [`web/src/i18n.tsx`](web/src/i18n.tsx) (`VOCAB`), and, for a platform, a mark in [`web/src/logos.tsx`](web/src/logos.tsx). Values on chain are lowercase snake_case and must never be renamed once published.
- **Another language.** The UI strings live in [`web/src/strings.ts`](web/src/strings.ts) as `[English, Hindi]` pairs. Tamil, Kannada, Telugu, Bengali and Marathi would reach many more workers.
- **Reports for unions.** Anything built only on [`arkiv/schema.md`](arkiv/schema.md), like [`examples/read-without-nexora.mjs`](examples/read-without-nexora.mjs), is welcome in `examples/`.
- **Incident types.** If workers face something the list in `INCIDENT_TYPES` does not cover, open an issue first so the name can be agreed.

## Rules that keep the data trustworthy

1. **No personal data on chain, ever.** No names, phone numbers, rider or partner IDs, vehicle numbers or addresses, and no exact rupees in readable form. Exact figures may only go in the sealed (encrypted) payload. A test in `ledger/test` should prove any new field cannot carry them.
2. **Fixed lists, not free text,** for anything that becomes an attribute. Free text cannot be compared and can leak identity.
3. **The data contract is versioned.** Entries carry `v = 1`. A change that breaks readers of [`arkiv/schema.md`](arkiv/schema.md) needs a new version and a note in that file; old entries must still decode.
4. **Confirmation counts wallets, not rows.** Do not add a figure that one wallet can move by publishing many times.
5. **Never name a real company in synthetic data as if it were a finding.** Demo data stays labelled `demo` and builds in no difference between platforms.
6. **No server-side database.** The browser reads Arkiv directly; server code stays optional (see [`api/`](api)).

## Reporting bugs and security issues

Bugs: open an issue with steps to reproduce. Security or privacy problems: see [SECURITY.md](SECURITY.md) and please do not open a public issue.

By contributing you agree that your work is released under the [MIT License](LICENSE) and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
