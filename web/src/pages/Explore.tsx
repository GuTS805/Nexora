import { readShifts, readTrustList, readTrustLists } from "../cache.ts";
import { CITIES, DAY_LENGTHS, PLATFORMS, VEHICLES, WORK_TYPES, earningsStats, fetchEntries, isOneOf, liveClient, summariseShifts, type City, type DayLength, type EntryFilters, type IncidentFilters, type Platform, type ShiftFilters, type TrustList, type Vehicle, type WorkType } from "nexora-ledger";
import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { useArkiv } from "../arkiv.tsx";
import { ErrorNote, Field, Hourly, QueryBox, ShiftCard, VocabSelect, useAsync, useMonth, useSource, type Source } from "../components.tsx";
import { RECOMMENDED_TRUST_LIST } from "../config.ts";
import { Icon, PATHS } from "../art.tsx";
import { useI18n } from "../i18n.tsx";
import { PlatformLogo } from "../logos.tsx";

/** The months the period filter offers: this one and the five before it. */
export function recentPeriods(now = new Date()): number[] {
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return d.getFullYear() * 100 + d.getMonth() + 1;
  });
}

export function cliFor(command: string, filters: ShiftFilters & IncidentFilters, source: Source): string {
  const parts = ["npx tsx ledger/cli.ts", command];
  const add = (name: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "") parts.push(`--${name} ${value}`);
  };
  add("platform", filters.platform);
  add("work", filters.work);
  add("city", filters.city);
  add("vehicle", filters.vehicle);
  add("type", filters.type);
  add("since", filters.minPeriod);
  add("day", filters.day);
  add("min-cost", filters.minCostPct);
  if (filters.includeDemo) parts.push("--demo");
  if (source.kind === "list") add("trust", source.key);
  if (source.kind === "mine" && filters.creators?.[0]) add("creator", filters.creators[0]);
  return parts.join(" ");
}

const DAYS = Object.keys(DAY_LENGTHS) as DayLength[];

export const isDayLength = (value: unknown): value is DayLength => isOneOf(DAYS, value);

/** Day length, as a range over the published hours band: long days often pay a different rate per hour. */
export function DayPicker({ value, onChange }: { value: DayLength | ""; onChange: (value: DayLength | "") => void }) {
  const { t } = useI18n();
  return (
    <label className="field">
      <span>{t("dayLength")}</span>
      <select value={value} onChange={(e) => onChange(isDayLength(e.target.value) ? e.target.value : "")}>
        <option value="">{t("any")}</option>
        {DAYS.map((d) => <option key={d} value={d}>{t(`day_${d}`)}</option>)}
      </select>
    </label>
  );
}

export function SourcePicker({ source, setSource }: { source: Source; setSource: (s: Source) => void }) {
  const { reader, wallet, revision } = useArkiv();
  const { t } = useI18n();
  const lists = useAsync(() => readTrustLists(reader), [reader, revision]);
  const value = source.kind === "list" ? source.key : source.kind;
  return (
    <label className="field">
      <span>{t("whoseResults")}</span>
      <select
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "all" || next === "mine") setSource({ kind: next });
          else setSource({ kind: "list", key: next as `0x${string}` });
        }}
      >
        <option value="all">{t("allPublishers")}</option>
        {wallet && <option value="mine">{t("onlyMine")}</option>}
        {lists.data?.items.map((list) => (
          <option key={list.key} value={list.key}>{t("trustListOption", { name: list.name, n: list.members.length })}</option>
        ))}
      </select>
    </label>
  );
}

/** The suggested trust list (see config.ts), loaded from Arkiv. Null until loaded or if none exists. */
export function useRecommendedList(): TrustList | null {
  const { reader } = useArkiv();
  const result = useAsync(async () => {
    if (!RECOMMENDED_TRUST_LIST) return null;
    const decoded = await readTrustList(reader, RECOMMENDED_TRUST_LIST);
    return decoded.ok ? decoded.value : null;
  }, [reader]);
  return result.data ?? null;
}

/**
 * When the reader looks at "All workers", confirmation still has to come from trusted wallets.
 * Entries from everyone stay visible; only the confirmation count is restricted.
 */
