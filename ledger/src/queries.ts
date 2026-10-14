import { createPublicClient, type PublicArkivClient } from "@arkiv-network/sdk";
import { addr, bool, i32, key as keyAttr, str } from "@arkiv-network/sdk/attr";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { and, eq, gte, lte, or, type Expression } from "@arkiv-network/sdk/query";
import { http, webSocket, type Address, type Hex } from "viem";
import { decodeExperiment, decodeTrustList, type Experiment, type RawEntity, type TrustList } from "./codec.ts";
import { APP, KIND, SCHEMA_VERSION, type Category, type Format, type Language, type Platform, type Season, type Tier } from "./schema.ts";

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
export function readClient(rpcUrl: string = defaultRpcUrl()): PublicArkivClient {
  return createPublicClient({ chain: tiramisu, transport: arkivHttp(rpcUrl) });
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

export type ExperimentFilters = {
  category?: Category | undefined;
  platform?: Platform | undefined;
  format?: Format | undefined;
  lang?: Language | undefined;
  tier?: Tier | undefined;
  season?: Season | undefined;
  /** Inclusive spend-band range. */
  minBand?: number | undefined;
  maxBand?: number | undefined;
  minRoi?: number | undefined;
  includeDemo?: boolean | undefined;
  /** Only experiments whose `$creator` is one of these. Empty list → nothing; undefined → anyone. */
  creators?: readonly Address[] | undefined;
  /** Only variants of this experiment. */
  parent?: Hex | undefined;
  /** Only these entity keys — e.g. the batch of keys a live feed just saw created. */
  keys?: readonly Hex[] | undefined;
};

const base = (kind: string) => [eq("app", str(APP)), eq("kind", str(kind)), eq("v", i32(SCHEMA_VERSION))];

/**
 * Turns UI filters into an Arkiv predicate. Authorship filters use the engine-set `$creator`, which
 * no writer can forge — never a self-declared attribute.
 */
export function experimentPredicate(filters: ExperimentFilters = {}): Expression {
  const clauses: Expression[] = base(KIND.experiment);
  const match = (name: string, value: string | undefined) => {
    if (value) clauses.push(eq(name, str(value)));
  };
  match("category", filters.category);
  match("platform", filters.platform);
  match("format", filters.format);
  match("lang", filters.lang);
  match("tier", filters.tier);
  match("season", filters.season);
  if (filters.minBand !== undefined) clauses.push(gte("spend_band", i32(filters.minBand)));
  if (filters.maxBand !== undefined) clauses.push(lte("spend_band", i32(filters.maxBand)));
  if (filters.minRoi !== undefined) clauses.push(gte("roi_pct", i32(filters.minRoi)));
  if (!filters.includeDemo) clauses.push(eq("demo", bool(false)));
  if (filters.parent) clauses.push(eq("parent", keyAttr(filters.parent)));
  if (filters.keys) {
    if (filters.keys.length === 0) throw new Error("Key filter is empty.");
    clauses.push(or(filters.keys.map((k) => eq("$key", keyAttr(k)))));
  }
  if (filters.creators) {
    if (filters.creators.length === 0) throw new Error("Creator filter is empty.");
    clauses.push(or(filters.creators.map((creator) => eq("$creator", addr(creator)))));
  }
  return and(clauses);
}

export function trustListPredicate(curator?: Address): Expression {
  const clauses = base(KIND.trustList);
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

export async function fetchExperiments(
  client: PublicArkivClient,
  filters: ExperimentFilters = {},
  maxItems = 600,
): Promise<QueryOutcome<Experiment>> {
  const expression = experimentPredicate(filters);
  const { raw, blockNumber, truncated } = await collect(client, expression, maxItems);
  const items: Experiment[] = [];
  const rejected: { key: string; reason: string }[] = [];
  for (const entity of raw) {
    const decoded = decodeExperiment(entity);
    if (decoded.ok) items.push(decoded.value);
    else rejected.push({ key: decoded.key, reason: decoded.reason });
  }
  return { items, rejected, query: queryText(expression), blockNumber, truncated };
}

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

export async function fetchExperiment(client: PublicArkivClient, entityKey: Hex) {
  const entity = await client.getEntity(entityKey);
  return decodeExperiment(entity as RawEntity);
}

export async function fetchTrustList(client: PublicArkivClient, entityKey: Hex) {
  const entity = await client.getEntity(entityKey);
  return decodeTrustList(entity as RawEntity);
}

/** Approximate wall-clock time for a future block, at Arkiv's nominal 2 s block time. */
export function blockToDate(target: bigint, currentBlock: bigint, now = Date.now()): Date {
  return new Date(now + Number(target - currentBlock) * 2_000);
}

export const explorerEntity = (entityKey: Hex) => `${EXPLORER}/entity/${entityKey}`;
export const explorerTx = (hash: Hex) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (address: Address) => `${EXPLORER}/address/${address}`;
