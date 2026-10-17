/**
 * The data contract as JSON Schema, plus a public privacy audit.
 *
 * `schema.md` explains the contract to people; the schemas here let a machine check it. They are
 * generated from the same constants the codec uses (`schema.ts`), so the two cannot drift, and the
 * committed copies in `arkiv/schema/*.schema.json` are compared against them in the tests.
 *
 * The schemas describe what Nexora writes, exactly: every attribute is listed and nothing else is
 * allowed. Readers are deliberately more forgiving (they ignore unknown attributes), so the audit
 * holds every entry readers accept to the strict schema. An extra attribute is how a name or phone
 * number would leak, so it counts as a violation.
 *
 * This module is a separate entry point (`nexora-ledger/contract`) so the web bundle never pulls in
 * the validator.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { decodeEntry, decodeReply, decodeTrustList, type RawEntity } from "./codec.ts";
import {
  APP, CITIES, COST_STEP, HOURS_BANDS, INCENTIVES, INCIDENT_TYPES, KIND, MAX_DAYS_LOST, MAX_NAME_LENGTH, MAX_TRUST_MEMBERS,
  NET_MAX, NET_MIN, NET_STEP, PERIOD_MAX, PERIOD_MIN, PLATFORMS, REPLY_STATUSES, SCHEMA_VERSION, VEHICLES, WORK_TYPES, isPeriod,
} from "./schema.ts";
import { SEAL_ALG, SEAL_KDF } from "./seal.ts";
import { GUIDE_SCOPES, GUIDE_TOPICS, decodeGuide } from "./guide.ts";

export const SCHEMA_BASE_URL = "https://raw.githubusercontent.com/GuTS805/Nexora/main/arkiv/schema/";

type JsonSchema = Record<string, unknown>;

const PERIODS: number[] = [];
for (let p = PERIOD_MIN; p <= PERIOD_MAX; p++) if (isPeriod(p)) PERIODS.push(p);

/** An Arkiv attribute as the SDK reads and writes it: `{ type, value }`. */
const attr = (type: "str" | "i32" | "bool" | "key", value: JsonSchema, description?: string): JsonSchema => ({
  type: "object",
  ...(description ? { description } : {}),
  additionalProperties: false,
  required: ["type", "value"],
  properties: { type: { const: type }, value },
});

const HEX32 = { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" };
const ADDRESS = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };

const SEALED_BOX: JsonSchema = {
  type: "object",
  description: "Exact figures or notes the worker chose to keep, AES-256-GCM encrypted on their device. Only someone with the passphrase can open it.",
  additionalProperties: false,
  required: ["alg", "kdf", "iter", "salt", "iv", "ct"],
  properties: {
    alg: { const: SEAL_ALG },
    kdf: { const: SEAL_KDF },
    iter: { type: "integer", minimum: 100_000, maximum: 5_000_000 },
    salt: { type: "string", description: "16 random bytes, base64.", pattern: "^[A-Za-z0-9+/]{22}==$" },
    iv: { type: "string", description: "12 random bytes, base64.", pattern: "^[A-Za-z0-9+/]{16}$" },
    ct: { type: "string", description: "Ciphertext and GCM tag, base64.", pattern: "^[A-Za-z0-9+/]+={0,2}$", maxLength: 7_999 },
  },
};

const GUIDE_TEXT = (maxLength: number): JsonSchema => ({ type: "string", minLength: 1, maxLength });
const GUIDE_LINK: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "url"],
  properties: { label: GUIDE_TEXT(140), url: { type: "string", maxLength: 300, pattern: "^https://[^\\s\"<>]+$" } },
};

const COMMON_ATTRIBUTES = {
  app: attr("str", { const: APP }),
  v: attr("i32", { const: SCHEMA_VERSION }),
  platform: attr("str", { enum: [...PLATFORMS] }),
  work: attr("str", { enum: [...WORK_TYPES] }),
  city: attr("str", { enum: [...CITIES] }),
  period: attr("i32", { enum: PERIODS }, "Month worked, YYYYMM."),
  demo: attr("bool", { type: "boolean" }, "True for synthetic demo data."),
};

