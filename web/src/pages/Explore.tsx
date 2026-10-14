import {
  CATEGORIES, LANGUAGES, PLATFORMS, SEASONS, TIERS, comboStats, decodeExperiment, fetchExperiments,
  fetchTrustList, fetchTrustLists, liveClient, summarise, type TrustList, type Category, type ExperimentFilters, type Language,
  type Platform, type RawEntity, type Season, type Tier,
} from "@nexora/ledger";
import { useEffect, useState } from "react";
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
  const lists = useAsync(() => fetchTrustLists(reader), [reader, revision]);
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
    const decoded = await fetchTrustList(reader, RECOMMENDED_TRUST_LIST);
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

function LiveFeed({ onNew }: { onNew: () => void }) {
  const { reader } = useArkiv();
  const { t, v } = useI18n();
  const [events, setEvents] = useState<{ key: string; text: string }[]>([]);
  const [status, setStatus] = useState("connecting");
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
      onEntityCreated: async (event) => {
        const entity = await reader.getEntity(event.entityKey).catch(() => null);
        if (!entity) return;
        const decoded = decodeExperiment(entity as RawEntity);
        if (!decoded.ok) return;
        const e = decoded.value;
        setEvents((prev) => [{ key: e.key, text: `${v(e.category)} · ${v(e.platform)} ${v(e.format)} · ${e.roiPct > 0 ? "+" : ""}${e.roiPct}%` }, ...prev].slice(0, 5));
        onNew();
      },
      onError: () => setStatus("reconnecting"),
    });
    return stop;
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
    return fetchExperiments(reader, filters);
  }, [reader, revision, category, platform, tier, lang, season, includeDemo, source.kind, list?.key, list?.members.length, wallet?.address]);

  const items = result.data?.items ?? [];
  const recommended = useRecommendedList();
  const combos = comboStats(items, { trusted: trustedSetFor(source, recommended) }).slice(0, 8);
  const stats = summarise(items);
  const sorted = [...items].sort((a, b) => b.roiPct - a.roiPct).slice(0, 60);

  return (
    <section>
      <p className="lead">{t("tagline")}</p>
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
            {sorted.map((e) => <ExperimentCard key={e.key} e={e} trusted={source.kind === "list" ? true : undefined} />)}
          </div>
        </>
      )}
      {creators && creators.length === 0 && <p className="muted">{t("connectToSeeMine")}</p>}
    </section>
  );
}
