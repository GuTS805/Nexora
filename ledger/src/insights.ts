import type { Address, Hex } from "viem";
import type { Experiment } from "./codec.ts";
import { FORMATS, PLATFORMS, type Format, type Platform } from "./schema.ts";

export type ComboStats = {
  platform: Platform;
  format: Format;
  count: number;
  /** Distinct `$creator` wallets. One wallet publishing fifty rows still counts once here. */
  publishers: number;
  medianRoi: number;
  p25Roi: number;
  p75Roi: number;
  winRate: number;
  /** Median ROI shrunk toward zero when few independent publishers back it. */
  score: number;
  evidence: Hex[];
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
 * ~0.71. That is the cheap, explainable Sybil dampener — a single wallet cannot make its own combo
 * look certain by publishing many times. Trust lists are the stronger defence.
 */
export function confidence(publishers: number): number {
  return publishers / (publishers + 2);
}

export function comboStats(experiments: readonly Experiment[]): ComboStats[] {
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
    const publishers = new Set<Address>(group.map((e) => e.creator)).size;
    const medianRoi = quantile(rois, 0.5);
    stats.push({
      platform: first.platform,
      format: first.format,
      count: group.length,
      publishers,
      medianRoi,
      p25Roi: quantile(rois, 0.25),
      p75Roi: quantile(rois, 0.75),
      winRate: group.filter((e) => e.roiPct > 0).length / group.length,
      score: Math.round(medianRoi * confidence(publishers)),
      evidence: group.map((e) => e.key),
    });
  }
  return stats.sort((a, b) => b.score - a.score || b.publishers - a.publishers);
}

export type Suggestion =
  | { kind: "proven"; combo: ComboStats; reason: string }
  | { kind: "explore"; platform: Platform; format: Format; basedOn: ComboStats; reason: string };

/**
 * Exploit what independent sellers already proved, and spend a small slice of budget exploring one
 * neighbouring combo of the leader that nobody has tested enough yet — the explore/exploit split that
 * keeps the shared memory learning instead of everyone copying the same ad.
 */
export const MIN_PUBLISHERS_FOR_PROOF = 2;

export function suggest(experiments: readonly Experiment[], take = 3): Suggestion[] {
  const combos = comboStats(experiments);
  // A combo only one wallet vouches for is a claim, not evidence — however many rows it wrote.
  const proven = combos.filter((c) => c.score > 0 && c.publishers >= MIN_PUBLISHERS_FOR_PROOF).slice(0, take);
  const suggestions: Suggestion[] = proven.map((combo) => ({
    kind: "proven",
    combo,
    reason: `${combo.publishers} independent seller(s), median ROI ${combo.medianRoi}%, ${Math.round(combo.winRate * 100)}% of runs profitable`,
  }));
  const best = proven[0];
  if (best) {
    const tested = new Set(combos.filter((c) => c.publishers >= 2).map((c) => `${c.platform}|${c.format}`));
    const sameFormat = PLATFORMS.filter((p) => p !== best.platform && !tested.has(`${p}|${best.format}`));
    const samePlatform = FORMATS.filter((f) => f !== best.format && !tested.has(`${best.platform}|${f}`));
    const platform = samePlatform.length > 0 ? best.platform : sameFormat[0];
    const format = samePlatform.length > 0 ? samePlatform[0] : best.format;
    if (platform && format) {
      suggestions.push({
        kind: "explore",
        platform,
        format,
        basedOn: best,
        reason: `Under-tested neighbour of the current leader — try it with ~10% of budget and publish the result`,
      });
    }
  }
  return suggestions;
}

export type Lineage = { parent: Hex | null; children: Experiment[] };

export function summarise(experiments: readonly Experiment[]) {
  const publishers = new Set(experiments.map((e) => e.creator)).size;
  const profitable = experiments.filter((e) => e.roiPct > 0).length;
  return {
    experiments: experiments.length,
    publishers,
    profitableShare: experiments.length === 0 ? 0 : profitable / experiments.length,
  };
}
