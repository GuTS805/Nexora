import { createPublicClient, type PublicArkivClient } from "@arkiv-network/sdk";
import { addr, bool, i32, key as keyAttr, str } from "@arkiv-network/sdk/attr";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { and, eq, gte, lte, or, type Expression } from "@arkiv-network/sdk/query";
import { custom, http, webSocket, type Address, type Hex } from "viem";
import { decodeEntry, decodeIncident, decodeReply, decodeShift, decodeTrustList, type Decoded, type Entry, type Incident, type RawEntity, type Reply, type Shift, type TrustList } from "./codec.ts";
import { APP, DAY_LENGTHS, KIND, SCHEMA_VERSION, type City, type DayLength, type IncidentType, type Platform, type Vehicle, type WorkType } from "./schema.ts";
import { decodeGuide, type Guide } from "./guide.ts";

export const TIRAMISU_RPC = tiramisu.rpcUrls.default.http[0];
export const TIRAMISU_WS = tiramisu.rpcUrls.default.webSocket[0];
export const EXPLORER = "https://tiramisu.explorer.arkiv.network";

/**
 * The RPC to use when none is passed: `ARKIV_RPC_URL` if set (Node only — e.g. the public endpoint
 * with an Arkiv Hub access key appended as `/<key>`), else the public Tiramisu RPC. Keys belong in
 * server-side env vars, never in a browser bundle.
 */
export function defaultRpcUrl(): string {
  const fromEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.ARKIV_RPC_URL;
  return fromEnv && /^https?:\/\//.test(fromEnv) ? fromEnv : TIRAMISU_RPC;
}

/**
 * HTTP transport that fails fast. The public RPC answers an exhausted anonymous budget with
 * `429 ANON_COST_LIMITED` and `Retry-After: ~2000s`; viem's default honours that header and retries,
 * which looks like a silent multi-minute hang. Here a 429 surfaces at once and other failures
 * retry briefly.
 */
export function arkivHttp(rpcUrl: string = defaultRpcUrl()) {
  return http(rpcUrl, {
    timeout: 20_000,
    retryCount: 2,
    retryDelay: 400,
    onFetchResponse: (response) => {
      if (response.status === 429) {
        throw new ArkivRateLimitError(Number(response.headers.get("retry-after")) || undefined);
      }
    },
  });
}

export class ArkivRateLimitError extends Error {
  constructor(readonly retryAfterSeconds?: number) {
    super(
      `Arkiv RPC query budget exhausted (HTTP 429 ANON_COST_LIMITED)` +
        (retryAfterSeconds ? `; resets in about ${Math.ceil(retryAfterSeconds / 60)} min` : "") +
        `. Use an Arkiv Hub access key (ARKIV_RPC_URL=https://rpc…/<key>) or another RPC.`,
    );
    this.name = "ArkivRateLimitError";
  }
}

/** True when an error (possibly wrapped by viem) is the RPC's rate limit. */
export function isRateLimited(error: unknown): error is Error {
  for (let e = error as { name?: string; cause?: unknown; status?: number } | undefined, depth = 0; e && depth < 6; e = e.cause as typeof e, depth++) {
    if (e.name === "ArkivRateLimitError" || e.status === 429) return true;
  }
  return false;
}

/** A one-line, human message for any read/write failure; the rate limit gets its own explanation. */
export function explainError(error: unknown): string {
  if (isRateLimited(error)) {
    for (let e = error as { name?: string; cause?: unknown; message?: string } | undefined, depth = 0; e && depth < 6; e = e.cause as typeof e, depth++) {
      if (e.name === "ArkivRateLimitError" && e.message) return e.message;
    }
    return new ArkivRateLimitError().message;
  }
  const message = error instanceof Error ? ((error as { shortMessage?: string }).shortMessage ?? error.message) : String(error);
  return message.split("\n")[0] ?? message;
}

/**
 * A read-only client. The RPC is a parameter, not a constant: if one endpoint is blocked or goes
 * down, any reader — the web app, the CLI, someone else's script — can point at another node.
 */
