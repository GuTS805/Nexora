import { ExpirationTime } from "@arkiv-network/sdk";
import { bool, i32, key as keyAttr, str } from "@arkiv-network/sdk/attr";
import type { CreateEntityParameters, PatchEntityParameters } from "@arkiv-network/sdk";
import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import {
  APP, CITIES, COST_STEP, EXPIRY_CHOICES_DAYS, HOURS_BANDS, INCENTIVES, INCIDENT_TYPES, KIND, MAX_DAY_INR,
  MAX_DAYS_LOST, MAX_HOURS, MAX_NAME_LENGTH, MAX_TRUST_MEMBERS, NET_MAX, NET_MIN, NET_STEP, PLATFORMS,
  REPLY_STATUSES, SCHEMA_VERSION, TRUST_LIST_DAYS, VEHICLES, WORK_TYPES, costPct, hoursBand, isOneOf, isPeriod, netHourly,
  type City, type Incentive, type IncidentType, type Platform, type ReplyStatus, type Vehicle, type WorkType,
} from "./schema.ts";
import { isSealedBox, type SealedBox } from "./seal.ts";

type Lifetime = (typeof EXPIRY_CHOICES_DAYS)[number];

/** What a worker fills in for one day. Exact rupees and hours become a band and a rounded rate here. */
export type ShiftInput = {
  platform: Platform;
  work: WorkType;
  city: City;
  vehicle: Vehicle;
  /** Month worked, YYYYMM. */
  period: number;
  /** Everything the app paid for the day: order pay, incentives, tips. */
  grossInr: number;
  /** The day's fuel or charging, maintenance, phone data. */
  costsInr: number;
  /** Logged-in hours, including time spent waiting for orders. */
  hours: number;
  incentive: Incentive;
  expiresInDays: Lifetime;
  demo?: boolean | undefined;
  sealed?: SealedBox | undefined;
};

/** What a worker fills in when something happened to them at work. */
export type IncidentInput = {
  platform: Platform;
  work: WorkType;
  city: City;
  type: IncidentType;
  period: number;
  /** Days without work because of it (0 if none). */
  daysLost: number;
  reasonGiven: boolean;
  appealed: boolean;
  resolved: boolean;
  expiresInDays: Lifetime;
  /** An update to an earlier incident (e.g. "unblocked after 6 days"), or the same thing happening to someone else. */
  parent?: Hex | undefined;
  demo?: boolean | undefined;
  sealed?: SealedBox | undefined;
};

/** What a union, worker group or platform posts about a report. */
export type ReplyInput = {
  /** The incident report this reply is about. */
  parent: Hex;
  status: ReplyStatus;
  /** Month of the reply, YYYYMM. */
  period: number;
  expiresInDays: Lifetime;
  demo?: boolean | undefined;
};

type Meta = {
  key: Hex;
  creator: Address;
  owner: Address;
  expiresAt: bigint;
  createdAt: bigint | undefined;
  readonly: boolean;
  communityCanExtend: boolean;
  demo: boolean;
  sealed: SealedBox | null;
};

/** One day's earnings as read back from Arkiv, after validation. */
export type Shift = Meta & {
  kind: "shift";
  platform: Platform;
  work: WorkType;
  city: City;
  vehicle: Vehicle;
  period: number;
  hoursBand: number;
  netHourly: number;
  costPct: number;
  incentive: Incentive;
};

/** One incident as read back from Arkiv, after validation. */
export type Incident = Meta & {
  kind: "incident";
  platform: Platform;
  work: WorkType;
  city: City;
  type: IncidentType;
  period: number;
  daysLost: number;
  reasonGiven: boolean;
  appealed: boolean;
  resolved: boolean;
  parent: Hex | null;
};

export type Entry = Shift | Incident;

/** A reply to a report, as read back from Arkiv, after validation. Who sent it is `creator`. */
export type Reply = Omit<Meta, "sealed"> & {
  kind: "reply";
  parent: Hex;
  status: ReplyStatus;
  period: number;
};

export type TrustListInput = {
  name: string;
  /** Which work the list vouches for, or all of it. */
  scope: WorkType | "all";
  description: string;
  members: Address[];
};

export type TrustList = TrustListInput & {
  key: Hex;
  creator: Address;
  owner: Address;
  expiresAt: bigint;
};

