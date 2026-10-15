import { afterEach, describe, expect, it, vi } from "vitest";
import { ArkivRateLimitError, TIRAMISU_RPC, defaultRpcUrl, explainError, isRateLimited, withReadFallback } from "../src/index.ts";

describe("read fallback transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends arkiv_query to the fallback only after a 429, and keeps other calls direct", async () => {
    const direct = vi.fn(async (_url: string, init: RequestInit) => {
      const { method, id } = JSON.parse(init.body as string) as { method: string; id: number };
      if (method === "arkiv_query") return new Response("{}", { status: 429, headers: { "retry-after": "1200" } });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: "0x10" }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", direct);
    const fallback = vi.fn(async (_url: string) => new Response(JSON.stringify({ result: { data: [], blockNumber: "0x10" } })));
    const transport = withReadFallback("https://rpc.example", "https://app.example/api/read", fallback as unknown as typeof fetch)({});

    await expect(transport.request({ method: "arkiv_query", params: ["v = i32(1)", { limit: 1 }] })).resolves.toEqual({ data: [], blockNumber: "0x10" });
    expect(fallback.mock.calls[0]![0]).toBe(`https://app.example/api/read?q=${encodeURIComponent(JSON.stringify(["v = i32(1)", { limit: 1 }]))}`);

    // Inside the Retry-After window the next query skips the exhausted RPC entirely.
    const directQueries = () => direct.mock.calls.filter(([, init]) => (init.body as string).includes("arkiv_query")).length;
    const before = directQueries();
    await transport.request({ method: "arkiv_query", params: ["v = i32(2)"] });
    expect(directQueries()).toBe(before);
    expect(fallback).toHaveBeenCalledTimes(2);

    // Balance-style calls never use the fallback.
    await expect(transport.request({ method: "eth_blockNumber" })).resolves.toBe("0x10");
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it("reports an exhausted fallback as the rate limit, not a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "60" } })));
    const fallback = vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "60" } }));
    const transport = withReadFallback("https://rpc.example", "https://app.example/api/read", fallback as unknown as typeof fetch)({});
    const error = await transport.request({ method: "arkiv_query", params: ["v = i32(1)"] }).catch((e: unknown) => e);
    expect(isRateLimited(error)).toBe(true);
  });

  it("on a host without the endpoint, shows the rate limit rather than a 404, but relays real node errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "900" } })));
    const missing = withReadFallback("https://rpc.example", "https://mirror.example/api/read", (async () => new Response("<html>404</html>", { status: 404 })) as unknown as typeof fetch)({});
    const error = await missing.request({ method: "arkiv_query", params: ["v = i32(1)"] }).catch((e: unknown) => e);
    expect(isRateLimited(error)).toBe(true);
    expect(explainError(error)).toMatch(/resets in about 15 min/);

    const relaying = withReadFallback("https://rpc.example", "https://app.example/api/read", (async () => new Response(JSON.stringify({ error: { message: "query is too long" } }))) as unknown as typeof fetch)({});
    await expect(relaying.request({ method: "arkiv_query", params: ["v = i32(1)"] })).rejects.toThrow("query is too long");
  });

  it("recognises the rate limit however deeply it is wrapped", () => {
    const wrapped = new Error("outer", { cause: new Error("middle", { cause: new ArkivRateLimitError(120) }) });
    expect(isRateLimited(wrapped)).toBe(true);
    expect(explainError(wrapped)).toMatch(/resets in about 2 min/);
    expect(isRateLimited(new Error("boom"))).toBe(false);
    expect(explainError(new Error("first line\nsecond line"))).toBe("first line");
  });

  it("uses ARKIV_RPC_URL only when it is an http(s) URL", () => {
    vi.stubEnv("ARKIV_RPC_URL", "https://rpc.example/key");
    expect(defaultRpcUrl()).toBe("https://rpc.example/key");
    vi.stubEnv("ARKIV_RPC_URL", "javascript:alert(1)");
    expect(defaultRpcUrl()).toBe(TIRAMISU_RPC);
    vi.unstubAllEnvs();
  });
});
