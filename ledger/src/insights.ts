import type { Address, Hex } from "viem";
import type { Experiment } from "./codec.ts";
import { PLATFORMS, PLATFORM_FORMATS, type Format, type Platform } from "./schema.ts";

export type ComboStats = {
  platform: Platform;
  format: Format;
  count: number;
  /** Distinct `$creator` wallets. One wallet publishing fifty rows still counts once here. */
  publishers: number;
  /** Distinct creators that are on the reader's trust set; equals `publishers` when none was given. */
  trustedPublishers: number;
  medianRoi: number;
  p25Roi: number;
  p75Roi: number;
  winRate: number;
  /** Median ROI shrunk toward zero when few independent (trusted, if given) publishers back it. */
  score: number;
  evidence: Hex[];
};

export type InsightOptions = {
  /**
   * Wallets the reader trusts (e.g. a trust list's members). When given, only these count toward a
   * combo's confidence and toward "proven" — everyone's rows are still shown, but free throwaway
   * wallets cannot manufacture independent confirmation.
   */
  trusted?: ReadonlySet<string> | undefined;
};

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lo = sorted[lower] ?? 0;
  const hi = sorted[upper] ?? lo;
  return lo + (hi - lo) * (position - lower);
}

/**
 * Confidence grows with independent publishers, not rows: k / (k + 2). One publisher → ⅓, five →
 * ~0.71. A single wallet cannot make its own combo look certain by publishing many times.
 */
export function confidence(publishers: number): number {
  return publishers / (publishers + 2);
}

const lower = (address: string) => address.toLowerCase();

export function comboStats(experiments: readonly Experiment[], options: InsightOptions = {}): ComboStats[] {
  const trusted = options.trusted ? new Set([...options.trusted].map(lower)) : undefined;
  const groups = new Map<string, Experiment[]>();
  for (const experiment of experiments) {
    const id = `${experiment.platform}|${experiment.format}`;
    const group = groups.get(id);
    if (group) group.push(experiment);
    else groups.set(id, [experiment]);
  }
  const stats: ComboStats[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const rois = group.map((e) => e.roiPct).sort((a, b) => a - b);
    const creators = new Set<Address>(group.map((e) => e.creator));
    const publishers = creators.size;
    const trustedPublishers = trusted ? [...creators].filter((c) => trusted.has(lower(c))).length : publishers;
    const medianRoi = quantile(rois, 0.5);
    stats.push({
      platform: first.platform,
      format: first.format,
      count: group.length,
      publishers,
      trustedPublishers,
      medianRoi,
      p25Roi: quantile(rois, 0.25),
      p75Roi: quantile(rois, 0.75),
      winRate: group.filter((e) => e.roiPct > 0).length / group.length,
      score: Math.round(medianRoi * confidence(trustedPublishers)),
      evidence: group.map((e) => e.key),
    });
  }
  return stats.sort((a, b) => b.score - a.score || b.trustedPublishers - a.trustedPublishers);
}

export type Suggestion =
  | { kind: "proven"; combo: ComboStats }
  | { kind: "explore"; platform: Platform; format: Format; basedOn: ComboStats };

/** A combo needs this many independent (and, if a trust set is given, trusted) publishers. */
export const MIN_PUBLISHERS_FOR_PROOF = 2;

/**
 * Exploit what independent sellers already proved, and spend a small slice of budget exploring one
 * neighbouring combo of the leader that nobody has tested enough yet — the explore/exploit split that
 * keeps the shared memory learning instead of everyone copying the same ad. Exploration only
 * proposes formats the platform actually sells.
 */
export function suggest(experiments: readonly Experiment[], take = 3, options: InsightOptions = {}): Suggestion[] {
  const combos = comboStats(experiments, options);
  // A combo only one wallet vouches for is a claim, not evidence — however many rows it wrote.
  const proven = combos.filter((c) => c.score > 0 && c.trustedPublishers >= MIN_PUBLISHERS_FOR_PROOF).slice(0, take);
  const suggestions: Suggestion[] = proven.map((combo) => ({ kind: "proven", combo }));
  const best = proven[0];
  if (best) {
    const tested = new Set(combos.filter((c) => c.trustedPublishers >= MIN_PUBLISHERS_FOR_PROOF).map((c) => `${c.platform}|${c.format}`));
    const untested = (platform: Platform, format: Format) => !tested.has(`${platform}|${format}`);
    // Prefer another format on the same platform (cheapest change for the seller), then the same
    // format on another platform that sells it.
    const samePlatform = PLATFORM_FORMATS[best.platform].filter((f) => f !== best.format && untested(best.platform, f));
    const sameFormat = PLATFORMS.filter((p) => p !== best.platform && PLATFORM_FORMATS[p].includes(best.format) && untested(p, best.format));
    const pick: [Platform, Format] | undefined = samePlatform[0]
      ? [best.platform, samePlatform[0]]
      : sameFormat[0] ? [sameFormat[0], best.format] : undefined;
    if (pick) suggestions.push({ kind: "explore", platform: pick[0], format: pick[1], basedOn: best });
  }
  return suggestions;
}

export function summarise(experiments: readonly Experiment[]) {
  const publishers = new Set(experiments.map((e) => e.creator)).size;
  const profitable = experiments.filter((e) => e.roiPct > 0).length;
  return {
    experiments: experiments.length,
    publishers,
    profitableShare: experiments.length === 0 ? 0 : profitable / experiments.length,
  };
}
