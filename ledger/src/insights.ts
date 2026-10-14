import type { Address, Hex } from "viem";
import type { Incident, Shift } from "./codec.ts";
import { previousPeriod, type City, type IncidentType, type Platform, type WorkType } from "./schema.ts";

export type InsightOptions = {
  /**
   * Wallets the reader trusts (e.g. a union's trust list). When given, only these count toward
   * "confirmed" — everyone's entries are still shown and included in the figures, but free throwaway
   * wallets (or a platform's own staff) cannot manufacture independent confirmation.
   */
  trusted?: ReadonlySet<string> | undefined;
};

/** A figure needs this many independent (and, if a trust set is given, trusted) workers behind it. */
export const MIN_WORKERS_FOR_CONFIRMED = 2;

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lo = sorted[lower] ?? 0;
  const hi = sorted[upper] ?? lo;
  return lo + (hi - lo) * (position - lower);
}

/**
 * Confidence grows with independent workers, not rows: k / (k + 2). One worker → ⅓, five → ~0.71.
 * A single wallet cannot make its own claim look certain by publishing many times.
 */
export function confidence(workers: number): number {
  return workers / (workers + 2);
}

const lower = (address: string) => address.toLowerCase();

function countWorkers(creators: Iterable<Address>, trusted: Set<string> | undefined) {
  const distinct = new Set<string>([...creators].map(lower));
  return { workers: distinct.size, trustedWorkers: trusted ? [...distinct].filter((c) => trusted.has(c)).length : distinct.size };
}

function groupBy<T>(rows: readonly T[], id: (row: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = id(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()];
}

export type EarningsGroup = {
  platform: Platform;
  work: WorkType;
  /** Null when the group spans several cities (a city-wide comparison is filtered by the query). */
  city: City | null;
  shifts: number;
  /** Distinct `$creator` wallets. One wallet publishing fifty days still counts once here. */
  workers: number;
  /** Distinct creators on the reader's trust set; equals `workers` when none was given. */
  trustedWorkers: number;
  confirmed: boolean;
  /** Take-home per logged-in hour after costs, in rupees. */
  medianHourly: number;
  p25Hourly: number;
  p75Hourly: number;
  medianCostPct: number;
  /** Share of days on which the incentive target was met, among days that had one. */
  incentiveHitRate: number | null;
  evidence: Hex[];
};

function summariseGroup(group: Shift[], trusted: Set<string> | undefined, city: City | null): EarningsGroup {
  const first = group[0]!;
  const hourly = group.map((s) => s.netHourly).sort((a, b) => a - b);
  const costs = group.map((s) => s.costPct).sort((a, b) => a - b);
  const { workers, trustedWorkers } = countWorkers(group.map((s) => s.creator), trusted);
  const withTarget = group.filter((s) => s.incentive !== "none");
  return {
    platform: first.platform,
    work: first.work,
    city,
    shifts: group.length,
    workers,
    trustedWorkers,
    confirmed: trustedWorkers >= MIN_WORKERS_FOR_CONFIRMED,
    medianHourly: Math.round(quantile(hourly, 0.5)),
    p25Hourly: Math.round(quantile(hourly, 0.25)),
    p75Hourly: Math.round(quantile(hourly, 0.75)),
    medianCostPct: Math.round(quantile(costs, 0.5)),
    incentiveHitRate: withTarget.length === 0 ? null : withTarget.filter((s) => s.incentive === "met").length / withTarget.length,
    evidence: group.map((s) => s.key),
  };
}

/**
 * Earnings per platform · work · city. Confirmed groups come first, then by how many trusted workers
 * back them, so a figure one wallet repeats never outranks one that many workers report.
 */
export function earningsStats(shifts: readonly Shift[], options: InsightOptions = {}): EarningsGroup[] {
  const trusted = options.trusted ? new Set([...options.trusted].map(lower)) : undefined;
  return groupBy(shifts, (s) => `${s.platform}|${s.work}|${s.city}`)
    .map((group) => summariseGroup(group, trusted, group[0]!.city))
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.trustedWorkers - a.trustedWorkers || b.shifts - a.shifts);
}

export type PlatformComparison = EarningsGroup & {
  /** Median change against the previous month, in percent; null without two confirmed months. */
  monthChangePct: number | null;
  incidents: number;
};

/**
 * "Which platform pays best for my kind of work, here?" The query narrows city (and work), this
 * ranks platforms by median take-home per hour — confirmed figures first, so an unconfirmed claim
 * of ₹400/hour cannot top the list. Incidents reported on the same platform sit beside the pay.
 */