export function trustedSetFor(source: Source, recommended: TrustList | null): ReadonlySet<string> | undefined {
  return source.kind === "all" && recommended ? new Set(recommended.members) : undefined;
}

/** Turns the source choice into a `$creator` filter. */
export function creatorsFor(source: Source, wallet: { address: `0x${string}` } | null, members: readonly `0x${string}`[] | undefined) {
  if (source.kind === "mine") return wallet ? [wallet.address] : [];
  if (source.kind === "list") return members ?? [];
  return undefined;
}

/**
 * Live feed over WebSocket entity events. Events carry no attributes, so instead of one `getEntity`
 * per event (one RPC per entity created anywhere on the chain), new keys are batched and checked
 * with a single `$key`-filtered query every few seconds — only Nexora entries come back.
 */
function LiveFeed({ onNew }: { onNew: () => void }) {
  const { reader } = useArkiv();
  const { t, v } = useI18n();
  const [events, setEvents] = useState<{ key: string; text: string }[]>([]);
  const [status, setStatus] = useState("connecting");
  const pending = useRef<Hex[]>([]);
  useEffect(() => {
    let client: ReturnType<typeof liveClient>;
    try {
      client = liveClient();
    } catch {
      setStatus("unavailable");
      return;
    }
    setStatus("live");
    const stop = client.watchEntityEvents({
      onEntityCreated: (event) => {
        pending.current.push(event.entityKey);
      },
      onError: () => setStatus("reconnecting"),
    });
    const timer = setInterval(async () => {
      const batch = pending.current.splice(0, 25);
      if (batch.length === 0) return;
      const found = await fetchEntries(reader, { keys: batch, includeDemo: true } satisfies EntryFilters, 25).catch(() => null);
      if (!found || found.items.length === 0) return;
      setEvents((prev) => [
        ...found.items.map((e) => ({
          key: e.key,
          text: `${v(e.platform)} · ${v(e.city)} · ${e.kind === "shift" ? t("perHour", { n: e.netHourly }) : v(e.type)}`,
        })),
        ...prev,
      ].slice(0, 5));
      onNew();
    }, 10_000);
    return () => {
      stop();
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader]);
  return (
    <div className="live">
      <span className={`dot ${status}`} /> {t("liveStatus", { status: t(`live_${status}` as "live_live") })}
      {events.map((event) => <a key={event.key} href={`#/e/${event.key}`} className="live-item">{t("liveNew", { text: event.text })}</a>)}
    </div>
  );
}

export function Explore() {
  const { reader, wallet, revision, bump } = useArkiv();
  const { t, v } = useI18n();
  const month = useMonth();
  const [platform, setPlatform] = useState<Platform | "">("");
  const [work, setWork] = useState<WorkType | "">("");
  const [city, setCity] = useState<City | "">("");
  const [vehicle, setVehicle] = useState<Vehicle | "">("");
  const [since, setSince] = useState<number | "">("");
  const [day, setDay] = useState<DayLength | "">("");
  const [includeDemo, setIncludeDemo] = useState(true);
  const [source, setSource, list] = useSource();

  const creators = creatorsFor(source, wallet, list?.members);
  const filters: ShiftFilters = {
    platform: platform || undefined, work: work || undefined, city: city || undefined, vehicle: vehicle || undefined,
    minPeriod: since === "" ? undefined : since, day: day || undefined, includeDemo, creators,
  };
  const waitingForList = source.kind === "list" && !list;
  const result = useAsync(async () => {
    if (waitingForList || (creators && creators.length === 0)) return null;
    return readShifts(reader, filters);
  }, [reader, revision, platform, work, city, vehicle, since, day, includeDemo, source.kind, list?.key, list?.members.length, wallet?.address]);

  const items = result.data?.items ?? [];
  const recommended = useRecommendedList();
  const groups = earningsStats(items, { trusted: trustedSetFor(source, recommended) }).slice(0, 10);
  const stats = summariseShifts(items);
  const latest = [...items].sort((a, b) => b.period - a.period || b.netHourly - a.netHourly).slice(0, 60);
  // The closing phrase of the tagline is highlighted, in either language.
  const tagline = t("tagline"), accent = t("taglineAccent");

  return (
    <section className="explore-page">
      <div className="hero">
        <div className="hero-copy">
          <p className="lead">{tagline.endsWith(accent) ? <>{tagline.slice(0, -accent.length)}<em>{accent}</em></> : tagline}</p>
          <div className="steps">
            <ol>
              <li><Icon>{PATHS.chart}</Icon><span>{t("step1")}</span></li>
              <li><Icon>{PATHS.list}</Icon><span>{t("step2")}</span></li>
              <li><Icon>{PATHS.shield}</Icon><span>{t("step3")}</span></li>
            </ol>
            <div className="row">
              <a className="button" href="#/compare">{t("ctaAdvice")}</a>
              <a className="button secondary" href="#/log">{t("ctaLog")}</a>
            </div>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="chart-card chart-back"><i /><i /><i /></div>
          <div className="chart-card chart-front"><div className="chart-lines"><i /><i /></div><div className="chart-bars"><i /><i /><i /><i /><i /><i /></div><span className="chart-arrow">₹</span></div>
        </div>
      </div>
      <div className="explore-panel">
        <LiveFeed onNew={bump} />
        <div className="filters">
          <Field label="city"><VocabSelect list={CITIES} value={city} onChange={setCity} any /></Field>
          <Field label="work"><VocabSelect list={WORK_TYPES} value={work} onChange={setWork} any /></Field>
          <Field label="platform"><VocabSelect list={PLATFORMS} value={platform} onChange={setPlatform} any /></Field>
          <Field label="vehicle"><VocabSelect list={VEHICLES} value={vehicle} onChange={setVehicle} any /></Field>
          <label className="field">
            <span>{t("since")}</span>
            <select value={since} onChange={(e) => setSince(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">{t("any")}</option>
              {recentPeriods().map((p) => <option key={p} value={p}>{month(p)}</option>)}
            </select>
          </label>
          <DayPicker value={day} onChange={setDay} />
          <SourcePicker source={source} setSource={setSource} />
        </div>
        <label className="check"><input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} /> {t("showDemo")}</label>
        {includeDemo && <p className="small muted">{t("demoDisclaimer")}</p>}

        <ErrorNote error={result.error} />
        {result.loading && <p className="muted">{t("loading")}</p>}
        {result.data && (
          <>
            <div className="stats">
              <div><Icon size={26}>{PATHS.list}</Icon><b>{stats.shifts}</b><span>{t("days")}</span></div>
              <div><Icon size={26}>{PATHS.users}</Icon><b>{stats.workers}</b><span>{t("workers")}</span></div>
              <div className="highlight"><span className="rupee">₹</span><b>₹{stats.medianHourly}</b><span>{t("medianHourly")}</span></div>
            </div>
            {groups.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t("colGroup")}</th><th className="key-col">{t("colMedian")}</th><th>{t("colMiddle")}</th><th>{t("colCosts")}</th><th>{t("colDays")}</th><th>{t("colWorkers")}</th></tr></thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={`${g.platform}${g.work}${g.city}`}>
                        <td className="group"><span className="with-logo"><PlatformLogo platform={g.platform} /><span><b>{v(g.platform)}</b> · {v(g.work)}{g.city ? ` · ${v(g.city)}` : ""}</span></span></td>
                        <td data-label={t("colMedian")}><Hourly value={g.medianHourly} /></td>
                        <td className="muted" data-label={t("colMiddle")}>₹{g.p25Hourly} … ₹{g.p75Hourly}</td>
                        <td data-label={t("colCosts")}>{g.medianCostPct}%</td>
                        <td data-label={t("colDays")}>{g.shifts}</td>
                        <td data-label={t("colWorkers")}>{g.workers}{!g.confirmed && <span className="badge warn" title={t("unconfirmedTitle")}>{t("unconfirmed")}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="small muted">{t("takeHomeNote")}</p>
            <QueryBox query={result.data.query} block={result.data.blockNumber} cli={cliFor("earnings", filters, source)} rejected={result.data.rejected} />
            {latest.length === 0 && <p className="muted">{t("empty")}</p>}
            <div className="grid">
              {latest.map((e) => <ShiftCard key={e.key} e={e} trusted={source.kind === "list" ? true : undefined} block={result.data?.blockNumber} />)}
            </div>
          </>
        )}
        {creators && creators.length === 0 && <p className="muted">{t("connectToSeeMine")}</p>}
      </div>
    </section>
  );
}
