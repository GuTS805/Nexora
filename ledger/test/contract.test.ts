import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  JSON_SCHEMAS, auditEntities, findPersonalData, schemaFileName, schemaFileText, toWire, validateEntity, type ContractKind,
} from "../src/contract.ts";
import { incidentCreate, replyCreate, seal, shiftCreate, trustListCreate, type RawEntity } from "../src/index.ts";
import { ALICE, BOB, incident, keyOf, shift } from "./fixtures.ts";

const list = { name: "Bengaluru riders union", scope: "food_delivery" as const, description: "Members we have met.", members: [ALICE, BOB] };

type Params = ReturnType<typeof shiftCreate>;

/** What the node hands back for an entity created with `params`, including the SDK's raw flag bits. */
function stored(params: Params, creator = ALICE, i = 1): RawEntity {
  const flags = params.flags as { readonly: boolean; permissionlessExtension: boolean };
  return {
    key: keyOf(i), creator, owner: creator, expiresAt: 1_000_000n, createdAt: 10n,
    creationFlags: { ...flags, raw: 3 } as RawEntity["creationFlags"],
    contentType: params.contentType, payload: params.payload,
    attributes: params.attributes as RawEntity["attributes"],
  };
}

/** A copy of `params` with the attributes or payload changed by hand, as a non-Nexora writer could. */
function tampered(params: Params, change: { attributes?: Record<string, unknown>; payload?: Record<string, unknown>; flags?: object }): Params {
  const payload = { ...JSON.parse(new TextDecoder().decode(params.payload)), ...change.payload };
  return {
    ...params,
    attributes: { ...(params.attributes as object), ...change.attributes } as Params["attributes"],
    payload: new TextEncoder().encode(JSON.stringify(payload)),
    flags: { ...params.flags, ...change.flags },
  };
}

describe("JSON Schemas", () => {
  it("are valid JSON Schema 2020-12 documents", () => {
    const ajv = new Ajv2020({ strict: true });
    for (const schema of Object.values(JSON_SCHEMAS)) expect(ajv.validateSchema(schema), JSON.stringify(ajv.errors)).toBe(true);
  });

  it("committed copies in arkiv/schema match the code (run `npm run schemas -w nexora-ledger` after changing schema.ts)", () => {
    for (const kind of Object.keys(JSON_SCHEMAS) as ContractKind[]) {
      const committed = readFileSync(new URL(`../../arkiv/schema/${schemaFileName(kind)}`, import.meta.url), "utf8");
      expect(committed.replace(/\r\n/g, "\n")).toBe(schemaFileText(kind));
    }
  });

  it("accept every shape the codec writes, before sending and as read back", async () => {
    const sealed = await seal({ grossInr: 1_180, costsInr: 240, hours: 10, note: "rain" }, "correct horse battery");
    const writes: [ContractKind, Params][] = [
      ["shift", shiftCreate(shift)],
      ["shift", shiftCreate({ ...shift, sealed, demo: true })],
      ["incident", incidentCreate(incident)],
      ["incident", incidentCreate({ ...incident, parent: keyOf(9), sealed })],
      ["reply", replyCreate({ parent: keyOf(9), status: "taken_up", period: 202610, expiresInDays: 90 })],
      ["trust_list", trustListCreate(list)],
    ];
    for (const [kind, params] of writes) {
      expect(validateEntity(kind, params)).toEqual([]);
      expect(validateEntity(kind, stored(params))).toEqual([]);
    }
  });

  it("reject an extra attribute, which is how a name or phone number would leak", () => {
    const errors = validateEntity("shift", tampered(shiftCreate(shift), { attributes: { rider: { type: "str", value: "Ramesh" } } }));
    expect(errors.join()).toMatch(/additional properties \(rider\)/);
  });

  it("reject exact rupees or hours in the public payload", () => {
    const errors = validateEntity("shift", tampered(shiftCreate(shift), { payload: { grossInr: 1_180, hours: 10 } }));
    expect(errors.join()).toMatch(/grossInr/);
    expect(errors.join()).toMatch(/hours/);
  });

  it("reject off-grid figures, impossible months, wrong attribute types and editable entries", () => {
    const base = shiftCreate(shift);
    expect(validateEntity("shift", tampered(base, { attributes: { net_hourly: { type: "i32", value: 94 } } })).join()).toMatch(/multiple of 10/);
    expect(validateEntity("shift", tampered(base, { attributes: { period: { type: "i32", value: 202613 } } })).join()).toMatch(/period/);
    expect(validateEntity("shift", tampered(base, { attributes: { period: { type: "str", value: "202610" } } })).join()).toMatch(/period\/type/);
    expect(validateEntity("shift", tampered(base, { flags: { readonly: false } })).join()).toMatch(/flags\/readonly/);
    expect(validateEntity("incident", tampered(incidentCreate(incident), { attributes: { days_lost: { type: "i32", value: 400 } } })).join()).toMatch(/days_lost/);
  });

  it("reject a malformed sealed box", async () => {
    const sealed = await seal({ note: "x" }, "correct horse battery");
    const errors = validateEntity("shift", tampered(shiftCreate(shift), { payload: { sealed: { ...sealed, iv: "short" } } }));
    expect(errors.join()).toMatch(/sealed\/iv/);
  });

  it("toWire keeps only the documented flags and decodes the payload", () => {
    const wire = toWire(stored(shiftCreate(shift)));
    expect(wire.flags).toEqual({ readonly: true, permissionlessExtension: true });
    expect(wire.payload).toEqual({ v: 1, incentive: "met" });
    expect(toWire({ payload: new TextEncoder().encode("{oops") }).payload).toBe("(not JSON)");
  });
});

