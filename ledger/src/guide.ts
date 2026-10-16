import { ExpirationTime, type CreateEntityParameters, type PatchEntityParameters } from "@arkiv-network/sdk";
import { i32, str } from "@arkiv-network/sdk/attr";
import { getAddress, type Address, type Hex } from "viem";
import type { Decoded, RawEntity } from "./codec.ts";
import { APP, KIND, PLATFORMS, SCHEMA_VERSION, isOneOf, type City, type Platform } from "./schema.ts";

/**
 * Guides: what the law gives gig workers, independent ratings of platforms, and what independent
 * surveys of workers found, each point tied to its sources. A guide is published by a curator (Nexora's is the curator of the recommended trust
 * list), so readers take only the curators they trust, by `$creator`, exactly as with trust lists.
 *
 * Laws change, so a guide is editable by its curator, like a trust list, and every earlier wording
 * stays readable at past blocks: anyone can show what a guide said on the day they relied on it.
 * Only links with https, closed lists for where and what it is about, and bounded text are allowed.
 */

/** Where a guide applies: all of India, or a state with its own gig-worker law. */
export const GUIDE_SCOPES = ["india", "rajasthan", "karnataka", "bihar", "jharkhand", "telangana"] as const;
/** What a guide is: a law, an independent rating of platforms, or an independent survey of workers. */
export const GUIDE_TOPICS = ["law", "rating", "survey"] as const;
export type GuideScope = (typeof GUIDE_SCOPES)[number];
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export const GUIDE_LIFETIME_DAYS = 365;
const GUIDE_MAX_PAYLOAD = 8_192;
const LIMITS = { title: 160, status: 480, point: 480, points: 6, label: 140, url: 300, links: 4, actions: 3 } as const;

/** The state whose gig-worker law applies in a city, when a guide covers one. */
export const CITY_STATE: Partial<Record<City, GuideScope>> = { bengaluru: "karnataka", hyderabad: "telangana", jaipur: "rajasthan" };

export type GuideLink = { label: string; url: string };
/** The same guide in Hindi: one translated line for each English one. */
export type GuideTranslation = { title: string; status: string; points: string[]; actions?: string[] | undefined };

export type GuideInput = {
  scope: GuideScope;
  topic: GuideTopic;
  title: string;
  status: string;
  points: string[];
  sources: GuideLink[];
  actions?: GuideLink[] | undefined;
  /** For a rating: score out of 10 per platform. */
  scores?: Partial<Record<Platform, number>> | undefined;
  /** The day the facts were checked against the sources, YYYY-MM-DD. */
  checked: string;
  hi?: GuideTranslation | undefined;
};

export type Guide = GuideInput & { key: Hex; creator: Address; owner: Address; expiresAt: bigint };

const text = (value: unknown, max: number, name: string): string => {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new Error(`${name} must be 1–${max} characters.`);
  return value.trim();
};

const lines = (value: unknown, min: number, max: number, name: string): string[] => {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${name} needs ${min}–${max} lines.`);
  return value.map((line, i) => text(line, LIMITS.point, `${name} ${i + 1}`));
};

const links = (value: unknown, min: number, max: number, name: string): GuideLink[] => {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${name} needs ${min}–${max} links.`);
  return value.map((link, i) => {
    const { label, url } = (link ?? {}) as Record<string, unknown>;
    const clean = text(url, LIMITS.url, `${name} ${i + 1} url`);
    if (!/^https:\/\/[^\s"<>]+$/.test(clean)) throw new Error(`${name} ${i + 1} must be an https link.`);
    return { label: text(label, LIMITS.label, `${name} ${i + 1} label`), url: clean };
  });
};

/** Checks a guide and returns it trimmed, or throws with the reason. */
export function validateGuide(input: GuideInput): GuideInput {
  if (!isOneOf(GUIDE_SCOPES, input.scope)) throw new Error(`Unknown scope: ${String(input.scope)}`);
  if (!isOneOf(GUIDE_TOPICS, input.topic)) throw new Error(`Unknown topic: ${String(input.topic)}`);
  if (typeof input.checked !== "string" || !/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(input.checked)) throw new Error("checked must be a date, YYYY-MM-DD.");
  const points = lines(input.points, 1, LIMITS.points, "point");
  const actions = input.actions === undefined ? undefined : links(input.actions, 0, LIMITS.actions, "action");
  let scores: GuideInput["scores"];
  if (input.scores !== undefined) {
    if (input.topic !== "rating") throw new Error("Only a rating has scores.");
    scores = {};
    for (const [platform, score] of Object.entries(input.scores)) {
      if (!isOneOf(PLATFORMS, platform)) throw new Error(`Unknown platform: ${platform}`);
      if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 10) throw new Error(`Score for ${platform} must be 0–10.`);
      scores[platform] = score;
    }
  }
  let hi: GuideTranslation | undefined;
  if (input.hi !== undefined) {
    const h = input.hi;
    const hiPoints = lines(h.points, points.length, points.length, "Hindi point");
    const hiActions = h.actions === undefined ? undefined : lines(h.actions, actions?.length ?? 0, actions?.length ?? 0, "Hindi action");
    hi = { title: text(h.title, LIMITS.title, "Hindi title"), status: text(h.status, LIMITS.status, "Hindi status"), points: hiPoints, ...(hiActions && { actions: hiActions }) };
  }
  return {
    scope: input.scope, topic: input.topic,
    title: text(input.title, LIMITS.title, "title"), status: text(input.status, LIMITS.status, "status"), points,
    sources: links(input.sources, 1, LIMITS.links, "source"),
    ...(actions && { actions }), ...(scores && { scores }),
    checked: input.checked, ...(hi && { hi }),
  };
}