export function readClient(rpcUrl: string = defaultRpcUrl(), fallbackUrl?: string): PublicArkivClient {
  return createPublicClient({ chain: tiramisu, transport: fallbackUrl ? withReadFallback(rpcUrl, fallbackUrl) : arkivHttp(rpcUrl) });
}

/**
 * Direct reads first, a cached read endpoint second. Every call goes to `rpcUrl`; when an
 * `arkiv_query` hits the anonymous budget (429), that query and the ones after it go to
 * `fallbackUrl` (the deployment's `/api/read`) until the budget's `Retry-After` has passed. Only
 * `arkiv_query` falls back; balance and receipt calls sit in a separate, generous bucket.
 */
export function withReadFallback(rpcUrl: string, fallbackUrl: string, fetchFn: typeof fetch = (...args) => fetch(...args)) {
  const direct = arkivHttp(rpcUrl)({ chain: tiramisu, retryCount: 0 });
  let fallbackUntil = 0;
  let retryAfter = 600;
  const viaFallback = async (params: unknown) => {
    // A host without the endpoint (a static mirror, a local preview) or a network failure means
    // there is no fallback: report the original rate limit, not a confusing 404.
    const unavailable = () => new ArkivRateLimitError(Math.max(1, Math.ceil((fallbackUntil - Date.now()) / 1_000)));
    const response = await fetchFn(`${fallbackUrl}?q=${encodeURIComponent(JSON.stringify(params))}`).catch(() => null);
    if (!response) throw unavailable();
    if (response.status === 429) throw new ArkivRateLimitError(Number(response.headers.get("retry-after")) || undefined);
    const body = (await response.json().catch(() => null)) as { result?: unknown; error?: { message?: string } } | null;
    if (!body || typeof body !== "object") throw unavailable();
    // A node error relayed by the endpoint (e.g. "query is too long") is a real answer: pass it on.
    if (body.error) throw new Error(body.error.message ?? "Arkiv RPC error");
    if (!response.ok || !("result" in body)) throw unavailable();
    return body.result;
  };
  return custom(
    {
      async request({ method, params }: { method: string; params?: unknown }) {
        if (method === "arkiv_query" && Date.now() < fallbackUntil) return viaFallback(params);
        try {
          return await direct.request({ method, params } as Parameters<typeof direct.request>[0]);
        } catch (error) {
          if (method !== "arkiv_query" || !isRateLimited(error)) throw error;
          for (let e = error as { cause?: unknown } | undefined, depth = 0; e && depth < 6; e = e.cause as typeof e, depth++) {
            if (e instanceof ArkivRateLimitError && e.retryAfterSeconds) retryAfter = e.retryAfterSeconds;
          }
          fallbackUntil = Date.now() + Math.min(retryAfter, 3_600) * 1_000;
          return viaFallback(params);
        }
      },
    },
    { retryCount: 0 },
  );
}

/** The WebSocket twin of {@link defaultRpcUrl}: `ARKIV_WS_URL` if set, else public Tiramisu. */
export function defaultWsUrl(): string {
  const fromEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.ARKIV_WS_URL;
  return fromEnv && /^wss?:\/\//.test(fromEnv) ? fromEnv : TIRAMISU_WS;
}

/** A WebSocket client, used only for live entity events. */
export function liveClient(wsUrl: string = defaultWsUrl()): PublicArkivClient {
  return createPublicClient({ chain: tiramisu, transport: webSocket(wsUrl) });
}

/** Filters every entry kind shares. */
export type EntryFilters = {
  platform?: Platform | undefined;
  work?: WorkType | undefined;
  city?: City | undefined;
  /** Inclusive month range, YYYYMM. */
  minPeriod?: number | undefined;
  maxPeriod?: number | undefined;
  includeDemo?: boolean | undefined;
  /** Only entries whose `$creator` is one of these. Empty list → nothing; undefined → anyone. */
  creators?: readonly Address[] | undefined;
  /** Only these entity keys — e.g. the batch of keys a live feed just saw created. */
  keys?: readonly Hex[] | undefined;
};