describe("personal-data scan", () => {
  const withText = (description: string, name = list.name) => stored(trustListCreate({ ...list, name, description }));

  it("finds phone numbers, email addresses and 12-digit ID numbers in clear text", () => {
    expect(findPersonalData(withText("call 9876543210"))).toHaveLength(1);
    expect(findPersonalData(withText("whatsapp +91 9876543210"))[0]).toMatch(/phone/);
    expect(findPersonalData(withText("mail ravi@example.com"))[0]).toMatch(/email/);
    expect(findPersonalData(withText("aadhaar 1234 5678 9012"))[0]).toMatch(/12-digit/);
  });

  it("ignores addresses, keys, ordinary numbers and sealed ciphertext", async () => {
    expect(findPersonalData(withText("Founded 2019, 120 members, ₹500 dues"))).toEqual([]);
    const sealed = await seal({ note: "my number is 9876543210" }, "correct horse battery");
    expect(findPersonalData(stored(shiftCreate({ ...shift, sealed })))).toEqual([]);
    expect(findPersonalData(stored(incidentCreate({ ...incident, parent: keyOf(77) })))).toEqual([]);
  });
});

describe("privacy audit", () => {
  it("passes clean data and reports what it counted", () => {
    const report = auditEntities([
      stored(shiftCreate(shift), ALICE, 1),
      stored(incidentCreate(incident), BOB, 2),
      stored(trustListCreate(list), ALICE, 3),
      stored(replyCreate({ parent: keyOf(2), status: "received", period: 202610, expiresInDays: 30 }), ALICE, 4),
    ]);
    expect(report).toMatchObject({ checked: 4, shown: { shift: 1, incident: 1, reply: 1, trust_list: 1 }, rejected: [], violations: [], passed: true });
  });

  it("does not judge what readers never show, but fails on a shown entry that breaks the contract", () => {
    const junk: RawEntity = { key: keyOf(4), creator: BOB, owner: BOB, expiresAt: 1n, attributes: { app: { type: "str", value: "nexora" }, kind: { type: "str", value: "shift" } } };
    const leaky = stored(tampered(shiftCreate(shift), { attributes: { phone: { type: "str", value: "9876543210" } } }), BOB, 5);
    const report = auditEntities([stored(shiftCreate(shift)), junk, leaky]);
    expect(report.rejected).toHaveLength(1);
    expect(report.shown.shift).toBe(2);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.problems.join()).toMatch(/additional properties \(phone\)/);
    expect(report.violations[0]?.problems.join()).toMatch(/phone number/);
    expect(report.passed).toBe(false);
  });

  it("counts incident wallets that also wrote earnings, separately for workers and demo data", () => {
    const report = auditEntities([
      stored(shiftCreate(shift), ALICE, 1),
      stored(incidentCreate(incident), ALICE, 2),
      stored(incidentCreate(incident), BOB, 3),
      stored(shiftCreate({ ...shift, demo: true }), BOB, 4),
      stored(incidentCreate({ ...incident, demo: true }), BOB, 5),
    ]);
    expect(report.linkability.real).toEqual({ incidentWallets: 2, alsoWroteEarnings: [ALICE.toLowerCase()] });
    expect(report.linkability.demo).toEqual({ incidentWallets: 1, alsoWroteEarnings: [BOB.toLowerCase()] });
  });
});