/** The subset of an SDK entity the decoders read. Matches `select("*")` results. */
export type RawEntity = {
  key?: Hex | undefined;
  creator?: Hex | undefined;
  owner?: Hex | undefined;
  expiresAt?: bigint | undefined;
  createdAt?: bigint | undefined;
  creationFlags?: { readonly: boolean; permissionlessExtension: boolean } | undefined;
  contentType?: string | undefined;
  payload?: Uint8Array | undefined;
  attributes?: Readonly<Record<string, { type: string; value: unknown }>> | undefined;
};

export type Decoded<T> = { ok: true; value: T } | { ok: false; key: string; reason: string };

type Attribute = ReturnType<typeof str> | ReturnType<typeof i32> | ReturnType<typeof bool> | ReturnType<typeof keyAttr>;

const MAX_PAYLOAD = 4_096;

function encodeJson(value: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > MAX_PAYLOAD) throw new Error(`Payload is ${bytes.length} bytes; the contract allows ${MAX_PAYLOAD}.`);
  return bytes;
}

function checkEnums(enums: [readonly string[], unknown, string][]): void {
  for (const [list, value, name] of enums) {
    if (!isOneOf(list, value)) throw new Error(`Unknown ${name}: ${String(value)}`);
  }
}

function checkCommon(input: { period: number; expiresInDays: number; demo?: boolean | undefined }): void {
  if (!isPeriod(input.period)) throw new Error("Month must be a valid YYYYMM between 2024 and 2030.");
  if (!(EXPIRY_CHOICES_DAYS as readonly number[]).includes(input.expiresInDays)) throw new Error("Pick one of the offered lifetimes.");
}

export function validateShiftInput(input: ShiftInput): void {
  checkEnums([
    [PLATFORMS, input.platform, "platform"], [WORK_TYPES, input.work, "work type"], [CITIES, input.city, "city"],
    [VEHICLES, input.vehicle, "vehicle"], [INCENTIVES, input.incentive, "incentive"],
  ]);
  checkCommon(input);
  if (!(Number.isFinite(input.hours) && input.hours > 0 && input.hours <= MAX_HOURS)) {
    throw new Error(`Hours must be more than 0 and at most ${MAX_HOURS}.`);
  }
  if (!(Number.isFinite(input.grossInr) && input.grossInr >= 0 && input.grossInr <= MAX_DAY_INR)) {
    throw new Error(`Earnings must be between ₹0 and ₹${MAX_DAY_INR.toLocaleString("en-IN")} for one day.`);
  }
  if (!(Number.isFinite(input.costsInr) && input.costsInr >= 0 && input.costsInr <= MAX_DAY_INR)) {
    throw new Error(`Costs must be between ₹0 and ₹${MAX_DAY_INR.toLocaleString("en-IN")} for one day.`);
  }
}

export function validateIncidentInput(input: IncidentInput): void {
  checkEnums([
    [PLATFORMS, input.platform, "platform"], [WORK_TYPES, input.work, "work type"], [CITIES, input.city, "city"],
    [INCIDENT_TYPES, input.type, "incident type"],
  ]);
  checkCommon(input);
  if (!(Number.isInteger(input.daysLost) && input.daysLost >= 0 && input.daysLost <= MAX_DAYS_LOST)) {
    throw new Error(`Days without work must be a whole number from 0 to ${MAX_DAYS_LOST}.`);
  }
  for (const [value, name] of [[input.reasonGiven, "reasonGiven"], [input.appealed, "appealed"], [input.resolved, "resolved"]] as const) {
    if (typeof value !== "boolean") throw new Error(`${name} must be true or false.`);
  }
  if (input.parent !== undefined && !(isHex(input.parent) && input.parent.length === 66)) {
    throw new Error("Parent must be a 32-byte entity key.");
  }
}

export function validateReplyInput(input: ReplyInput): void {
  checkEnums([[REPLY_STATUSES, input.status, "reply status"]]);
  checkCommon(input);
  if (!(isHex(input.parent) && input.parent.length === 66)) throw new Error("Parent must be a 32-byte entity key.");
}

// readonly: a published entry can never be silently rewritten, not even by its author, so nobody
// can be pressured into "correcting" it. permissionlessExtension: anyone who finds an entry useful
// (a union, a researcher, another worker) can keep it alive past the lifetime its author chose.
const ENTRY_FLAGS = { readonly: true, permissionlessExtension: true } as const;

/**
 * Builds the exact `createEntity` parameters for one day's earnings. Shared by the web app, the CLI
 * and the seed script so all three write byte-identical shapes.
 */