export type ShiftFilters = EntryFilters & {
  vehicle?: Vehicle | undefined;
  /** Only days that paid at least this much per logged-in hour, after costs. */
  minHourly?: number | undefined;
  /** Only days of this length, as a range over `hours_band` ({@link DAY_LENGTHS}). */
  day?: DayLength | undefined;
  /** Only days whose costs took at least this share of the day's pay, in percent (`cost_pct`). */
  minCostPct?: number | undefined;
};

export type IncidentFilters = EntryFilters & {
  type?: IncidentType | undefined;
  /** Only updates to (or "same here" reports of) this incident. */
  parent?: Hex | undefined;
};

/** Replies to reports. They carry no platform or city: those belong to the report they answer. */
export type ReplyFilters = Pick<EntryFilters, "includeDemo" | "creators" | "keys"> & {
  /** Only replies to this report. */
  parent?: Hex | undefined;
};

/**
 * Most `OR` branches one predicate carries. The Tiramisu node rejects a query with more than 64
 * predicates ("query has too many predicates") or longer than 8192 bytes ("query is too long");
 * neither limit is documented (friction F4). A full filter uses at most 13 predicates, so 25
 * `$creator`/`$key` branches (about 1.6 KB) stay well inside both. Longer lists are split into
 * several queries by the fetch functions.
 */
export const MAX_OR_BRANCHES = 25;

const base = (kind: string) => [eq("app", str(APP)), eq("kind", str(kind)), eq("v", i32(SCHEMA_VERSION))];

/**
 * The clauses every entry filter shares. Authorship filters use the engine-set `$creator`, which no
 * writer can forge — never a self-declared attribute.
 */
function common(clauses: Expression[], filters: EntryFilters): Expression {
  const match = (name: string, value: string | undefined) => {
    if (value) clauses.push(eq(name, str(value)));
  };
  match("platform", filters.platform);
  match("work", filters.work);
  match("city", filters.city);
  if (filters.minPeriod !== undefined) clauses.push(gte("period", i32(filters.minPeriod)));
  if (filters.maxPeriod !== undefined) clauses.push(lte("period", i32(filters.maxPeriod)));
  if (!filters.includeDemo) clauses.push(eq("demo", bool(false)));
  if (filters.keys) {
    if (filters.keys.length === 0) throw new Error("Key filter is empty.");
    if (filters.keys.length > MAX_OR_BRANCHES) throw new Error(`At most ${MAX_OR_BRANCHES} keys per query.`);
    clauses.push(or(filters.keys.map((k) => eq("$key", keyAttr(k)))));
  }
  if (filters.creators) {
    if (filters.creators.length === 0) throw new Error("Creator filter is empty.");
    if (filters.creators.length > MAX_OR_BRANCHES) throw new Error(`At most ${MAX_OR_BRANCHES} creators per query.`);
    clauses.push(or(filters.creators.map((creator) => eq("$creator", addr(creator)))));
  }
  return and(clauses);
}

export function shiftPredicate(filters: ShiftFilters = {}): Expression {
  const clauses = base(KIND.shift);
  if (filters.vehicle) clauses.push(eq("vehicle", str(filters.vehicle)));
  if (filters.minHourly !== undefined) clauses.push(gte("net_hourly", i32(filters.minHourly)));
  if (filters.day) {
    const band: { min?: number; max?: number } = DAY_LENGTHS[filters.day];
    if (band.min !== undefined) clauses.push(gte("hours_band", i32(band.min)));
    if (band.max !== undefined) clauses.push(lte("hours_band", i32(band.max)));
  }
  if (filters.minCostPct !== undefined) clauses.push(gte("cost_pct", i32(filters.minCostPct)));
  return common(clauses, filters);
}

export function incidentPredicate(filters: IncidentFilters = {}): Expression {
  const clauses = base(KIND.incident);
  if (filters.type) clauses.push(eq("type", str(filters.type)));
  if (filters.parent) clauses.push(eq("parent", keyAttr(filters.parent)));
  return common(clauses, filters);
}

