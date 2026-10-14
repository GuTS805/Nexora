/**
 * Read fallback for the public RPC's anonymous query budget (friction F6). The browser always
 * queries Arkiv directly first; only after that visitor's IP gets `429 ANON_COST_LIMITED` does it
 * send the same `arkiv_query` here. Answers are cached at the CDN for 30 s, so a classroom on one
 * Wi-Fi, or every judge opening the same page, costs a handful of upstream queries.
 *
 * It forwards one method, `arkiv_query`, read-only, to `ARKIV_RPC_URL` (an Arkiv Hub access key
 * stays server-side) or the public RPC. It holds no data and can be deleted without losing any:
 * the CLI, the portable build and any other Arkiv client never use it.
 *
 *   GET /api/read?q=<url-encoded JSON of the arkiv_query params: [query, options]>
 */
const PUBLIC_RPC = "https://rpc.tiramisu.db-chain.testnet.arkiv.network";
// The node refuses longer queries anyway (friction F4); this only bounds what we forward.
const MAX_QUERY_BYTES = 8_192;
const OPTION_KEYS = new Set(["atBlock", "select", "limit", "cursor"]);

const json = (status: number, body: unknown, cache: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": cache, ...extra } });

const noStore = "no-store";
// Browsers keep nothing; the CDN shares one answer for 30 s and may serve it stale while refreshing.
const shared = "public, max-age=0, s-maxage=30, stale-while-revalidate=300";

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("q");
  let params: [string, Record<string, unknown>];
  try {
    if (!raw || raw.length > MAX_QUERY_BYTES * 2) throw new Error();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 2) throw new Error();
    const [query, options = {}] = parsed as [unknown, unknown];
    if (typeof query !== "string" || new TextEncoder().encode(query).length > MAX_QUERY_BYTES) throw new Error();
    if (typeof options !== "object" || options === null || Array.isArray(options)) throw new Error();
    if (Object.keys(options).some((k) => !OPTION_KEYS.has(k))) throw new Error();
    params = [query, options as Record<string, unknown>];
  } catch {
    return json(400, { error: { code: -32602, message: "Send ?q= with the JSON params of one arkiv_query." } }, noStore);
  }

  const rpc = process.env.ARKIV_RPC_URL || PUBLIC_RPC;
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "arkiv_query", params }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return json(502, { error: { code: -32603, message: "Arkiv RPC did not answer." } }, noStore);
  }
  if (upstream.status === 429) {
    const retryAfter = upstream.headers.get("retry-after") ?? "60";
    // Cache the refusal briefly too, so a burst of visitors does not hammer an exhausted budget.
    return json(429, { error: { code: 429, message: "Arkiv RPC query budget exhausted for the fallback too." } }, "public, max-age=0, s-maxage=15", { "retry-after": retryAfter });
  }
  if (!upstream.ok) return json(502, { error: { code: -32603, message: `Arkiv RPC answered HTTP ${upstream.status}.` } }, noStore);

  const body = (await upstream.json()) as { result?: unknown; error?: { code: number; message: string } };
  if (body.error) return json(200, { error: body.error }, noStore);
  return json(200, { result: body.result }, shared);
}
