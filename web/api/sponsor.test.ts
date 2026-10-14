import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./sponsor.ts";

const post = (body: string) => POST(new Request("http://localhost/api/sponsor", { method: "POST", body, headers: { "content-type": "application/json" } }));

describe("gas sponsor input handling (no network reached)", () => {
  // Vitest runs the Vite config, whose dev-API plugin loads .env.local; start every case clean.
  const original = process.env.NEXORA_SPONSOR_KEY;
  beforeEach(() => {
    delete process.env.NEXORA_SPONSOR_KEY;
  });
  afterAll(() => {
    if (original !== undefined) process.env.NEXORA_SPONSOR_KEY = original;
  });

  it("is off, not broken, when no sponsor key is configured", async () => {
    const response = await post(JSON.stringify({ address: "0x1111111111111111111111111111111111111111" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/not configured/) });
  });

  it("rejects a malformed sponsor key as unconfigured rather than trying to sign with it", async () => {
    process.env.NEXORA_SPONSOR_KEY = "0x1234";
    expect((await post(JSON.stringify({ address: "0x1111111111111111111111111111111111111111" }))).status).toBe(503);
  });

  it("rejects bodies that are not JSON or carry no valid address", async () => {
    process.env.NEXORA_SPONSOR_KEY = `0x${"11".repeat(32)}`;
    for (const body of ["not json", "{}", JSON.stringify({ address: "0x123" }), JSON.stringify({ address: 42 })]) {
      const response = await post(body);
      expect(response.status, body).toBe(400);
    }
  });

  it("never caches responses", async () => {
    process.env.NEXORA_SPONSOR_KEY = `0x${"11".repeat(32)}`;
    const response = await post("{}");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