export function shiftCreate(input: ShiftInput): CreateEntityParameters {
  validateShiftInput(input);
  const attributes: Record<string, Attribute> = {
    app: str(APP),
    v: i32(SCHEMA_VERSION),
    kind: str(KIND.shift),
    platform: str(input.platform),
    work: str(input.work),
    city: str(input.city),
    vehicle: str(input.vehicle),
    period: i32(input.period),
    hours_band: i32(hoursBand(input.hours)),
    net_hourly: i32(netHourly(input.grossInr, input.costsInr, input.hours)),
    cost_pct: i32(costPct(input.grossInr, input.costsInr)),
    demo: bool(Boolean(input.demo)),
  };
  const payload: Record<string, unknown> = { v: SCHEMA_VERSION, incentive: input.incentive };
  if (input.sealed) payload.sealed = input.sealed;
  return {
    payload: encodeJson(payload),
    contentType: "application/json",
    attributes,
    expires: ExpirationTime.fromDays(input.expiresInDays),
    flags: ENTRY_FLAGS,
  };
}

/** Builds the exact `createEntity` parameters for an incident. */
export function incidentCreate(input: IncidentInput): CreateEntityParameters {
  validateIncidentInput(input);
  const attributes: Record<string, Attribute> = {
    app: str(APP),
    v: i32(SCHEMA_VERSION),
    kind: str(KIND.incident),
    platform: str(input.platform),
    work: str(input.work),
    city: str(input.city),
    type: str(input.type),
    period: i32(input.period),
    days_lost: i32(input.daysLost),
    demo: bool(Boolean(input.demo)),
  };
  if (input.parent) attributes.parent = keyAttr(input.parent);
  const payload: Record<string, unknown> = {
    v: SCHEMA_VERSION,
    reasonGiven: input.reasonGiven,
    appealed: input.appealed,
    resolved: input.resolved,
  };
  if (input.sealed) payload.sealed = input.sealed;
  return {
    payload: encodeJson(payload),
    contentType: "application/json",
    attributes,
    expires: ExpirationTime.fromDays(input.expiresInDays),
    flags: ENTRY_FLAGS,
  };
}

/**
 * Builds the exact `createEntity` parameters for a reply to a report. Read-only like every entry, so
 * a group cannot quietly rewrite what it told a worker; anyone can keep it alive longer.
 */
export function replyCreate(input: ReplyInput): CreateEntityParameters {
  validateReplyInput(input);
  return {
    payload: encodeJson({ v: SCHEMA_VERSION }),
    contentType: "application/json",
    attributes: {
      app: str(APP),
      v: i32(SCHEMA_VERSION),
      kind: str(KIND.reply),
      parent: keyAttr(input.parent),
      status: str(input.status),
      period: i32(input.period),
      demo: bool(Boolean(input.demo)),
    },
    expires: ExpirationTime.fromDays(input.expiresInDays),
    flags: ENTRY_FLAGS,
  };
}

function attrValue(raw: RawEntity, name: string, type: string): unknown {
  const cell = raw.attributes?.[name];
  if (!cell || cell.type !== type) return undefined;
  return cell.value;
}

function parseJson(raw: RawEntity): Record<string, unknown> | null {
  if (!raw.payload || raw.payload.length === 0 || raw.payload.length > MAX_PAYLOAD) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(raw.payload));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Checks shared by every entry kind. Returns the metadata, or a reason to reject the entity. */
function decodeMeta(raw: RawEntity, kind: string): { meta: Omit<Meta, "sealed">; payload: Record<string, unknown>; sealed: SealedBox | null } | string {
  if (!raw.key || !raw.creator || !raw.owner || raw.expiresAt === undefined) return "missing metadata";
  if (attrValue(raw, "app", "str") !== APP || attrValue(raw, "kind", "str") !== kind) return `not a ${kind}`;
  if (attrValue(raw, "v", "i32") !== SCHEMA_VERSION) return "unsupported schema version";
  // An entry its writer could still edit might change after people relied on it, so it is left out.
  // Flags and content type are checked whenever the read returned them.
  if (raw.creationFlags && !raw.creationFlags.readonly) return "editable (not created readonly)";
  if (raw.contentType !== undefined && raw.contentType !== "application/json") return "not application/json";
  if (!isPeriod(attrValue(raw, "period", "i32"))) return "bad month";
  const demo = attrValue(raw, "demo", "bool");
  if (typeof demo !== "boolean") return "bad demo flag";
  const payload = parseJson(raw);
  if (!payload || payload.v !== SCHEMA_VERSION) return "bad payload";
  if (payload.sealed !== undefined && !isSealedBox(payload.sealed)) return "bad sealed box";
  return {
    meta: {
      key: raw.key,
      creator: getAddress(raw.creator),
      owner: getAddress(raw.owner),
      expiresAt: raw.expiresAt,
      createdAt: raw.createdAt,
      readonly: raw.creationFlags?.readonly ?? false,
      communityCanExtend: raw.creationFlags?.permissionlessExtension ?? false,
      demo,
    },
    payload,
    sealed: (payload.sealed as SealedBox | undefined) ?? null,
  };
}

