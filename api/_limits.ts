/**
 * Abuse limits for the gas sponsor, kept apart from the handler so they can be tested.
 * State lives in memory per serverless instance (see docs/THREAT_MODEL.md, T12): it is a speed bump
 * against casual drains, not a guarantee, and the sponsor wallet's own balance floor is the backstop.
 */
export type LimitConfig = { hour: number; day: number; perIpDaily: number; globalHourly: number; maxTracked: number };

export const DEFAULT_LIMITS: LimitConfig = { hour: 3_600_000, day: 86_400_000, perIpDaily: 3, globalHourly: 200, maxTracked: 5_000 };

export type Refusal = { status: 429; error: string };

export function createLimiter(config: LimitConfig = DEFAULT_LIMITS) {
  const byAddress = new Map<string, number>();
  const byIp = new Map<string, number[]>();
  const inFlight = new Set<string>();
  let global: number[] = [];

  /** Drops expired entries so a long-lived instance cannot be grown without bound. */
  function prune(now: number) {
    global = global.filter((t) => now - t < config.hour);
    if (byAddress.size > config.maxTracked) for (const [key, at] of byAddress) if (now - at >= config.hour) byAddress.delete(key);
    if (byIp.size > config.maxTracked) for (const [key, hits] of byIp) if (!hits.some((t) => now - t < config.day)) byIp.delete(key);
  }

  return {
    /** Null when the request may proceed; it then holds the address until `release` is called. */
    admit(ip: string, address: string, now: number): Refusal | null {
      prune(now);
      const key = address.toLowerCase();
      const ipHits = (byIp.get(ip) ?? []).filter((t) => now - t < config.day);
      if (inFlight.has(key) || now - (byAddress.get(key) ?? -Infinity) < config.hour) return { status: 429, error: "This wallet was funded less than an hour ago." };
      if (ipHits.length >= config.perIpDaily) return { status: 429, error: "This network already received its free gas today." };
      if (global.length >= config.globalHourly) return { status: 429, error: "Hourly sponsor budget used up." };
      inFlight.add(key);
      return null;
    },
    /** Records a drip that was actually sent. */
    commit(ip: string, address: string, now: number) {
      const key = address.toLowerCase();
      byAddress.set(key, now);
      byIp.set(ip, [...(byIp.get(ip) ?? []).filter((t) => now - t < config.day), now]);
      global.push(now);
    },
    release(address: string) {
      inFlight.delete(address.toLowerCase());
    },
  };
}

/**
 * A sliding-window request cap per key (an IP), in memory per instance like the sponsor's limits.
 * Returns how many seconds to wait, or 0 when the request may go ahead.
 */
export function createRateLimit(max: number, windowMs: number, maxTracked = 5_000) {
  const hits = new Map<string, number[]>();
  return (key: string, now: number): number => {
    if (hits.size > maxTracked) for (const [k, times] of hits) if (!times.some((t) => now - t < windowMs)) hits.delete(k);
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1_000));
    }
    recent.push(now);
    hits.set(key, recent);
    return 0;
  };
}

/**
 * The caller's address as the platform reports it. Vercel sets `x-vercel-forwarded-for` itself, so
 * it cannot be spoofed by the client the way a forwarded-for header can on other hosts.
 */
export function clientIp(headers: Headers): string {
  const raw = headers.get("x-vercel-forwarded-for") ?? headers.get("x-real-ip") ?? headers.get("x-forwarded-for") ?? "local";
  return raw.split(",")[0]!.trim() || "local";
}
