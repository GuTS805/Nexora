# Changelog

All notable changes to `nexora-ledger`. Versions follow [semantic versioning](https://semver.org); while the major version is 0, a minor version may add to the API but never changes the meaning of data already on Arkiv. The data contract has its own version (`v = 1` on every entity, see [`arkiv/schema.md`](../arkiv/schema.md)), which no release so far has changed.

## 0.6.0 (2026-10-16)

### Added
- **Conformance vectors** (`nexora-ledger/vectors.json`, also [`arkiv/vectors/`](../arkiv/vectors)): 22 entities that a Nexora Ledger v1 implementation must accept or reject, each with the reason and, for rejections, the JSON Pointer where a validator must report the problem. Generated from the codec, so they cannot drift from what Nexora writes.
- `validateWire(kind, wire)` in `nexora-ledger/contract`: the schema check for an entity already in wire shape.

### Changed
- Readers (`decodeShift`, `decodeIncident`, `decodeReply`) leave out entries not created `readonly`, which their writer could still rewrite, and payloads that are not `application/json`, as reader rule 1 of the contract requires. Writing the vectors showed they had accepted both. Nothing Nexora wrote is affected: every entry it writes is readonly JSON.

### Repository
- `examples/check_vectors.py` checks the vectors in Python with only the schema files and `jsonschema`, and `examples/nexora_reader.py` reads the ledger from Arkiv with the Python standard library alone. CI runs the Python vector check on every push.

## 0.5.0 (2026-10-16)

### Added
- Authorship proofs: `authorshipMessage`, `formatProof`, `parseProof`, `verifyAuthorship`. The author of any entity can prove it to one person off chain, checked against the entity's `$creator`, with a checker-chosen challenge against replay.
- `nexora proof <file | -> [--challenge <text>]` checks such a proof against the chain.
- `padPlaintext` and `SEAL_PAD_BUCKETS`.

### Changed
- `seal` pads plaintext to 256, 1,024 or 4,096 bytes before encrypting, so a box's length no longer reveals how long its note is. Boxes sealed by earlier versions still open, and earlier versions open padded boxes.

## 0.4.0 (2026-10-15)

### Added
- `leaseRenewal(expiresAt, block, days)` for any entity used as a lease; `trustRenewal` is now built on it.
- The data contract written as "Nexora Ledger v1": MUST/SHOULD rules for writers and readers, and a versioning policy.

## 0.3.0 (2026-10-15)

### Added
- Reads as of a past moment: `entityAtBlock`, `blockAtDate`, `memberChanges`, `entityKeyPredicate`. A deleted or expired entity stays readable at earlier blocks.
- `nexora at <key> --block <n> | --date <d>`.
- Day-length filter (`hours_band` range) and `--day`, `--min-cost` on the CLI.
- Replies to reports (`replyCreate`, `decodeReply`, `repliesTo`, `resolvedReports`): where a union or group says a report stands, never changing it, with their own JSON Schema.
- `createLocked`, `isLocked`, `NOBODY`: create an entity and hand it to `0x…dEaD` in one batch, so nobody can delete it early.
- `trustRenewal`: trust lists as a 180-day lease only the curator can renew.

## 0.2.0 (2026-10-15)

First public release.

### Added
- The codec for earnings days, incident reports and trust lists, with banding and rounding, AES-256-GCM sealing and strict decoding.
- JSON Schemas for earnings days, incidents and trust lists (`nexora-ledger/schema/*.json`) and `validateEntity` in `nexora-ledger/contract`.
- `nexora audit`, which holds every Nexora entity on chain to the schemas and scans clear text for personal data.
- The `nexora` CLI: `earnings`, `compare`, `incidents`, `show`, `lists`, `watch`, `verify`.
- A fail-fast read transport and a cached read fallback for the public RPC's rate limit.
