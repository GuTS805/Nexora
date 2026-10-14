import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../api/read.ts";

const get = (q?: string) => GET(new Request(`http://localhost/api/read${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`));
const upstream = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers })));

describe("read fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects anything but the params of one arkiv_query, without reaching the network", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    for (const q of [undefined, "not json", "{}", "[]", "[42]", JSON.stringify(["v = i32(1)", { evil: 1 }]), JSON.stringify(["x".repeat(9_000)])]) {
      const response = await get(q);
      expect(response.status, String(q)).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("forwards only arkiv_query and lets the CDN share the answer", async () => {
    upstream(200, { jsonrpc: "2.0", id: 1, result: { data: [], blockNumber: "0x1" } });
    const response = await get(JSON.stringify(["v = i32(1)", { limit: 1 }]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { data: [], blockNumber: "0x1" } });
    expect(response.headers.get("cache-control")).toMatch(/s-maxage=30/);
    const sent = JSON.parse(((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).body as string);
    expect(sent).toMatchObject({ method: "arkiv_query", params: ["v = i32(1)", { limit: 1 }] });
  });

  it("passes the budget refusal on with Retry-After, and never caches node errors for long", async () => {
    upstream(429, { error: "ANON_COST_LIMITED" }, { "retry-after": "1200" });
    const limited = await get(JSON.stringify(["v = i32(1)"]));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1200");

    upstream(200, { jsonrpc: "2.0", id: 1, error: { code: -32004, message: "query is too long" } });
    const refused = await get(JSON.stringify(["v = i32(1)"]));
    expect(await refused.json()).toEqual({ error: { code: -32004, message: "query is too long" } });
    expect(refused.headers.get("cache-control")).toBe("no-store");
  });
});
