import { describe, expect, it } from "vitest";
import { clientIp, createLimiter, DEFAULT_LIMITS } from "../../api/_limits.ts";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const D = "0x4444444444444444444444444444444444444444";

describe("sponsor abuse limits", () => {
  it("lets a fresh wallet through, then refuses it for an hour", () => {
    const limiter = createLimiter();
    expect(limiter.admit("1.1.1.1", A, 0)).toBeNull();
    limiter.commit("1.1.1.1", A, 0);
    limiter.release(A);
    expect(limiter.admit("2.2.2.2", A, 1000)?.status).toBe(429);
    expect(limiter.admit("2.2.2.2", A, DEFAULT_LIMITS.hour + 1)).toBeNull();
  });

  it("refuses the same wallet while its first request is still in flight, in any letter case", () => {
    const limiter = createLimiter();
    expect(limiter.admit("1.1.1.1", A, 0)).toBeNull();
    expect(limiter.admit("1.1.1.1", A.toUpperCase().replace("0X", "0x"), 1)?.status).toBe(429);
    limiter.release(A);
    expect(limiter.admit("1.1.1.1", A, 2)).toBeNull();
  });

  it("allows three wallets per network per day, not four", () => {
    const limiter = createLimiter();
    for (const [i, address] of [A, B, C].entries()) {
      expect(limiter.admit("9.9.9.9", address, i)).toBeNull();
      limiter.commit("9.9.9.9", address, i);
      limiter.release(address);
    }
    expect(limiter.admit("9.9.9.9", D, 10)?.error).toMatch(/network/);
    expect(limiter.admit("8.8.8.8", D, 10)).toBeNull();
    limiter.release(D);
    expect(limiter.admit("9.9.9.9", D, DEFAULT_LIMITS.day + 100)).toBeNull();
  });

  it("stops at the global hourly cap", () => {
    const limiter = createLimiter({ ...DEFAULT_LIMITS, globalHourly: 2 });
    limiter.commit("a", A, 0);
    limiter.commit("b", B, 0);
    expect(limiter.admit("c", C, 5)?.error).toMatch(/budget/);
  });

  it("forgets expired entries instead of growing forever", () => {
    const limiter = createLimiter({ ...DEFAULT_LIMITS, maxTracked: 2 });
    for (let i = 0; i < 6; i++) limiter.commit(`ip${i}`, `0x${String(i).repeat(40)}`, 0);
    expect(limiter.admit("fresh", D, DEFAULT_LIMITS.day + 1)).toBeNull();
  });
});

describe("client address", () => {
  it("prefers the header the platform sets over one the client can send", () => {
    const headers = new Headers({ "x-forwarded-for": "6.6.6.6", "x-vercel-forwarded-for": "7.7.7.7, 10.0.0.1" });
    expect(clientIp(headers)).toBe("7.7.7.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 1.1.1.1" }))).toBe("6.6.6.6");
    expect(clientIp(new Headers())).toBe("local");
  });
});
