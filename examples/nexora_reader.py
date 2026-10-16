"""Reads Nexora's earnings ledger from Arkiv in plain Python: no Nexora code, no SDK, no server.

It speaks Arkiv's JSON-RPC (`arkiv_query`) with the standard library, checks every entity against the
published contract, counts distinct workers (wallets, not entries) and prints take-home per hour by
app. If Nexora's website, npm package and every line of its JavaScript disappeared, the data and this
reader would still work.

    python examples/nexora_reader.py --city bengaluru --demo
    python examples/nexora_reader.py --work bike_taxi --rpc https://<another Arkiv node>

The contract check uses the JSON Schemas in arkiv/schema/ through `jsonschema` when it is installed
(`pip install "jsonschema>=4.18"`), and otherwise falls back to checking every attribute against the
schemas' closed vocabularies, which is the part that keeps names and exact figures out.
"""

import argparse
import json
import os
import statistics
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

PUBLIC_RPC = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
SCHEMA = Path(__file__).resolve().parent.parent / "arkiv" / "schema" / "shift.schema.json"
SELECT = {"key": True, "creator": True, "creationFlags": True, "contentType": True, "payload": True, "attributes": True}


def arkiv_query(rpc: str, query: str, limit: int = 200, cursor: str | None = None) -> dict:
    options = {"limit": hex(limit), "select": SELECT, **({"cursor": cursor} if cursor else {})}
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "arkiv_query", "params": [query, options]}).encode()
    # Some gateways refuse Python's default User-Agent, so the reader names itself.
    request = urllib.request.Request(rpc, data=body, headers={"content-type": "application/json", "user-agent": "nexora-reader/1"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            reply = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:200]
        raise SystemExit(f"Arkiv node answered HTTP {error.code}: {detail} (the public node rate-limits anonymous reads; pass --rpc with your own key)")
    if "error" in reply:
        raise SystemExit(f"Arkiv refused the query: {reply['error']}")
    return reply["result"]


def to_wire(entity: dict) -> dict:
    """An entity as arkiv_query returns it, in the shape the JSON Schemas check."""
    flags = entity.get("creationFlags") or {}
    try:
        payload = json.loads(bytes.fromhex(entity.get("payload", "0x")[2:]).decode("utf-8"))
    except ValueError:
        payload = "(not JSON)"
    return {
        "contentType": entity.get("contentType"),
        "flags": {"readonly": bool(flags.get("readonly")), "permissionlessExtension": bool(flags.get("permissionlessExtension"))},
        "attributes": {a["name"]: {"type": a["type"], "value": a["value"]} for a in entity.get("attributes", [])},
        "payload": payload,
    }


def contract_check(schema: dict):
    """Returns a function giving the list of problems with one wire entity."""
    try:
        from jsonschema import Draft202012Validator

        validator = Draft202012Validator(schema)
        return lambda wire: [e.message for e in validator.iter_errors(wire)]
    except ImportError:
        allowed = schema["properties"]["attributes"]["properties"]

        def vocabulary_only(wire: dict) -> list[str]:
            problems = []
            for name, cell in wire["attributes"].items():
                rule = allowed.get(name)
                if rule is None:
                    problems.append(f"attribute {name} is not in the contract")
                    continue
                spec = rule["properties"]
                value = spec["value"]
                if cell["type"] != spec["type"]["const"]:
                    problems.append(f"{name} has type {cell['type']}")
                elif "const" in value and cell["value"] != value["const"]:
                    problems.append(f"{name} is {cell['value']!r}")
                elif "enum" in value and cell["value"] not in value["enum"]:
                    problems.append(f"{name} {cell['value']!r} is outside the vocabulary")
            if not wire["flags"]["readonly"]:
                problems.append("entity is not readonly")
            return problems

        return vocabulary_only


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--rpc", default=os.environ.get("ARKIV_RPC_URL", PUBLIC_RPC))
    parser.add_argument("--city")
    parser.add_argument("--work")
    parser.add_argument("--demo", action="store_true", help="include synthetic demo data")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # the ₹ sign, on consoles that default to another code page

    # The same predicate the web app and the CLI show, built from the documented attributes.
    parts = ["app = str('nexora')", "kind = str('shift')", "v = i32(1)"]
    if args.city:
        parts.append(f"city = str('{args.city}')")
    if args.work:
        parts.append(f"work = str('{args.work}')")
    if not args.demo:
        parts.append("demo = false")
    query = " AND ".join(parts)

    check = contract_check(json.loads(SCHEMA.read_text(encoding="utf-8")))
    rates: dict[str, list[int]] = defaultdict(list)
    workers: dict[str, set[str]] = defaultdict(set)
    accepted = rejected = 0
    cursor = None
    block = None
    for _ in range(3):  # up to 600 entities, like the CLI
        page = arkiv_query(args.rpc, query, cursor=cursor)
        block = block or int(page["blockNumber"], 16)
        for entity in page["data"]:
            wire = to_wire(entity)
            if check(wire):
                rejected += 1
                continue
            accepted += 1
            app = wire["attributes"]["platform"]["value"]
            rates[app].append(wire["attributes"]["net_hourly"]["value"])
            workers[app].add(entity["creator"].lower())
        cursor = page.get("cursor")
        if not cursor or not page["data"]:
            break

    print(f"query @ block {block}:\n  {query}\n")
    print(f"{'app':<12} {'median ₹/h':>10} {'days':>6} {'workers':>8}")
    for app in sorted(rates, key=lambda a: -statistics.median(rates[a])):
        print(f"{app:<12} {statistics.median(rates[app]):>10.0f} {len(rates[app]):>6} {len(workers[app]):>8}")
    print(f"\n{accepted} entities follow the contract, {rejected} rejected and left out")
    return 0


if __name__ == "__main__":
    sys.exit(main())