function decodePlace(raw: RawEntity): { platform: Platform; work: WorkType; city: City } | string {
  const platform = attrValue(raw, "platform", "str");
  const work = attrValue(raw, "work", "str");
  const city = attrValue(raw, "city", "str");
  if (!isOneOf(PLATFORMS, platform)) return "bad platform";
  if (!isOneOf(WORK_TYPES, work)) return "bad work type";
  if (!isOneOf(CITIES, city)) return "bad city";
  return { platform, work, city };
}

/**
 * Validates an entity against the contract. Anyone can write entities that claim `app = nexora`,
 * so nothing is trusted until it passes here; failures are counted and shown, not hidden.
 */
export function decodeShift(raw: RawEntity): Decoded<Shift> {
  const fail = (reason: string): Decoded<Shift> => ({ ok: false, key: raw.key ?? "unknown", reason });
  const base = decodeMeta(raw, KIND.shift);
  if (typeof base === "string") return fail(base);
  const place = decodePlace(raw);
  if (typeof place === "string") return fail(place);
  const vehicle = attrValue(raw, "vehicle", "str");
  if (!isOneOf(VEHICLES, vehicle)) return fail("bad vehicle");
  const band = attrValue(raw, "hours_band", "i32");
  const net = attrValue(raw, "net_hourly", "i32");
  const cost = attrValue(raw, "cost_pct", "i32");
  if (typeof band !== "number" || !Number.isInteger(band) || band < 0 || band > HOURS_BANDS.length) return fail("bad hours band");
  if (typeof net !== "number" || net < NET_MIN || net > NET_MAX || net % NET_STEP !== 0) return fail("bad hourly earnings");
  if (typeof cost !== "number" || cost < 0 || cost > 100 || cost % COST_STEP !== 0) return fail("bad cost share");
  const incentive = base.payload.incentive;
  if (!isOneOf(INCENTIVES, incentive)) return fail("bad incentive");
  return {
    ok: true,
    value: {
      ...base.meta, sealed: base.sealed, kind: "shift", ...place, vehicle,
      period: attrValue(raw, "period", "i32") as number,
      hoursBand: band, netHourly: net, costPct: cost, incentive,
    },
  };
}

export function decodeIncident(raw: RawEntity): Decoded<Incident> {
  const fail = (reason: string): Decoded<Incident> => ({ ok: false, key: raw.key ?? "unknown", reason });
  const base = decodeMeta(raw, KIND.incident);
  if (typeof base === "string") return fail(base);
  const place = decodePlace(raw);
  if (typeof place === "string") return fail(place);
  const type = attrValue(raw, "type", "str");
  if (!isOneOf(INCIDENT_TYPES, type)) return fail("bad incident type");
  const daysLost = attrValue(raw, "days_lost", "i32");
  if (typeof daysLost !== "number" || !Number.isInteger(daysLost) || daysLost < 0 || daysLost > MAX_DAYS_LOST) return fail("bad days lost");
  const parentCell = raw.attributes?.parent;
  if (parentCell && parentCell.type !== "key") return fail("bad parent");
  const { reasonGiven, appealed, resolved } = base.payload;
  if (typeof reasonGiven !== "boolean" || typeof appealed !== "boolean" || typeof resolved !== "boolean") return fail("bad incident details");
  return {
    ok: true,
    value: {
      ...base.meta, sealed: base.sealed, kind: "incident", ...place, type,
      period: attrValue(raw, "period", "i32") as number,
      daysLost, reasonGiven, appealed, resolved,
      parent: parentCell ? (parentCell.value as Hex) : null,
    },
  };
}

