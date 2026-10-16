"""Checks the Nexora Ledger v1 conformance vectors against the published JSON Schemas, in Python.

Nothing from this repository's JavaScript is used: only the schema files, the vectors file and the
`jsonschema` package. It is the same check any implementation, in any language, can run to see
that it accepts and rejects exactly what the contract says.

    pip install "jsonschema>=4.18"
    python examples/check_vectors.py
"""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent.parent
SCHEMAS = ROOT / "arkiv" / "schema"
VECTORS = ROOT / "arkiv" / "vectors" / "vectors.json"


def main() -> int:
    validators = {}
    for kind in ("shift", "incident", "reply", "trust_list"):
        schema = json.loads((SCHEMAS / f"{kind.replace('_', '-')}.schema.json").read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
        validators[kind] = Draft202012Validator(schema)

    vectors = json.loads(VECTORS.read_text(encoding="utf-8"))["vectors"]
    failures = 0
    for vector in vectors:
        errors = list(validators[vector["kind"]].iter_errors(vector["entity"]))
        accepted = not errors
        # An invalid vector must also be rejected for its stated reason: a problem under its path.
        paths = ["/" + "/".join(str(p) for p in e.absolute_path) for e in errors]
        right_reason = vector["valid"] or any(p == vector["at"] or p.startswith(vector["at"] + "/") for p in paths)
        if accepted == vector["valid"] and right_reason:
            verdict = "accepted" if accepted else f"rejected ({errors[0].message[:70]})"
            print(f"PASS {vector['id']}: {verdict}")
        else:
            failures += 1
            got = "valid" if accepted else f"invalid at {', '.join(paths)}"
            print(f"FAIL {vector['id']}: expected {'valid' if vector['valid'] else 'invalid at ' + vector['at']}, got {got}")
    print(f"\n{len(vectors) - failures} of {len(vectors)} vectors give the verdict the contract states")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
