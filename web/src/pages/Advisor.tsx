import {
  CATEGORIES, LANGUAGES, SPEND_BAND_LABELS, TIERS, fetchExperiments, suggest,
  type Category, type ExperimentFilters, type Language, type Tier,
} from "@nexora/ledger";
import { useState } from "react";
import { useArkiv } from "../arkiv.tsx";
import { EntityLink, ErrorNote, Field, QueryBox, Roi, VocabSelect, useAsync, useSource } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { SourcePicker, cliFor, creatorsFor } from "./Explore.tsx";

export function Advisor() {
  const { reader, wallet, revision } = useArkiv();
  const { t, v } = useI18n();
  const [category, setCategory] = useState<Category | "">("tea_coffee");
  const [tier, setTier] = useState<Tier | "">("");
  const [lang, setLang] = useState<Language | "">("");
  const [band, setBand] = useState<number | "">("");
  const [includeDemo, setIncludeDemo] = useState(true);
  const [source, setSource, list] = useSource();

  const creators = creatorsFor(source, wallet, list?.members);
  const filters: ExperimentFilters = {
    category: category || undefined, tier: tier || undefined, lang: lang || undefined,
    // Results within one band either side of the seller's budget are comparable; outside it they mislead.
    minBand: band === "" ? undefined : Math.max(0, band - 1),
    maxBand: band === "" ? undefined : band + 1,
    includeDemo, creators,
  };
  const result = useAsync(async () => {
    if (!category || (source.kind === "list" && !list) || (creators && creators.length === 0)) return null;
    const outcome = await fetchExperiments(reader, filters);
    return { outcome, suggestions: suggest(outcome.items) };
  }, [reader, revision, category, tier, lang, band, includeDemo, source.kind, list?.key, wallet?.address]);

  return (
    <section>
      <h2>{t("navAdvisor")}</h2>
      <p className="muted">Pick what you sell and where your buyers are. Suggestions come only from experiments other sellers published on Arkiv — every one links to its evidence.</p>
      <div className="filters">
        <Field label="category"><VocabSelect list={CATEGORIES} value={category} onChange={setCategory} /></Field>
        <Field label="tier"><VocabSelect list={TIERS} value={tier} onChange={setTier} any /></Field>
        <Field label="lang"><VocabSelect list={LANGUAGES} value={lang} onChange={setLang} any /></Field>
        <label className="field">
          <span>Your budget</span>
          <select value={band} onChange={(e) => setBand(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">{t("any")}</option>
            {SPEND_BAND_LABELS.map((label, i) => <option key={label} value={i}>{label}</option>)}
          </select>
        </label>
        <SourcePicker source={source} setSource={setSource} />
      </div>
      <label className="check"><input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} /> {t("showDemo")}</label>
      <ErrorNote error={result.error} />
      {result.loading && <p className="muted">{t("loading")}</p>}
      {result.data && (
        <>
          <p className="muted">Based on {result.data.outcome.items.length} matching experiments from {new Set(result.data.outcome.items.map((e) => e.creator)).size} sellers.</p>
          {result.data.suggestions.length === 0 && (
            <p className="card">Not enough independent evidence yet for this combination. A combo needs results from at least two different sellers before it is suggested. Run a small test and <a href="#/log">publish your result</a> — you will be the evidence for the next seller.</p>
          )}
          <ol className="suggestions">
            {result.data.suggestions.map((s, i) =>
              s.kind === "proven" ? (
                <li key={i} className="card">
                  <h3>Try {v(s.combo.platform)} · {v(s.combo.format)} <Roi value={Math.round(s.combo.medianRoi)} /></h3>
                  <p>{s.reason}.</p>
                  <p className="small muted">Evidence: {s.combo.evidence.slice(0, 6).map((key) => <span key={key}><EntityLink entityKey={key} /> </span>)}{s.combo.evidence.length > 6 && `+${s.combo.evidence.length - 6} more`}</p>
                </li>
              ) : (
                <li key={i} className="card explore">
                  <h3>Explore: {v(s.platform)} · {v(s.format)}</h3>
                  <p>{s.reason}. Neighbour of {v(s.basedOn.platform)} · {v(s.basedOn.format)}.</p>
                  <a href={`#/log?platform=${s.platform}&format=${s.format}&category=${category}`}>Log this experiment when it finishes →</a>
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