export function replyPredicate(filters: ReplyFilters = {}): Expression {
  const clauses = base(KIND.reply);
  if (filters.parent) clauses.push(eq("parent", keyAttr(filters.parent)));
  return common(clauses, filters);
}

/** Shifts and incidents together, e.g. everything one wallet published, or a live feed's new keys. */
export function entryPredicate(filters: EntryFilters = {}): Expression {
  const clauses = [eq("app", str(APP)), or([eq("kind", str(KIND.shift)), eq("kind", str(KIND.incident))]), eq("v", i32(SCHEMA_VERSION))];
  return common(clauses, filters);
}

export function trustListPredicate(curator?: Address): Expression {
  const clauses = base(KIND.trustList);
  if (curator) clauses.push(eq("$creator", addr(curator)));
  return and(clauses);
}

/** Guides (laws and ratings), from one curator when given: readers trust curators, not authors' claims. */
export function guidePredicate(curator?: Address): Expression {
  const clauses = base(KIND.guide);
  if (curator) clauses.push(eq("$creator", addr(curator)));
  return and(clauses);
}

/** The exact query text a judge or another developer can paste into any Arkiv client. */
export function queryText(expression: Expression): string {
  return expression.toString();
}

export type QueryOutcome<T> = {
  items: T[];
  rejected: { key: string; reason: string }[];
  query: string;
  blockNumber: bigint;
  truncated: boolean;
};

async function collect(client: PublicArkivClient, expression: Expression, maxItems: number) {
  let page = await client.select("*").where(expression).limit(Math.min(200, maxItems)).fetch();
  const raw: RawEntity[] = [...(page.entities as unknown as RawEntity[])];
  const blockNumber = page.blockNumber;
  while (page.hasNextPage() && raw.length < maxItems) {
    page = await page.next();
    raw.push(...(page.entities as unknown as RawEntity[]));
  }
  return { raw: raw.slice(0, maxItems), blockNumber, truncated: page.hasNextPage() || raw.length > maxItems };
}

/**
 * Every entity that claims to be Nexora data (`app = "nexora"`), any kind, version or demo flag,
 * undecoded. This is what an audit needs: what is actually on chain, before any reader filters it.
 */
export async function fetchRawEntities(client: PublicArkivClient, maxItems = 2_000) {
  const expression = eq("app", str(APP));
  const page = await collect(client, expression, maxItems);
  return { ...page, query: queryText(expression) };
}

function chunks<T>(list: readonly T[] | undefined): (readonly T[] | undefined)[] {
  if (!list || list.length <= MAX_OR_BRANCHES) return [list];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += MAX_OR_BRANCHES) out.push(list.slice(i, i + MAX_OR_BRANCHES));
  return out;
}

/**
 * Runs a predicate and validates every result. Creator or key lists longer than `MAX_OR_BRANCHES`
 * are queried in slices, one after another, and merged; `query` then holds one line per slice.
 */
async function fetchDecoded<T, F extends EntryFilters>(
  client: PublicArkivClient,
  filters: F,
  predicate: (filters: F) => Expression,
  decode: (raw: RawEntity) => Decoded<T>,
  maxItems: number,
): Promise<QueryOutcome<T>> {
  const items: T[] = [];
  const rejected: { key: string; reason: string }[] = [];
  const queries: string[] = [];
  const seen = new Set<string>();
  let blockNumber = 0n;
  let truncated = false;
  for (const creators of chunks(filters.creators)) {
    for (const keys of chunks(filters.keys)) {
      const room = maxItems - items.length - rejected.length;
      if (room <= 0) {
        truncated = true;
        break;
      }
      const expression = predicate({ ...filters, creators, keys });
      queries.push(queryText(expression));
      const page = await collect(client, expression, room);
      if (page.blockNumber > blockNumber) blockNumber = page.blockNumber;
      truncated ||= page.truncated;
      for (const entity of page.raw) {
        const key = entity.key ?? "";
        if (key && seen.has(key)) continue;
        seen.add(key);
        const decoded = decode(entity);
        if (decoded.ok) items.push(decoded.value);
        else rejected.push({ key: decoded.key, reason: decoded.reason });
      }
    }
  }
  return { items, rejected, query: queries.join("\n"), blockNumber, truncated };
}

