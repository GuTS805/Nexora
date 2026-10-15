import { and, eq } from "@arkiv-network/sdk/query";
import { key, str } from "@arkiv-network/sdk/attr";
import { getAddress, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { entryPredicate, incidentPredicate, queryText, shiftPredicate, trustListPredicate } from "nexora-ledger";
import { GET, isNexoraQuery } from "../../api/read.ts";

const Q = "app = str('nexora') AND v = i32(1)";
let ip = 0;
// A fresh client address per request unless a test pins one, so the per-IP cap does not leak between tests.
const get = (q?: string, from = `10.0.0.${++ip}`) =>
  GET(new Request(`http://localhost/api/read${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`, { headers: { "x-vercel-forwarded-for": from } }));
const upstream = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers })));

describe("read fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects anything but the params of one arkiv_query, without reaching the network", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    for (const q of [undefined, "not json", "{}", "[]", "[42]", JSON.stringify([Q, { evil: 1 }]), JSON.stringify([`${Q} AND ${"x".repeat(9_000)}`])]) {
      const response = await get(q);
      expect(response.status, String(q)).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("forwards only arkiv_query and lets the CDN share the answer", async () => {
    upstream(200, { jsonrpc: "2.0", id: 1, result: { data: [], blockNumber: "0x1" } });
    const response = await get(JSON.stringify([Q, { limit: 1 }]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { data: [], blockNumber: "0x1" } });
    expect(response.headers.get("cache-control")).toMatch(/s-maxage=30/);
    const sent = JSON.parse(((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).body as string);
    expect(sent).toMatchObject({ method: "arkiv_query", params: [Q, { limit: 1 }] });
  });

  it("passes the budget refusal on with Retry-After, and never caches node errors for long", async () => {
    upstream(429, { error: "ANON_COST_LIMITED" }, { "retry-after": "1200" });
    const limited = await get(JSON.stringify([Q]));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1200");

    upstream(200, { jsonrpc: "2.0", id: 1, error: { code: -32004, message: "query is too long" } });
    const refused = await get(JSON.stringify([Q]));
    expect(await refused.json()).toEqual({ error: { code: -32004, message: "query is too long" } });
    expect(refused.headers.get("cache-control")).toBe("no-store");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 200 })));
    expect((await get(JSON.stringify([Q]))).status).toBe(502);
  });

  it("is not a general Arkiv gateway: other apps' data never reaches the access key", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    for (const query of [
      "v = i32(1)",
      "app = str('other')",
      "app = str('nexora') OR app = str('other')",
      "app = str('nexora') AND kind = str('shift') OR v = i32(1)",
      "app = str('nexora') AND (kind = str('shift'))) OR (v = i32(1)",
      "app = str('nexoraX') AND v = i32(1)",
      "$key = key(0x12)",
    ]) {
      expect(isNexoraQuery(query), query).toBe(false);
      expect((await get(JSON.stringify([query]))).status, query).toBe(400);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("forwards every query the app actually sends", () => {
    const wallets = Array.from({ length: 25 }, (_, i) => getAddress(`0x${(i + 1).toString(16).padStart(40, "0")}`));
    const keys = wallets.map((_, i) => `0x${(i + 1).toString(16).padStart(64, "0")}` as Hex);
    for (const query of [
      queryText(shiftPredicate({ city: "bengaluru", platform: "swiggy", vehicle: "ev_scooter", minPeriod: 202608, creators: wallets })),
      queryText(incidentPredicate({ type: "id_blocked", parent: keys[0], includeDemo: true })),
      queryText(entryPredicate({ keys, includeDemo: true })),
      queryText(trustListPredicate(wallets[0])),
      queryText(and([eq("app", str("nexora"))])),
      eq("$key", key(keys[3]!)).toString(),
      "app = str('nexora') AND name = str('Riders OR drivers (Pune)')",
    ]) {
      expect(isNexoraQuery(query), query).toBe(true);
    }
  });

  it("caps uncached queries per network, and says when to come back", async () => {
    upstream(200, { jsonrpc: "2.0", id: 1, result: { data: [] } });
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await get(JSON.stringify([`${Q} AND n = i32(${i})`]), "203.0.113.9")).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    const refused = await get(JSON.stringify([Q]), "203.0.113.9");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await get(JSON.stringify([Q]), "203.0.113.10")).status).toBe(200);
  });
});
