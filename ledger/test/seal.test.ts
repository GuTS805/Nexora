import { describe, expect, it } from "vitest";
import { SEAL_ITERATIONS, fromBase64, isSealedBox, seal, toBase64, unseal } from "../src/index.ts";
import { storedShift } from "./fixtures.ts";

describe("sealing", () => {
  it("round trips and fails closed on a wrong passphrase or tampering", async () => {
    const box = await seal({ grossInr: 1_180, costsInr: 240, hours: 10, orders: 17, note: "rain, two long waits" }, "correct horse battery");
    expect(await unseal(box, "correct horse battery")).toMatchObject({ orders: 17, hours: 10 });
    await expect(unseal(box, "wrong passphrase!")).rejects.toThrow(/Wrong passphrase/);
    const tampered = { ...box, ct: box.ct.slice(0, -4) + (box.ct.endsWith("AAAA") ? "BBBB" : "AAAA") };
    await expect(unseal(tampered, "correct horse battery")).rejects.toThrow();
    await expect(seal({ grossInr: 1 }, "short")).rejects.toThrow();
  });

  it("carries a sealed box through the codec", async () => {
    const sealed = await seal({ grossInr: 1_180 }, "correct horse battery");
    expect(storedShift({ sealed }).sealed?.alg).toBe("AES-256-GCM");
  });
});

describe("sealed box format", () => {
  it("recognises only well-formed boxes and refuses implausible work factors", async () => {
    const box = await seal({ note: "x" }, "correct horse battery");
    expect(isSealedBox(box)).toBe(true);
    expect(isSealedBox({ ...box, alg: "AES-128-CBC" })).toBe(false);
    expect(isSealedBox({ ...box, ct: "A".repeat(8_000) })).toBe(false);
    expect(isSealedBox(null)).toBe(false);
    await expect(unseal({ ...box, iter: 10 }, "correct horse battery")).rejects.toThrow(/iteration/);
    expect(box.iter).toBe(SEAL_ITERATIONS);
    expect(fromBase64(box.salt)).toHaveLength(16);
    expect(fromBase64(box.iv)).toHaveLength(12);
  });

  it("never puts the plaintext or passphrase in the box, and two seals of the same data differ", async () => {
    const a = await seal({ note: "late payout 4200" }, "correct horse battery");
    const b = await seal({ note: "late payout 4200" }, "correct horse battery");
    const text = JSON.stringify(a);
    expect(text).not.toContain("4200");
    expect(text).not.toContain("horse");
    expect(a.ct).not.toBe(b.ct);
    expect(toBase64(fromBase64(a.ct))).toBe(a.ct);
  });
});
