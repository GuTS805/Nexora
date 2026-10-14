import { readExperiments, readTrustList, readTrustLists } from "../cache.ts";
import { CATEGORIES, LANGUAGES, PLATFORMS, SEASONS, TIERS, comboStats, fetchExperiments, liveClient, summarise, type TrustList, type Category, type ExperimentFilters, type Language, type Platform, type Season, type Tier } from "@nexora/ledger";
import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { useArkiv } from "../arkiv.tsx";
import { ErrorNote, ExperimentCard, Field, QueryBox, Roi, VocabSelect, useAsync, useSource, type Source } from "../components.tsx";
import { RECOMMENDED_TRUST_LIST } from "../config.ts";
import { useI18n } from "../i18n.tsx";

export function cliFor(command: string, filters: ExperimentFilters, source: Source): string {
  const parts = ["npx tsx ledger/cli.ts", command];
  const add = (name: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "") parts.push(`--${name} ${value}`);
  };
  add("category", filters.category);
  add("platform", filters.platform);
  add("tier", filters.tier);
  add("lang", filters.lang);
  add("season", filters.season);
  add("min-roi", filters.minRoi);
  add("min-band", filters.minBand);
  add("max-band", filters.maxBand);
  if (filters.includeDemo) parts.push("--demo");
  if (source.kind === "list") add("trust", source.key);
  if (source.kind === "mine" && filters.creators?.[0]) add("creator", filters.creators[0]);
  return parts.join(" ");
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

/** Turns the source choice into a `$creator` filter. */
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
 * When the reader looks at "All sellers", proof still has to come from trusted wallets. Rows from
 * everyone stay visible; only the confirmation count is restricted.
 */
export function trustedSetFor(source: Source, recommended: TrustList | null): ReadonlySet<string> | undefined {
  return source.kind === "all" && recommended ? new Set(recommended.members) : undefined;
}

export function creatorsFor(source: Source, wallet: { address: `0x${string}` } | null, members: readonly `0x${string}`[] | undefined) {
  if (source.kind === "mine") return wallet ? [wallet.address] : [];
  if (source.kind === "list") return members ?? [];
  return undefined;
}