export const fetchShifts = (client: PublicArkivClient, filters: ShiftFilters = {}, maxItems = 600): Promise<QueryOutcome<Shift>> =>
  fetchDecoded(client, filters, shiftPredicate, decodeShift, maxItems);

export const fetchIncidents = (client: PublicArkivClient, filters: IncidentFilters = {}, maxItems = 600): Promise<QueryOutcome<Incident>> =>
  fetchDecoded(client, filters, incidentPredicate, decodeIncident, maxItems);

export const fetchEntries = (client: PublicArkivClient, filters: EntryFilters = {}, maxItems = 600): Promise<QueryOutcome<Entry>> =>
  fetchDecoded(client, filters, entryPredicate, decodeEntry, maxItems);

export const fetchReplies = (client: PublicArkivClient, filters: ReplyFilters = {}, maxItems = 600): Promise<QueryOutcome<Reply>> =>
  fetchDecoded(client, filters, replyPredicate, decodeReply, maxItems);

export async function fetchTrustLists(client: PublicArkivClient, curator?: Address): Promise<QueryOutcome<TrustList>> {
  const expression = trustListPredicate(curator);
  const { raw, blockNumber, truncated } = await collect(client, expression, 200);
  const items: TrustList[] = [];
  const rejected: { key: string; reason: string }[] = [];
  for (const entity of raw) {
    const decoded = decodeTrustList(entity);
    if (decoded.ok) items.push(decoded.value);
    else rejected.push({ key: decoded.key, reason: decoded.reason });
  }
  return { items, rejected, query: queryText(expression), blockNumber, truncated };
}

export async function fetchGuides(client: PublicArkivClient, curator?: Address): Promise<QueryOutcome<Guide>> {
  const expression = guidePredicate(curator);
  const { raw, blockNumber, truncated } = await collect(client, expression, 200);
  const items: Guide[] = [];
  const rejected: { key: string; reason: string }[] = [];
  for (const entity of raw) {
    const decoded = decodeGuide(entity);
    if (decoded.ok) items.push(decoded.value);
    else rejected.push({ key: decoded.key, reason: decoded.reason });
  }
  return { items, rejected, query: queryText(expression), blockNumber, truncated };
}

/** `getEntity`, but an expired or deleted entity is `null` instead of an exception. */
export async function getEntityOrNull(client: PublicArkivClient, entityKey: Hex): Promise<RawEntity | null> {
  try {
    return (await client.getEntity(entityKey)) as RawEntity;
  } catch (error) {
    if ((error as { name?: string }).name === "NoEntityFoundError") return null;
    throw error;
  }
}

const GONE = "not found: expired, deleted, or never created";

export async function fetchEntry(client: PublicArkivClient, entityKey: Hex): Promise<Decoded<Entry>> {
  const entity = await getEntityOrNull(client, entityKey);
  return entity ? decodeEntry(entity) : { ok: false, key: entityKey, reason: GONE };
}

export async function fetchTrustList(client: PublicArkivClient, entityKey: Hex) {
  const entity = await getEntityOrNull(client, entityKey);
  return entity ? decodeTrustList(entity) : ({ ok: false, key: entityKey, reason: GONE } as const);
}

/** Approximate wall-clock time for a future block, at Arkiv's nominal 2 s block time. */
export function blockToDate(target: bigint, currentBlock: bigint, now = Date.now()): Date {
  return new Date(now + Number(target - currentBlock) * 2_000);
}

export const explorerEntity = (entityKey: Hex) => `${EXPLORER}/entity/${entityKey}`;
export const explorerTx = (hash: Hex) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (address: Address) => `${EXPLORER}/address/${address}`;
