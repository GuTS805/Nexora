import { readIncidents, readShifts } from "../cache.ts";
import { RatingTag, useGuides } from "../guides.tsx";
import { CITIES, VEHICLES, WORK_TYPES, comparePlatforms, isOneOf, type City, type DayLength, type PlatformComparison, type ShiftFilters, type Vehicle, type WorkType } from "nexora-ledger";
import { useMemo, useState } from "react";
import { useArkiv } from "../arkiv.tsx";
import { Change, EntityLink, ErrorNote, Field, Hourly, QueryBox, VocabSelect, WhatsAppButton, useAsync, useSource } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { SpeakButton } from "../voice.tsx";
import { PlatformLogo } from "../logos.tsx";
import { appUrl } from "../share.ts";
import { DayPicker, SourcePicker, cliFor, creatorsFor, isDayLength, trustedSetFor, useRecommendedList } from "./Explore.tsx";

/** Filters live in the URL, so a link shared on WhatsApp opens the same comparison. */
function useInitialParams() {
  return useMemo(() => new URLSearchParams(location.hash.split("?")[1] ?? ""), []);
}

export function Compare() {
  const { reader, wallet, revision } = useArkiv();
  const { t, v, ui: uiLang } = useI18n();
  const params = useInitialParams();
  const [city, setCity] = useState<City | "">(isOneOf(CITIES, params.get("city")) ? (params.get("city") as City) : "bengaluru");
  const [work, setWork] = useState<WorkType | "">(isOneOf(WORK_TYPES, params.get("work")) ? (params.get("work") as WorkType) : "food_delivery");
  const [vehicle, setVehicle] = useState<Vehicle | "">(isOneOf(VEHICLES, params.get("vehicle")) ? (params.get("vehicle") as Vehicle) : "");
  const [day, setDay] = useState<DayLength | "">(isDayLength(params.get("day")) ? (params.get("day") as DayLength) : "");
  const [includeDemo, setIncludeDemo] = useState(true);
  const [source, setSource, list] = useSource();

  const creators = creatorsFor(source, wallet, list?.members);
  const recommended = useRecommendedList();
  const guides = useGuides();
  const trusted = trustedSetFor(source, recommended);
  const filters: ShiftFilters = { city: city || undefined, work: work || undefined, vehicle: vehicle || undefined, day: day || undefined, includeDemo, creators };
  const result = useAsync(async () => {
    if (!city || (source.kind === "list" && !list) || (creators && creators.length === 0)) return null;
    const [shifts, incidents] = await Promise.all([
      readShifts(reader, filters),
      readIncidents(reader, { city: filters.city, work: filters.work, includeDemo, creators }),
    ]);
    return { shifts, ranking: comparePlatforms(shifts.items, incidents.items, { trusted }) };
  }, [reader, revision, city, work, vehicle, day, includeDemo, source.kind, list?.key, wallet?.address, recommended?.key]);

  function shareText(ranking: PlatformComparison[]): string {
    const query = new URLSearchParams({ city, ui: uiLang });
    if (work) query.set("work", work);
    if (vehicle) query.set("vehicle", vehicle);
    if (day) query.set("day", day);
    const confirmed = ranking.filter((r) => r.confirmed);
    const lines = confirmed.length
      ? confirmed.map((r) => t("shareLine", { platform: work ? v(r.platform) : `${v(r.platform)} (${v(r.work)})`, r: r.medianHourly, p: r.trustedWorkers })).join("\n")
      : t("shareNoData");
    return t("shareCompare", { work: work ? v(work) : t("any"), city: v(city), lines, url: appUrl(`#/compare?${query}`) });
  }

  return (
    <section>
      <h2>{t("navCompare")}</h2>
      <p className="muted">{t("compareIntro")}</p>
      <div className="filters">
        <Field label="city"><VocabSelect list={CITIES} value={city} onChange={setCity} /></Field>
        <Field label="work"><VocabSelect list={WORK_TYPES} value={work} onChange={setWork} any /></Field>
        <Field label="vehicle"><VocabSelect list={VEHICLES} value={vehicle} onChange={setVehicle} any /></Field>
        <DayPicker value={day} onChange={setDay} />
        <SourcePicker source={source} setSource={setSource} />
      </div>
      {source.kind === "all" && (
        <p className="card notice">
          {recommended ? t("trustedBasis", { name: recommended.name }) : t("sybilWarn")}
          {recommended && <> <button className="link" onClick={() => setSource({ kind: "list", key: recommended.key })}>{t("useList", { name: recommended.name })}</button></>}
        </p>
      )}
      <label className="check"><input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} /> {t("showDemo")}</label>
      {includeDemo && <p className="small muted">{t("demoDisclaimer")}</p>}
      <ErrorNote error={result.error} />
      {result.loading && <p className="muted">{t("loading")}</p>}
      {result.data && (
        <>
          <div className="row spread">
            <p className="muted">{t("basedOn", { n: result.data.shifts.items.length, m: new Set(result.data.shifts.items.map((e) => e.creator)).size })}</p>
            <span className="row">
              <SpeakButton text={shareText(result.data.ranking)} />
              <WhatsAppButton text={shareText(result.data.ranking)} />
            </span>
          </div>
          {!result.data.ranking.some((r) => r.confirmed) && (
            <p className="card">{t("notEnough")} <a href="#/log">{t("notEnoughLink")}</a> {t("notEnoughEnd")}</p>
          )}
          <ol className="suggestions">
            {result.data.ranking.map((r) => (
              <li key={`${r.platform}${r.work}`} className={r.confirmed ? "card" : "card explore"}>
                <h3>
                  <span className="with-logo"><PlatformLogo platform={r.platform} />{v(r.platform)} · {v(r.work)}</span> <Hourly value={r.medianHourly} />
                  {r.monthChangePct !== null && <> <Change value={r.monthChangePct} /> <span className="small muted">{t("monthChange")}</span></>}
                  {!r.confirmed && <span className="badge warn" title={t("unconfirmedTitle")}>{t("unconfirmed")}</span>}
                </h3>
                <p>
                  {r.confirmed
                    ? t("confirmedBy", { p: r.trustedWorkers, d: r.shifts, lo: r.p25Hourly, hi: r.p75Hourly, c: r.medianCostPct })
                    : t("unconfirmedReason", { p: r.trustedWorkers, d: r.shifts })}
                </p>
                <p className="tags">
                  {r.incentiveHitRate !== null && <span>{t("incentiveHit", { p: Math.round(r.incentiveHitRate * 100) })}</span>}
                  {r.incidents > 0 && <a href={`#/incidents?platform=${r.platform}&city=${city}`}>{t("incidentsHere", { n: r.incidents })}</a>}
                  <RatingTag guides={guides.data?.items} platform={r.platform} />
                </p>
                <p className="small muted">
                  {t("evidence")} {r.evidence.slice(0, 6).map((key) => <span key={key}><EntityLink entityKey={key} /> </span>)}
                  {r.evidence.length > 6 && t("more", { n: r.evidence.length - 6 })}
                </p>
              </li>
            ))}
          </ol>
          <QueryBox query={result.data.shifts.query} block={result.data.shifts.blockNumber} cli={cliFor("compare", filters, source)} rejected={result.data.shifts.rejected} truncated={result.data.shifts.truncated} />
        </>
      )}
    </section>
  );
}