export function guideCreate(input: GuideInput): CreateEntityParameters {
  const { scope, topic, ...body } = validateGuide(input);
  const payload = new TextEncoder().encode(JSON.stringify({ v: SCHEMA_VERSION, ...body }));
  if (payload.length > GUIDE_MAX_PAYLOAD) throw new Error(`Guide is ${payload.length} bytes; the contract allows ${GUIDE_MAX_PAYLOAD}.`);
  return {
    payload,
    contentType: "application/json",
    attributes: { app: str(APP), v: i32(SCHEMA_VERSION), kind: str(KIND.guide), scope: str(scope), topic: str(topic) },
    expires: ExpirationTime.fromDays(GUIDE_LIFETIME_DAYS),
    // Editable by its curator when a law changes; earlier wordings stay readable at past blocks.
    flags: { readonly: false, permissionlessExtension: false },
  };
}

/** Patch parameters to replace a guide's wording in place (every attribute re-set, as for trust lists). */
export function guidePatch(entityKey: Hex, input: GuideInput): PatchEntityParameters {
  const create = guideCreate(input);
  return { entityKey, payload: create.payload, contentType: create.contentType, set: create.attributes };
}

const attr = (raw: RawEntity, name: string, type: string): unknown => {
  const cell = raw.attributes?.[name];
  return cell && cell.type === type ? cell.value : undefined;
};

export function decodeGuide(raw: RawEntity): Decoded<Guide> {
  const fail = (reason: string): Decoded<Guide> => ({ ok: false, key: raw.key ?? "unknown", reason });
  if (!raw.key || !raw.creator || !raw.owner || raw.expiresAt === undefined) return fail("missing metadata");
  if (attr(raw, "app", "str") !== APP || attr(raw, "kind", "str") !== KIND.guide) return fail("not a guide");
  if (attr(raw, "v", "i32") !== SCHEMA_VERSION) return fail("unsupported schema version");
  if (raw.contentType !== undefined && raw.contentType !== "application/json") return fail("not application/json");
  if (!raw.payload || raw.payload.length === 0 || raw.payload.length > GUIDE_MAX_PAYLOAD) return fail("bad payload");
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw.payload)) as Record<string, unknown>;
  } catch {
    return fail("bad payload");
  }
  if (!payload || typeof payload !== "object" || payload.v !== SCHEMA_VERSION) return fail("bad payload");
  try {
    const clean = validateGuide({ ...(payload as unknown as GuideInput), scope: attr(raw, "scope", "str") as GuideScope, topic: attr(raw, "topic", "str") as GuideTopic });
    return { ok: true, value: { ...clean, key: raw.key, creator: getAddress(raw.creator), owner: getAddress(raw.owner), expiresAt: raw.expiresAt } };
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : "invalid guide");
  }
}

/** The guides that apply where a worker works: all-India ones, then their state's, if any. */
export function guidesFor(guides: readonly Guide[], city?: City): Guide[] {
  const state = city ? CITY_STATE[city] : undefined;
  return guides.filter((g) => g.scope === "india" || g.scope === state);
}
