# Conformance vectors for Nexora Ledger v1

[`vectors.json`](vectors.json) lists entities that an implementation of the [contract](../schema.md) must accept, and entities it must reject. Use it to check a writer or a reader in any language, against the JSON Schemas in [`../schema/`](../schema), without running any of Nexora's code.

Each vector has:

| Field | Meaning |
| --- | --- |
| `id` | A stable name, such as `shift-name-attribute`. |
| `kind` | `shift`, `incident`, `reply` or `trust_list`; the schema is `../schema/<kind with - for _>.schema.json`. |
| `valid` | `true` if the entity follows the contract, `false` if it must be rejected. |
| `description` | What the entity is, or what is wrong with it. |
| `at` | For an invalid vector: the JSON Pointer under which a validator must report a problem, so it is rejected for the stated reason and not by accident. |
| `entity` | The entity in the shape the schemas check: `contentType`, creation `flags`, typed `attributes` (`{ "type", "value" }`, as the SDK reads them) and the decoded JSON `payload`. |

The valid vectors are produced by the codec Nexora writes with ([`ledger/vectors.ts`](../../ledger/vectors.ts)). The invalid ones are the same entities changed the way a careless or hostile writer could: an exact figure, a name, an off-vocabulary value, an editable entity, a future contract version.

## Checking an implementation

Python, with only the schema files and the `jsonschema` package:

```bash
pip install "jsonschema>=4.18"
python examples/check_vectors.py      # 22 of 22 vectors give the verdict the contract states
```

JavaScript, from the npm package:

```js
import { validateWire } from "nexora-ledger/contract";
import data from "nexora-ledger/vectors.json" with { type: "json" };
for (const v of data.vectors) console.log(v.id, validateWire(v.kind, v.entity).length === 0 === v.valid ? "ok" : "MISMATCH");
```

Any other language: load each schema with a JSON Schema 2020-12 validator and run every vector through the schema for its `kind`. A conforming validator accepts exactly the vectors marked `valid` and, for the rest, reports at least one error at or under `at`.

## Readers

The schemas are what writers must produce. A reader must accept every `valid` vector and leave out every invalid one, except that it may ignore attributes and payload fields it does not know: Nexora's readers show `shift-exact-hours-attribute`, `shift-name-attribute` and `shift-exact-rupees-in-payload` with those fields dropped, and `nexora audit` reports all three as violations. The tests hold Nexora's readers to exactly this.

## Keeping them current

`npm run vectors -w nexora-ledger` regenerates the file after a change to the contract, and the tests fail if the committed copy falls behind. CI checks the vectors in Python on every push.
