import { readExperiments } from "../cache.ts";
import { CATEGORIES, LANGUAGES, SPEND_BAND_LABELS, TIERS, bestTraits, isOneOf, suggest, type Category, type ExperimentFilters, type Language, type Suggestion, type Tier } from "@nexora/ledger";
import { useMemo, useState } from "react";
import { useArkiv } from "../arkiv.tsx";
import { EntityLink, ErrorNote, Field, QueryBox, Roi, VocabSelect, WhatsAppButton, useAsync, useSource } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { appUrl } from "../share.ts";
import { SourcePicker, cliFor, creatorsFor, trustedSetFor, useRecommendedList } from "./Explore.tsx";

/** Filters live in the URL, so a link shared on WhatsApp opens the same advice. */
function useInitialParams() {
  return useMemo(() => new URLSearchParams(location.hash.split("?")[1] ?? ""), []);
}

export function Advisor() {
  const { reader, wallet, revision } = useArkiv();
  const { t, v, lang: uiLang } = useI18n();
  const params = useInitialParams();
  const initialBand = Number(params.get("band"));
  const [category, setCategory] = useState<Category | "">(isOneOf(CATEGORIES, params.get("category")) ? (params.get("category") as Category) : "tea_coffee");
  const [tier, setTier] = useState<Tier | "">(isOneOf(TIERS, params.get("tier")) ? (params.get("tier") as Tier) : "");
  const [lang, setLang] = useState<Language | "">(isOneOf(LANGUAGES, params.get("lang")) ? (params.get("lang") as Language) : "");
  const [band, setBand] = useState<number | "">(Number.isInteger(initialBand) && params.has("band") && initialBand >= 0 && initialBand < SPEND_BAND_LABELS.length ? initialBand : "");
  const [includeDemo, setIncludeDemo] = useState(true);
  const [source, setSource, list] = useSource();

  const creators = creatorsFor(source, wallet, list?.members);
  const recommended = useRecommendedList();
  const trusted = trustedSetFor(source, recommended);
  const filters: ExperimentFilters = {
    category: category || undefined, tier: tier || undefined, lang: lang || undefined,
    // Results within one band either side of the seller's budget are comparable; outside it they mislead.
    minBand: band === "" ? undefined : Math.max(0, band - 1),
    maxBand: band === "" ? undefined : band + 1,
    includeDemo, creators,
  };
  const result = useAsync(async () => {
    if (!category || (source.kind === "list" && !list) || (creators && creators.length === 0)) return null;
    const outcome = await readExperiments(reader, filters, 400);
    return { outcome, suggestions: suggest(outcome.items, 3, { trusted }) };
  }, [reader, revision, category, tier, lang, band, includeDemo, source.kind, list?.key, wallet?.address, recommended?.key]);

  const combo = (platform: string, format: string) => `${v(platform)} · ${v(format)}`;

  function shareText(suggestions: Suggestion[]): string {
    const query = new URLSearchParams({ category, ui: uiLang });
    if (tier) query.set("tier", tier);
    if (lang) query.set("lang", lang);
    if (band !== "") query.set("band", String(band));
    const proven = suggestions.filter((s) => s.kind === "proven");
    const lines = proven.length
      ? proven.map((s) => t("shareLine", { combo: combo(s.combo.platform, s.combo.format), r: Math.round(s.combo.medianRoi), p: s.combo.trustedPublishers })).join("\n")
      : t("shareNoData");
    const where = [tier && v(tier), lang && v(lang), band !== "" && SPEND_BAND_LABELS[band]].filter(Boolean).join(", ") || t("any");
    return t("shareAdvice", { category: v(category), where, lines, url: appUrl(`#/advisor?${query}`) });
  }

  return (
    <section>
      <h2>{t("navAdvisor")}</h2>
      <p className="muted">{t("advisorIntro")}</p>
      <div className="filters">
        <Field label="category"><VocabSelect list={CATEGORIES} value={category} onChange={setCategory} /></Field>
        <Field label="tier"><VocabSelect list={TIERS} value={tier} onChange={setTier} any /></Field>
        <Field label="lang"><VocabSelect list={LANGUAGES} value={lang} onChange={setLang} any /></Field>
        <label className="field">
          <span>{t("yourBudget")}</span>
          <select value={band} onChange={(e) => setBand(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">{t("any")}</option>
            {SPEND_BAND_LABELS.map((label, i) => <option key={label} value={i}>{label}</option>)}
          </select>
        </label>
        <SourcePicker source={source} setSource={setSource} />
      </div>
      {source.kind === "all" && (
        <p className="card notice">
          {recommended ? t("trustedBasis", { name: recommended.name }) : t("sybilWarn")}
          {recommended && <> <button className="link" onClick={() => setSource({ kind: "list", key: recommended.key })}>{t("useList", { name: recommended.name })}</button></>}
        </p>
      )}
      <label className="check"><input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} /> {t("showDemo")}</label>
      <ErrorNote error={result.error} />
      {result.loading && <p className="muted">{t("loading")}</p>}
      {result.data && (
        <>
          <div className="row spread">
            <p className="muted">{t("basedOn", { n: result.data.outcome.items.length, m: new Set(result.data.outcome.items.map((e) => e.creator)).size })}</p>
            <WhatsAppButton text={shareText(result.data.suggestions)} />
          </div>
          {result.data.suggestions.length === 0 && (
            <p className="card">{t("notEnough")} <a href="#/log">{t("notEnoughLink")}</a> {t("notEnoughEnd")}</p>
          )}
          <ol className="suggestions">
            {result.data.suggestions.map((s, i) =>
              s.kind === "proven" ? (
                <li key={i} className="card">
                  <h3>{t("tryCombo", { combo: combo(s.combo.platform, s.combo.format) })} <Roi value={Math.round(s.combo.medianRoi)} /></h3>
                  {(() => {
                    const traits = bestTraits(result.data?.outcome.items ?? [], s.combo.platform, s.combo.format);
                    return traits.length > 0 && <p className="tags"><b>{t("worksBest")}</b> {traits.map((tr) => <span key={tr.dimension}>{v(tr.value)}</span>)}</p>;
                  })()}
                  <p>{t("provenReason", { p: s.combo.trustedPublishers, r: Math.round(s.combo.medianRoi), w: Math.round(s.combo.winRate * 100) })}</p>
                  <p className="small muted">
                    {t("evidence")} {s.combo.evidence.slice(0, 6).map((key) => <span key={key}><EntityLink entityKey={key} /> </span>)}
                    {s.combo.evidence.length > 6 && t("more", { n: s.combo.evidence.length - 6 })}
                  </p>
                </li>
              ) : (
                <li key={i} className="card explore">
                  <h3>{t("exploreCombo", { combo: combo(s.platform, s.format) })}</h3>
                  <p>{t("exploreReason", { combo: combo(s.basedOn.platform, s.basedOn.format) })}</p>
                  <a href={`#/log?platform=${s.platform}&format=${s.format}&category=${category}`}>{t("logWhenDone")}</a>
                </li>
              ),
            )}
          </ol>
          <QueryBox query={result.data.outcome.query} block={result.data.outcome.blockNumber} cli={cliFor("recommend", filters, source)} rejected={result.data.outcome.rejected} />
        </>
      )}
    </section>
  );
}
