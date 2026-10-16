import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateWire } from "../src/contract.ts";
import { decodeEntry, decodeReply, decodeTrustList, type RawEntity } from "../src/index.ts";
import { buildVectors, vectorsFileText, type Vector } from "../vectors.ts";

const vectors = buildVectors();

/** A vector as a reader would get it from Arkiv. */
function asRead(vector: Vector): RawEntity {
  return {
    key: `0x${"ab".repeat(32)}`, creator: "0x1111111111111111111111111111111111111111", owner: "0x1111111111111111111111111111111111111111",
    expiresAt: 1_000_000n, creationFlags: vector.entity.flags, contentType: vector.entity.contentType,
    payload: new TextEncoder().encode(JSON.stringify(vector.entity.payload)), attributes: vector.entity.attributes as RawEntity["attributes"],
  };
}

const decoders = { shift: decodeEntry, incident: decodeEntry, reply: decodeReply, trust_list: decodeTrustList } as const;

describe("conformance vectors", () => {
  it("committed copy in arkiv/vectors matches the code (run `npm run vectors -w nexora-ledger` after changing the contract)", () => {
    const committed = readFileSync(new URL("../../arkiv/vectors/vectors.json", import.meta.url), "utf8");
    expect(committed.replace(/\r\n/g, "\n")).toBe(vectorsFileText());
  });

  it("cover every kind, both ways, with unique ids", () => {
    expect(new Set(vectors.map((v) => v.id)).size).toBe(vectors.length);
    for (const kind of ["shift", "incident", "reply", "trust_list"] as const) {
      expect(vectors.some((v) => v.kind === kind && v.valid)).toBe(true);
      expect(vectors.some((v) => v.kind === kind && !v.valid)).toBe(true);
    }
  });

  it.each(vectors.map((v) => [v.id, v] as const))("%s: the JSON Schema gives the stated verdict", (_, vector) => {
    const problems = validateWire(vector.kind, vector.entity);
    if (vector.valid) expect(problems).toEqual([]);
    // Rejected, and for the stated reason: some problem is reported under the vector's path.
    else expect(problems.some((p) => p.startsWith(`${vector.at} `) || p.startsWith(`${vector.at}/`)), problems.join("; ")).toBe(true);
  });

  it("readers accept every valid vector, and reject every invalid one except unknown fields they are allowed to ignore", () => {
    // Readers may ignore attributes and payload fields they do not know (schema.md, reader rule 1);
    // `nexora audit` reports those entities as violations instead.
    const tolerated = new Set(["shift-exact-hours-attribute", "shift-name-attribute", "shift-exact-rupees-in-payload"]);
    for (const vector of vectors) expect(decoders[vector.kind](asRead(vector)).ok, vector.id).toBe(vector.valid || tolerated.has(vector.id));
  });
});
