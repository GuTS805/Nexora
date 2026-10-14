# Security policy

Nexora handles reports from workers who can lose their income if they are identified, so privacy bugs count as security bugs.

## Reporting

Please report privately through [GitHub security advisories](https://github.com/GuTS805/Nexora/security/advisories/new). Do not open a public issue. Include what you found, how to reproduce it, and what an attacker could learn or do.

You can expect a reply within a week. Once a fix is out, the advisory is published with credit to you unless you prefer otherwise.

## In scope

- Anything that lets a reader link an entry to a person: a name, phone, ID or exact rupees reaching the chain in readable form, or a one-time incident wallet being linkable to the worker's main wallet.
- Weaknesses in the sealed payload (AES-256-GCM, PBKDF2) in [`ledger/src/seal.ts`](ledger/src/seal.ts).
- Ways to make figures look confirmed without independent trusted wallets.
- Leaks of keys or secrets from the app, the CLI or the optional functions in [`api/`](api).
- Abuse of the gas sponsor beyond the limits described in [`api/sponsor.ts`](api/sponsor.ts).

## Out of scope

- Arkiv itself or its public RPC limits; report those to the Arkiv team.
- That entries are self-reported claims. This is by design, and the app says so; see [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).
- Testnet GLM having no value.

Nexora runs on the Tiramisu testnet. Do not use real money or real personal data with it.
