import { ExpirationTime } from "@arkiv-network/sdk";
import { bool, i32, key as keyAttr, str } from "@arkiv-network/sdk/attr";
import type { CreateEntityParameters } from "@arkiv-network/sdk";
import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import {
  APP, CATEGORIES, CTAS, EXPIRY_CHOICES_DAYS, FORMATS, KIND, LANGUAGES, MAX_DAYS, MAX_NAME_LENGTH,
  MAX_TRUST_MEMBERS, OFFERS, PLATFORMS, ROI_MAX, ROI_MIN, ROI_STEP, SCHEMA_VERSION, SEASONS,
  SPEND_BANDS_INR, TIERS, TONES, TRUST_LIST_DAYS, isOneOf, roiPct, spendBand,
  type Category, type Cta, type Format, type Language, type Offer, type Platform, type Season,
  type Tier, type Tone,
} from "./schema.ts";
import { isSealedBox, type SealedBox } from "./seal.ts";

/** What a seller fills in. Exact rupee figures are turned into a band and a rounded ROI here. */
export type ExperimentInput = {
  category: Category;
  platform: Platform;
  format: Format;
  lang: Language;
  tier: Tier;
  season: Season;
  tone: Tone;
  cta: Cta;
  offer: Offer;
  spendInr: number;
  revenueInr: number;
  days: number;
  expiresInDays: (typeof EXPIRY_CHOICES_DAYS)[number];
  parent?: Hex | undefined;
  demo?: boolean | undefined;
  sealed?: SealedBox | undefined;
};

/** One experiment as read back from Arkiv, after validation. */
export type Experiment = {
  key: Hex;
  creator: Address;
  owner: Address;
  expiresAt: bigint;
  createdAt: bigint | undefined;
  readonly: boolean;
  communityCanExtend: boolean;
  category: Category;
  platform: Platform;
  format: Format;
  lang: Language;
  tier: Tier;
  season: Season;
  spendBand: number;
  roiPct: number;
  days: number;
  tone: Tone;
  cta: Cta;
  offer: Offer;
  parent: Hex | null;
  demo: boolean;
  sealed: SealedBox | null;
};

export type TrustListInput = {
  name: string;
  scope: Category | "all";
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

const MAX_PAYLOAD = 4_096;

function encodeJson(value: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > MAX_PAYLOAD) throw new Error(`Payload is ${bytes.length} bytes; the contract allows ${MAX_PAYLOAD}.`);
  return bytes;
}

export function validateExperimentInput(input: ExperimentInput): void {
  const enums: [readonly string[], unknown, string][] = [
    [CATEGORIES, input.category, "category"], [PLATFORMS, input.platform, "platform"],
    [FORMATS, input.format, "format"], [LANGUAGES, input.lang, "language"], [TIERS, input.tier, "tier"],
    [SEASONS, input.season, "season"], [TONES, input.tone, "tone"], [CTAS, input.cta, "cta"],
    [OFFERS, input.offer, "offer"],
  ];
  for (const [list, value, name] of enums) {
    if (!isOneOf(list, value)) throw new Error(`Unknown ${name}: ${String(value)}`);
  }
  if (!(Number.isFinite(input.spendInr) && input.spendInr > 0 && input.spendInr <= 1e9)) {
    throw new Error("Spend must be a positive rupee amount.");
  }
  if (!(Number.isFinite(input.revenueInr) && input.revenueInr >= 0 && input.revenueInr <= 1e10)) {
    throw new Error("Revenue must be zero or a positive rupee amount.");
  }
  if (!(Number.isInteger(input.days) && input.days >= 1 && input.days <= MAX_DAYS)) {
    throw new Error(`Duration must be 1–${MAX_DAYS} whole days.`);
  }
  if (!(EXPIRY_CHOICES_DAYS as readonly number[]).includes(input.expiresInDays)) {
    throw new Error("Pick one of the offered lifetimes.");
  }
  if (input.parent !== undefined && !(isHex(input.parent) && input.parent.length === 66)) {
    throw new Error("Parent must be a 32-byte entity key.");
  }
}

/**
 * Builds the exact `createEntity` parameters for an experiment. Shared by the web app, the CLI and
 * the seed script so all three write byte-identical shapes.
 */
