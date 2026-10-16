import { describe, expect, it } from "vitest";
import { SEAL_ITERATIONS, SEAL_PAD_BUCKETS, fromBase64, isSealedBox, padPlaintext, seal, toBase64, unseal } from "../src/index.ts";
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

describe("padding", () => {
  it("hides how long a note is: short and long notes seal to the same size, and still open", async () => {
    const short = await seal({ note: "late" }, "correct horse battery");
    const long = await seal({ note: "blocked after a customer complaint, no reason given, appealed twice" }, "correct horse battery");
    expect(short.ct.length).toBe(long.ct.length);
    expect(await unseal(long, "correct horse battery")).toEqual({ note: "blocked after a customer complaint, no reason given, appealed twice" });
    // A full 1,000-character note in Hindi still fits the largest bucket and the reader's size limit.
    const hindi = await seal({ note: "आ".repeat(1_000) }, "correct horse battery");
    expect(fromBase64(hindi.ct).length).toBe(SEAL_PAD_BUCKETS[2] + 16);
    expect(isSealedBox(hindi)).toBe(true);
  });

  it("pads to fixed buckets with spaces that JSON ignores", () => {
    expect(padPlaintext({ note: "x" })).toHaveLength(256);
    expect(padPlaintext({ note: "x".repeat(300) })).toHaveLength(1_024);
    expect(JSON.parse(new TextDecoder().decode(padPlaintext({ hours: 9 })))).toEqual({ hours: 9 });
  });
});