/** Entries can never be edited, not even by their author; anyone may keep one alive longer. */
const ENTRY_FLAGS: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["readonly", "permissionlessExtension"],
  properties: { readonly: { const: true }, permissionlessExtension: { const: true } },
};

function entity(id: string, title: string, description: string, body: { flags: JsonSchema; attributes: JsonSchema; required: string[]; payload: JsonSchema }): JsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${SCHEMA_BASE_URL}${id}.schema.json`,
    title,
    description,
    type: "object",
    additionalProperties: false,
    required: ["contentType", "flags", "attributes", "payload"],
    properties: {
      contentType: { const: "application/json" },
      flags: body.flags,
      attributes: { type: "object", additionalProperties: false, required: body.required, properties: body.attributes },
      payload: body.payload,
    },
  };
}

export const JSON_SCHEMAS = {
  shift: entity(
    "shift",
    "Nexora earnings entry (v1)",
    "One day of gig work. Hours are a band and take-home per hour is rounded to ₹10; exact rupees and hours never appear, except inside an optional sealed box.",
    {
      flags: ENTRY_FLAGS,
      required: ["app", "v", "kind", "platform", "work", "city", "vehicle", "period", "hours_band", "net_hourly", "cost_pct", "demo"],
      attributes: {
        ...COMMON_ATTRIBUTES,
        kind: attr("str", { const: KIND.shift }),
        vehicle: attr("str", { enum: [...VEHICLES] }),
        hours_band: attr("i32", { type: "integer", minimum: 0, maximum: HOURS_BANDS.length }, "Index into the bands < 4 h, 4–8, 8–10, 10–12, 12–14, 14 h +."),
        net_hourly: attr("i32", { type: "integer", minimum: NET_MIN, maximum: NET_MAX, multipleOf: NET_STEP }, "Take-home per logged-in hour after costs, rounded to ₹10."),
        cost_pct: attr("i32", { type: "integer", minimum: 0, maximum: 100, multipleOf: COST_STEP }, "Costs as a share of the day's gross, rounded to 10 points."),
      },
      payload: {
        type: "object",
        additionalProperties: false,
        required: ["v", "incentive"],
        properties: { v: { const: SCHEMA_VERSION }, incentive: { enum: [...INCENTIVES] }, sealed: SEALED_BOX },
      },
    },
  ),
  incident: entity(
    "incident",
    "Nexora incident report (v1)",
    "Something that happened to a worker: an ID block, a pay cut, a penalty. Closed vocabulary only; any free text is sealed.",
    {
      flags: ENTRY_FLAGS,
      required: ["app", "v", "kind", "platform", "work", "city", "type", "period", "days_lost", "demo"],
      attributes: {
        ...COMMON_ATTRIBUTES,
        kind: attr("str", { const: KIND.incident }),
        type: attr("str", { enum: [...INCIDENT_TYPES] }),
        days_lost: attr("i32", { type: "integer", minimum: 0, maximum: MAX_DAYS_LOST }, "Days without work because of it."),
        parent: attr("key", HEX32, "The earlier report this one updates or seconds."),
      },
      payload: {
        type: "object",
        additionalProperties: false,
        required: ["v", "reasonGiven", "appealed", "resolved"],
        properties: {
          v: { const: SCHEMA_VERSION },
          reasonGiven: { type: "boolean" },
          appealed: { type: "boolean" },
          resolved: { type: "boolean" },
          sealed: SEALED_BOX,
        },
      },
    },
  ),
  reply: entity(
    "reply",
    "Nexora reply to a report (v1)",
    "Where a union, worker group or platform says a report stands. Points at the report through `parent`; never changes it. Closed vocabulary only.",
    {
      flags: ENTRY_FLAGS,
      required: ["app", "v", "kind", "parent", "status", "period", "demo"],
      attributes: {
        app: COMMON_ATTRIBUTES.app,
        v: COMMON_ATTRIBUTES.v,
        kind: attr("str", { const: KIND.reply }),
        parent: attr("key", HEX32, "The incident report this reply is about."),
        status: attr("str", { enum: [...REPLY_STATUSES] }),
        period: attr("i32", { enum: PERIODS }, "Month of the reply, YYYYMM."),
        demo: COMMON_ATTRIBUTES.demo,
      },
      payload: {
        type: "object",
        additionalProperties: false,
        required: ["v"],
        properties: { v: { const: SCHEMA_VERSION } },
      },
    },
  ),
  trust_list: entity(
    "trust-list",
    "Nexora trust list (v1)",
    "Wallets a union or group vouches for. Editable by its owner only; the curator chooses its public name and description.",
    {
      flags: {
        type: "object",
        additionalProperties: false,
        required: ["readonly", "permissionlessExtension"],
        properties: { readonly: { const: false }, permissionlessExtension: { const: false } },
      },
      required: ["app", "v", "kind", "name", "scope"],
      attributes: {
        app: COMMON_ATTRIBUTES.app,
        v: COMMON_ATTRIBUTES.v,
        kind: attr("str", { const: KIND.trustList }),
        name: attr("str", { type: "string", minLength: 3, maxLength: MAX_NAME_LENGTH }),
        scope: attr("str", { enum: [...WORK_TYPES, "all"] }),
      },
      payload: {
        type: "object",
        additionalProperties: false,
        required: ["v", "description", "members"],
        properties: {
          v: { const: SCHEMA_VERSION },
          description: { type: "string", maxLength: 280 },
          members: { type: "array", items: ADDRESS, minItems: 1, maxItems: MAX_TRUST_MEMBERS, uniqueItems: true },
        },
      },
    },
  ),
  guide: entity(
    "guide",
    "Nexora guide (v1)",
    "What the law gives gig workers, an independent rating of platforms, what an independent survey of workers found, or what a platform says it pays, with its sources. Editable by its curator; earlier wordings stay readable at past blocks.",
    {
      flags: {
        type: "object",
        additionalProperties: false,
        required: ["readonly", "permissionlessExtension"],
        properties: { readonly: { const: false }, permissionlessExtension: { const: false } },
      },
      required: ["app", "v", "kind", "scope", "topic"],
      attributes: {
        app: COMMON_ATTRIBUTES.app,
        v: COMMON_ATTRIBUTES.v,
        kind: attr("str", { const: KIND.guide }),
        scope: attr("str", { enum: [...GUIDE_SCOPES] }, "All of India, or a state with its own gig-worker law."),
        topic: attr("str", { enum: [...GUIDE_TOPICS] }, "A law, an independent rating of platforms, an independent survey of workers, or a platform's own claim about pay."),
      },
      payload: {
        type: "object",
        additionalProperties: false,
        required: ["v", "title", "status", "points", "sources", "checked"],
        properties: {
          v: { const: SCHEMA_VERSION },
          title: GUIDE_TEXT(160),
          status: GUIDE_TEXT(480),
          points: { type: "array", items: GUIDE_TEXT(480), minItems: 1, maxItems: 6 },
          sources: { type: "array", items: GUIDE_LINK, minItems: 1, maxItems: 4 },
          actions: { type: "array", items: GUIDE_LINK, maxItems: 3 },
          scores: {
            type: "object",
            description: "For a rating: score out of 10 per platform.",
            propertyNames: { enum: [...PLATFORMS] },
            additionalProperties: { type: "integer", minimum: 0, maximum: 10 },
          },
          platform: { type: "string", description: "For a claim: the platform that made it.", enum: [...PLATFORMS] },
          checked: { type: "string", description: "The day the facts were checked against the sources.", pattern: "^20\\d\\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$" },
          hi: {
            type: "object",
            description: "The same guide in Hindi, one line for each English line.",
            additionalProperties: false,
            required: ["title", "status", "points"],
            properties: {
              title: GUIDE_TEXT(160),
              status: GUIDE_TEXT(480),
              points: { type: "array", items: GUIDE_TEXT(480), minItems: 1, maxItems: 6 },
              actions: { type: "array", items: GUIDE_TEXT(140), maxItems: 3 },
            },
          },
        },
      },
    },
  ),
} as const;

export type ContractKind = keyof typeof JSON_SCHEMAS;

/** `shift.schema.json`, `incident.schema.json`, `reply.schema.json`, `trust-list.schema.json`. */
export const schemaFileName = (kind: ContractKind) => `${kind.replace("_", "-")}.schema.json`;

/** The exact text committed under arkiv/schema/. */
export const schemaFileText = (kind: ContractKind) => `${JSON.stringify(JSON_SCHEMAS[kind], null, 2)}\n`;

/** What the schemas check: an entity's content type, creation flags, typed attributes and JSON payload. */
export type WireEntity = {
  contentType: string | undefined;
  flags: { readonly: boolean; permissionlessExtension: boolean } | undefined;
  attributes: Record<string, { type: string; value: unknown }>;
  payload: unknown;
};

type EntityLike = {
  contentType?: string | undefined;
  payload?: Uint8Array | undefined;
  attributes?: Readonly<Record<string, unknown>> | undefined;
  creationFlags?: { readonly: boolean; permissionlessExtension: boolean } | undefined;
  flags?: { readonly?: boolean; permissionlessExtension?: boolean } | undefined;
};

/** Brings an entity read from Arkiv, or `createEntity` parameters about to be sent, into the shape the schemas check. */
export function toWire(entity: EntityLike): WireEntity {
  let payload: unknown;
  try {
    payload = entity.payload ? JSON.parse(new TextDecoder().decode(entity.payload)) : undefined;
  } catch {
    payload = "(not JSON)";
  }
  // Read entities carry `creationFlags` (plus the SDK's raw bit field), create parameters carry `flags`.
  const source = entity.creationFlags ?? entity.flags;
  const flags = source
    ? { readonly: Boolean(source.readonly), permissionlessExtension: Boolean(source.permissionlessExtension) }
    : undefined;
  const attributes: WireEntity["attributes"] = {};
  for (const [name, cell] of Object.entries(entity.attributes ?? {})) {
    // The SDK also accepts bare values and guesses their type; the contract wants every attribute typed.
    attributes[name] = cell && typeof cell === "object" && "type" in cell && "value" in cell
      ? { type: String(cell.type), value: cell.value }
      : { type: "untyped", value: cell };
  }
  return { contentType: entity.contentType, flags, attributes, payload };
}

let validators: Record<ContractKind, ValidateFunction> | undefined;

function compiled(): Record<ContractKind, ValidateFunction> {
  if (!validators) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    validators = {
      shift: ajv.compile(JSON_SCHEMAS.shift),
      incident: ajv.compile(JSON_SCHEMAS.incident),
      reply: ajv.compile(JSON_SCHEMAS.reply),
      trust_list: ajv.compile(JSON_SCHEMAS.trust_list),
      guide: ajv.compile(JSON_SCHEMAS.guide),
    };
  }
  return validators;
}

const describeError = (e: ErrorObject) => {
  const extra = e.keyword === "additionalProperties" ? ` (${String((e.params as { additionalProperty?: string }).additionalProperty)})` : "";
  return `${e.instancePath || "/"} ${e.message ?? e.keyword}${extra}`;
};

/** Checks one entity against its kind's schema. An empty list means it conforms. */
export function validateEntity(kind: ContractKind, entity: EntityLike): string[] {
  const validate = compiled()[kind];
  return validate(toWire(entity)) ? [] : (validate.errors ?? []).map(describeError);
}

/** The same check for an entity already in wire shape, as the conformance vectors in arkiv/vectors/ are. */
export function validateWire(kind: ContractKind, wire: WireEntity): string[] {
  const validate = compiled()[kind];
  return validate(wire) ? [] : (validate.errors ?? []).map(describeError);
}

// ---------------------------------------------------------------------------------------------
// Privacy audit
// ---------------------------------------------------------------------------------------------

/**
 * Personal data that must never appear in clear text: Indian mobile numbers, email addresses and
 * 12-digit Aadhaar-style numbers. Only the free text a trust-list curator writes can contain any
 * string at all, but every clear-text string is scanned.
 */
const PII_PATTERNS: [string, RegExp][] = [
  ["phone number", /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/],
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["12-digit ID number", /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/],
];

function clearStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    // Hex values and https links are not personal text; a link's digits (an article id) are not an ID number.
    if (!/^0x[0-9a-fA-F]+$/.test(value) && !/^https:\/\/\S+$/.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) clearStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const [name, item] of Object.entries(value)) if (name !== "sealed") clearStrings(item, out);
  }
  return out;
}

export function findPersonalData(entity: EntityLike): string[] {
  const wire = toWire(entity);
  const found: string[] = [];
  for (const text of clearStrings([Object.values(wire.attributes).map((a) => a.value), wire.payload])) {
    for (const [label, pattern] of PII_PATTERNS) if (pattern.test(text)) found.push(`${label} in "${text.slice(0, 40)}"`);
  }
  return found;
}

export type AuditFinding = { key: string; creator: string; kind: string; demo: boolean; problems: string[] };

export type AuditReport = {
  checked: number;
  /** Entries readers accept and show, by kind. */
  shown: Record<ContractKind, number>;
  /** Entities claiming `app = nexora` that readers reject; they are never shown or counted. */
  rejected: { key: string; reason: string }[];
  /** Shown entries that break the strict schema or carry personal data. Any of these fails the audit. */
  violations: AuditFinding[];
  /**
   * Wallets that wrote incident reports, and those of them that also wrote earnings, so a report can
   * be linked to a worker's pay. The app sends reports from a one-time wallet by default; demo data
   * comes from a few seed wallets that write both, so it is counted separately.
   */
  linkability: Record<"real" | "demo", { incidentWallets: number; alsoWroteEarnings: string[] }>;
  passed: boolean;
};

/**
 * Audits everything that claims to be Nexora data. Anyone can run it: it needs nothing but the
 * public entities. It fails if any entry that readers would show breaks the contract or contains
 * personal data in clear text.
 */
export function auditEntities(entities: readonly RawEntity[]): AuditReport {
  const shown: AuditReport["shown"] = { shift: 0, incident: 0, reply: 0, trust_list: 0, guide: 0 };
  const rejected: AuditReport["rejected"] = [];
  const violations: AuditFinding[] = [];
  const wallets = {
    real: { shift: new Set<string>(), incident: new Set<string>() },
    demo: { shift: new Set<string>(), incident: new Set<string>() },
  };

  for (const raw of entities) {
    const kindValue = raw.attributes?.kind?.value;
    const kind: ContractKind | null =
      kindValue === KIND.shift ? "shift" : kindValue === KIND.incident ? "incident" : kindValue === KIND.reply ? "reply" : kindValue === KIND.trustList ? "trust_list" : kindValue === KIND.guide ? "guide" : null;
    const decoded = kind === "trust_list" ? decodeTrustList(raw) : kind === "reply" ? decodeReply(raw) : kind === "guide" ? decodeGuide(raw) : kind ? decodeEntry(raw) : null;
    if (!kind || !decoded || !decoded.ok) {
      rejected.push({ key: raw.key ?? "unknown", reason: decoded && !decoded.ok ? decoded.reason : "not a Nexora kind" });
      continue;
    }
    shown[kind]++;
    const demo = raw.attributes?.demo?.value === true;
    if (kind === "shift" || kind === "incident") wallets[demo ? "demo" : "real"][kind].add((raw.creator ?? "").toLowerCase());
    const problems = [...validateEntity(kind, raw), ...findPersonalData(raw)];
    if (problems.length > 0) violations.push({ key: raw.key ?? "unknown", creator: raw.creator ?? "unknown", kind, demo, problems });
  }

  const linked = (set: (typeof wallets)["real"]) => ({
    incidentWallets: set.incident.size,
    alsoWroteEarnings: [...set.incident].filter((wallet) => set.shift.has(wallet)),
  });
  return {
    checked: entities.length,
    shown,
    rejected,
    violations,
    linkability: { real: linked(wallets.real), demo: linked(wallets.demo) },
    passed: violations.length === 0,
  };
}