export function decodeReply(raw: RawEntity): Decoded<Reply> {
  const fail = (reason: string): Decoded<Reply> => ({ ok: false, key: raw.key ?? "unknown", reason });
  const base = decodeMeta(raw, KIND.reply);
  if (typeof base === "string") return fail(base);
  const status = attrValue(raw, "status", "str");
  if (!isOneOf(REPLY_STATUSES, status)) return fail("bad reply status");
  const parent = attrValue(raw, "parent", "key");
  if (!(typeof parent === "string" && isHex(parent) && parent.length === 66)) return fail("bad parent");
  return {
    ok: true,
    value: { ...base.meta, kind: "reply", parent: parent as Hex, status, period: attrValue(raw, "period", "i32") as number },
  };
}

/** Decodes a shift or an incident, whichever the entity claims to be. */
export function decodeEntry(raw: RawEntity): Decoded<Entry> {
  const kind = attrValue(raw, "kind", "str");
  if (kind === KIND.shift) return decodeShift(raw);
  if (kind === KIND.incident) return decodeIncident(raw);
  return { ok: false, key: raw.key ?? "unknown", reason: "not a Nexora entry" };
}

function normaliseMembers(members: readonly unknown[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const member of members) {
    if (typeof member !== "string" || !isAddress(member)) throw new Error(`Not an address: ${String(member)}`);
    const checksummed = getAddress(member);
    if (!seen.has(checksummed)) {
      seen.add(checksummed);
      out.push(checksummed);
    }
  }
  if (out.length === 0 || out.length > MAX_TRUST_MEMBERS) {
    throw new Error(`A trust list needs 1–${MAX_TRUST_MEMBERS} members.`);
  }
  return out;
}

function validateTrustInput(input: TrustListInput): TrustListInput {
  const name = input.name.trim();
  if (name.length < 3 || name.length > MAX_NAME_LENGTH) throw new Error(`Name must be 3–${MAX_NAME_LENGTH} characters.`);
  if (input.scope !== "all" && !isOneOf(WORK_TYPES, input.scope)) throw new Error("Unknown scope.");
  const description = input.description.trim();
  if (description.length > 280) throw new Error("Description must be at most 280 characters.");
  return { name, scope: input.scope, description, members: normaliseMembers(input.members) };
}

export function trustListCreate(input: TrustListInput): CreateEntityParameters {
  const clean = validateTrustInput(input);
  return {
    payload: encodeJson({ v: SCHEMA_VERSION, description: clean.description, members: clean.members }),
    contentType: "application/json",
    attributes: {
      app: str(APP),
      v: i32(SCHEMA_VERSION),
      kind: str(KIND.trustList),
      name: str(clean.name),
      scope: str(clean.scope),
    },
    expires: ExpirationTime.fromDays(TRUST_LIST_DAYS),
    // Mutable on purpose: a curator adds and removes members over time. Only the owner can patch.
    flags: { readonly: false, permissionlessExtension: false },
  };
}

/**
 * Patch parameters for editing a trust list in place. Arkiv patches are mutations (`set` / `unset`),
 * not a replacement, so every attribute is re-set alongside the new payload.
 */
export function trustListPatch(entityKey: Hex, input: TrustListInput): PatchEntityParameters {
  const create = trustListCreate(input);
  return { entityKey, payload: create.payload, contentType: create.contentType, set: create.attributes };
}

export function decodeTrustList(raw: RawEntity): Decoded<TrustList> {
  const keyText = raw.key ?? "unknown";
  const fail = (reason: string): Decoded<TrustList> => ({ ok: false, key: keyText, reason });
  if (!raw.key || !raw.creator || !raw.owner || raw.expiresAt === undefined) return fail("missing metadata");
  if (attrValue(raw, "app", "str") !== APP || attrValue(raw, "kind", "str") !== KIND.trustList) return fail("not a trust list");
  if (attrValue(raw, "v", "i32") !== SCHEMA_VERSION) return fail("unsupported schema version");
  const payload = parseJson(raw);
  if (!payload || payload.v !== SCHEMA_VERSION || !Array.isArray(payload.members)) return fail("bad payload");
  try {
    const clean = validateTrustInput({
      name: String(attrValue(raw, "name", "str") ?? ""),
      scope: attrValue(raw, "scope", "str") as WorkType | "all",
      description: typeof payload.description === "string" ? payload.description : "",
      members: payload.members as Address[],
    });
    return {
      ok: true,
      value: { ...clean, key: raw.key, creator: getAddress(raw.creator), owner: getAddress(raw.owner), expiresAt: raw.expiresAt },
    };
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : "invalid trust list");
  }
}