/**
 * Live feed over WebSocket entity events. Events carry no attributes, so instead of one `getEntity`
 * per event (one RPC per entity created anywhere on the chain), new keys are batched and checked
 * with a single `$key`-filtered query every few seconds — only Nexora experiments come back.
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
      const found = await fetchExperiments(reader, { keys: batch, includeDemo: true }, 25).catch(() => null);
      if (!found || found.items.length === 0) return;
      setEvents((prev) => [
        ...found.items.map((e) => ({ key: e.key, text: `${v(e.category)} · ${v(e.platform)} ${v(e.format)} · ${e.roiPct > 0 ? "+" : ""}${e.roiPct}%` })),
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
  const [category, setCategory] = useState<Category | "">("");
  const [platform, setPlatform] = useState<Platform | "">("");
  const [tier, setTier] = useState<Tier | "">("");
  const [lang, setLang] = useState<Language | "">("");
  const [season, setSeason] = useState<Season | "">("");
  const [includeDemo, setIncludeDemo] = useState(true);
  const [source, setSource, list] = useSource();

  const creators = creatorsFor(source, wallet, list?.members);
  const filters: ExperimentFilters = {
    category: category || undefined, platform: platform || undefined, tier: tier || undefined,
    lang: lang || undefined, season: season || undefined, includeDemo, creators,
  };
  const waitingForList = source.kind === "list" && !list;
  const result = useAsync(async () => {
    if (waitingForList || (creators && creators.length === 0)) return null;
    return readExperiments(reader, filters);
  }, [reader, revision, category, platform, tier, lang, season, includeDemo, source.kind, list?.key, list?.members.length, wallet?.address]);

  const items = result.data?.items ?? [];
  const recommended = useRecommendedList();
  const combos = comboStats(items, { trusted: trustedSetFor(source, recommended) }).slice(0, 8);
  const stats = summarise(items);
  const sorted = [...items].sort((a, b) => b.roiPct - a.roiPct).slice(0, 60);
  // The closing phrase of the tagline is highlighted, in either language.
  const tagline = t("tagline"), accent = t("taglineAccent");

  return (
    <section className="explore-page">
      <div className="hero">
      <div className="hero-copy">
      <p className="lead">{tagline.endsWith(accent) ? <>{tagline.slice(0, -accent.length)}<em>{accent}</em></> : tagline}</p>
      <div className="steps">
        <ol>
          <li>{t("step1").replace(/^1\.\s*/, "")}</li>
          <li>{t("step2").replace(/^2\.\s*/, "")}</li>
          <li>{t("step3").replace(/^3\.\s*/, "")}</li>
        </ol>
        <div className="row">
          <a className="button" href="#/advisor">{t("ctaAdvice")}</a>
          <a className="button secondary" href="#/log">{t("ctaLog")}</a>
        </div>
      </div>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="chart-card chart-back"><i /><i /><i /></div>
        <div className="chart-card chart-front"><div className="chart-lines"><i /><i /></div><div className="chart-bars"><i /><i /><i /><i /><i /><i /></div><span className="chart-arrow">↗</span></div>
      </div>
      </div>
      <div className="explore-panel">
      <LiveFeed onNew={bump} />
      <div className="filters">
        <Field label="category"><VocabSelect list={CATEGORIES} value={category} onChange={setCategory} any /></Field>
        <Field label="platform"><VocabSelect list={PLATFORMS} value={platform} onChange={setPlatform} any /></Field>
        <Field label="tier"><VocabSelect list={TIERS} value={tier} onChange={setTier} any /></Field>
        <Field label="lang"><VocabSelect list={LANGUAGES} value={lang} onChange={setLang} any /></Field>
        <Field label="season"><VocabSelect list={SEASONS} value={season} onChange={setSeason} any /></Field>
        <SourcePicker source={source} setSource={setSource} />
      </div>
      <label className="check"><input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} /> {t("showDemo")}</label>

      <ErrorNote error={result.error} />
      {result.loading && <p className="muted">{t("loading")}</p>}
      {result.data && (
        <>
          <div className="stats">
            <div><b>{stats.experiments}</b><span>{t("experiments")}</span></div>
            <div><b>{stats.publishers}</b><span>{t("sellers")}</span></div>
            <div><b>{Math.round(stats.profitableShare * 100)}%</b><span>{t("profitable")}</span></div>
          </div>
          {combos.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t("colCombo")}</th><th>{t("colMedian")}</th><th>{t("colMiddle")}</th><th>{t("colRuns")}</th><th>{t("colSellers")}</th></tr></thead>
                <tbody>
                  {combos.map((c) => (
                    <tr key={`${c.platform}${c.format}`}>
                      <td>{v(c.platform)} · {v(c.format)}</td>
                      <td><Roi value={Math.round(c.medianRoi)} /></td>
                      <td className="muted">{Math.round(c.p25Roi)}% … {Math.round(c.p75Roi)}%</td>
                      <td>{c.count}</td>
                      <td>{c.publishers}{c.trustedPublishers < 2 && <span className="badge warn" title={t("unconfirmedTitle")}>{t("unconfirmed")}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <QueryBox query={result.data.query} block={result.data.blockNumber} cli={cliFor("query", filters, source)} rejected={result.data.rejected} />
          {sorted.length === 0 && <p className="muted">{t("empty")}</p>}
          <div className="grid">
            {sorted.map((e) => <ExperimentCard key={e.key} e={e} trusted={source.kind === "list" ? true : undefined} block={result.data?.blockNumber} />)}
          </div>
        </>
      )}
      {creators && creators.length === 0 && <p className="muted">{t("connectToSeeMine")}</p>}
      </div>
    </section>
  );
}