export function comparePlatforms(
  shifts: readonly Shift[],
  incidents: readonly Incident[] = [],
  options: InsightOptions = {},
): PlatformComparison[] {
  const trusted = options.trusted ? new Set([...options.trusted].map(lower)) : undefined;
  return groupBy(shifts, (s) => `${s.platform}|${s.work}`)
    .map((group) => {
      const cities = new Set(group.map((s) => s.city));
      const stats = summariseGroup(group, trusted, cities.size === 1 ? group[0]!.city : null);
      return {
        ...stats,
        monthChangePct: monthChange(group, trusted),
        incidents: incidents.filter((i) => i.platform === stats.platform && i.work === stats.work).length,
      };
    })
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.medianHourly - a.medianHourly);
}

/**
 * Median take-home in the latest month versus the month before. Both months need confirmed figures,
 * otherwise a single wallet could fake a "pay cut" or a "raise".
 */
export function monthChange(shifts: readonly Shift[], trustedSet?: ReadonlySet<string>): number | null {
  if (shifts.length === 0) return null;
  const trusted = trustedSet ? new Set([...trustedSet].map(lower)) : undefined;
  const latest = Math.max(...shifts.map((s) => s.period));
  const months = [latest, previousPeriod(latest)].map((period) => shifts.filter((s) => s.period === period));
  const [now, before] = months as [Shift[], Shift[]];
  const ok = (rows: Shift[]) => countWorkers(rows.map((s) => s.creator), trusted).trustedWorkers >= MIN_WORKERS_FOR_CONFIRMED;
  if (!ok(now) || !ok(before)) return null;
  const median = (rows: Shift[]) => quantile(rows.map((s) => s.netHourly).sort((a, b) => a - b), 0.5);
  const previous = median(before);
  if (previous <= 0) return null;
  return Math.round(((median(now) - previous) / previous) * 100);
}

export type IncidentStats = {
  type: IncidentType;
  reports: number;
  workers: number;
  trustedWorkers: number;
  confirmed: boolean;
  medianDaysLost: number;
  /** Share of reports where the platform gave no reason. */
  noReasonShare: number;
  resolvedShare: number;
  evidence: Hex[];
};

/**
 * Keys of original reports that are sorted out: marked resolved when published, or by a later
 * update (an entry whose `parent` is the report) from the **same** wallet. A "same here" report
 * from someone else that happens to be resolved says nothing about the original worker's case.
 */
export function resolvedReports(incidents: readonly Incident[]): Set<string> {
  const authorOf = new Map(incidents.filter((i) => !i.parent).map((i) => [i.key as string, lower(i.creator)]));
  const resolved = new Set<string>();
  for (const i of incidents) {
    if (!i.resolved) continue;
    if (!i.parent) resolved.add(i.key);
    else if (authorOf.get(i.parent) === lower(i.creator)) resolved.add(i.parent);
  }
  return resolved;
}

/**
 * What happens to workers, per incident type. Follow-ups (entries with a parent) are updates to a
 * report already counted, so they are left out of the counts and only change "resolved".
 */
export function incidentStats(incidents: readonly Incident[], options: InsightOptions = {}): IncidentStats[] {
  const trusted = options.trusted ? new Set([...options.trusted].map(lower)) : undefined;
  const resolved = resolvedReports(incidents);
  const originals = incidents.filter((i) => !i.parent);
  return groupBy(originals, (i) => i.type)
    .map((group) => {
      const { workers, trustedWorkers } = countWorkers(group.map((i) => i.creator), trusted);
      return {
        type: group[0]!.type,
        reports: group.length,
        workers,
        trustedWorkers,
        confirmed: trustedWorkers >= MIN_WORKERS_FOR_CONFIRMED,
        medianDaysLost: Math.round(quantile(group.map((i) => i.daysLost).sort((a, b) => a - b), 0.5)),
        noReasonShare: group.filter((i) => !i.reasonGiven).length / group.length,
        resolvedShare: group.filter((i) => resolved.has(i.key)).length / group.length,
        evidence: group.map((i) => i.key),
      };
    })
    .sort((a, b) => b.reports - a.reports);
}

export function summariseShifts(shifts: readonly Shift[]) {
  const hourly = shifts.map((s) => s.netHourly).sort((a, b) => a - b);
  return {
    shifts: shifts.length,
    workers: new Set(shifts.map((s) => lower(s.creator))).size,
    medianHourly: Math.round(quantile(hourly, 0.5)),
  };
}