export function experimentCreate(input: ExperimentInput): CreateEntityParameters {
  validateExperimentInput(input);
  const attributes: Record<string, ReturnType<typeof str> | ReturnType<typeof i32> | ReturnType<typeof bool> | ReturnType<typeof keyAttr>> = {
    app: str(APP),
    v: i32(SCHEMA_VERSION),
    kind: str(KIND.experiment),
    category: str(input.category),
    platform: str(input.platform),
    format: str(input.format),
    lang: str(input.lang),
    tier: str(input.tier),
    season: str(input.season),
    spend_band: i32(spendBand(input.spendInr)),
    roi_pct: i32(roiPct(input.spendInr, input.revenueInr)),
    demo: bool(Boolean(input.demo)),
  };
  if (input.parent) attributes.parent = keyAttr(input.parent);
  const payload: Record<string, unknown> = {
    v: SCHEMA_VERSION,
    tone: input.tone,
    cta: input.cta,
    offer: input.offer,
    days: input.days,
  };
  if (input.sealed) payload.sealed = input.sealed;
  return {
    payload: encodeJson(payload),
    contentType: "application/json",
    attributes,
    expires: ExpirationTime.fromDays(input.expiresInDays),
    // readonly: a published result can never be silently rewritten after others relied on it.
    // permissionlessExtension: anyone who finds a result useful can keep it alive.
    flags: { readonly: true, permissionlessExtension: true },
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

/**
 * Validates an entity against the contract. Anyone can write entities that claim `app = nexora`,
 * so nothing is trusted until it passes here; failures are counted and shown, not hidden.
 */
export function decodeExperiment(raw: RawEntity): Decoded<Experiment> {
  const keyText = raw.key ?? "unknown";
  const fail = (reason: string): Decoded<Experiment> => ({ ok: false, key: keyText, reason });
  if (!raw.key || !raw.creator || !raw.owner || raw.expiresAt === undefined) return fail("missing metadata");
  if (attrValue(raw, "app", "str") !== APP || attrValue(raw, "kind", "str") !== KIND.experiment) return fail("not an experiment");
  if (attrValue(raw, "v", "i32") !== SCHEMA_VERSION) return fail("unsupported schema version");

  const s = (name: string) => attrValue(raw, name, "str");
  const category = s("category"), platform = s("platform"), format = s("format");
  const lang = s("lang"), tier = s("tier"), season = s("season");
  if (!isOneOf(CATEGORIES, category)) return fail("bad category");
  if (!isOneOf(PLATFORMS, platform)) return fail("bad platform");
  if (!isOneOf(FORMATS, format)) return fail("bad format");
  if (!isOneOf(LANGUAGES, lang)) return fail("bad language");
  if (!isOneOf(TIERS, tier)) return fail("bad tier");
  if (!isOneOf(SEASONS, season)) return fail("bad season");

  const band = attrValue(raw, "spend_band", "i32");
  const roi = attrValue(raw, "roi_pct", "i32");
  if (typeof band !== "number" || band < 0 || band > SPEND_BANDS_INR.length) return fail("bad spend band");
  if (typeof roi !== "number" || roi < ROI_MIN || roi > ROI_MAX || roi % ROI_STEP !== 0) return fail("bad roi");
  const demo = attrValue(raw, "demo", "bool");
  if (typeof demo !== "boolean") return fail("bad demo flag");
  const parentCell = raw.attributes?.parent;
  if (parentCell && parentCell.type !== "key") return fail("bad parent");

  const payload = parseJson(raw);
  if (!payload || payload.v !== SCHEMA_VERSION) return fail("bad payload");
  const { tone, cta, offer, days, sealed } = payload;
  if (!isOneOf(TONES, tone) || !isOneOf(CTAS, cta) || !isOneOf(OFFERS, offer)) return fail("bad creative fields");
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) return fail("bad duration");
  if (sealed !== undefined && !isSealedBox(sealed)) return fail("bad sealed box");

  return {
    ok: true,
    value: {
      key: raw.key,
      creator: getAddress(raw.creator),
      owner: getAddress(raw.owner),
      expiresAt: raw.expiresAt,
      createdAt: raw.createdAt,
      readonly: raw.creationFlags?.readonly ?? false,
      communityCanExtend: raw.creationFlags?.permissionlessExtension ?? false,
      category, platform, format, lang, tier, season,
      spendBand: band,
      roiPct: roi,
      days,
      tone, cta, offer,
      parent: parentCell ? (parentCell.value as Hex) : null,
      demo,
      sealed: (sealed as SealedBox | undefined) ?? null,
    },
  };
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
  if (input.scope !== "all" && !isOneOf(CATEGORIES, input.scope)) throw new Error("Unknown scope.");
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

/** Patch parameters for editing a trust list's members in place. */
export function trustListPatch(entityKey: Hex, input: TrustListInput) {
  const create = trustListCreate(input);
  return { entityKey, payload: create.payload, contentType: create.contentType, attributes: create.attributes };
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
      scope: attrValue(raw, "scope", "str") as Category | "all",
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
