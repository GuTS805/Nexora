import { readIncidents, readReplies } from "../cache.ts";
import {
  CITIES, INCIDENT_TYPES, PLATFORMS, answeredReports, explorerEntity, incidentStats, isOneOf, repliesTo, resolvedReports,
  type City, type IncidentFilters, type IncidentType, type Platform,
} from "nexora-ledger";
import { useMemo, useState } from "react";
import { useArkiv } from "../arkiv.tsx";
import { ErrorNote, Field, IncidentCard, QueryBox, VocabSelect, useAsync, useMonth, useSource } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { ESHRAM_URL } from "../letter.tsx";
import { SourcePicker, cliFor, creatorsFor, trustedSetFor, useRecommendedList } from "./Explore.tsx";

export function Incidents() {
  const { reader, wallet, revision } = useArkiv();
  const { t, v, lang } = useI18n();
  const month = useMonth();
  // Links from the Compare page open with a platform and city already chosen.
  const params = useMemo(() => new URLSearchParams(location.hash.split("?")[1] ?? ""), []);
  const [platform, setPlatform] = useState<Platform | "">(isOneOf(PLATFORMS, params.get("platform")) ? (params.get("platform") as Platform) : "");
  const [city, setCity] = useState<City | "">(isOneOf(CITIES, params.get("city")) ? (params.get("city") as City) : "");
  const [type, setType] = useState<IncidentType | "">("");
  const [includeDemo, setIncludeDemo] = useState(true);
  const [source, setSource, list] = useSource();

  const creators = creatorsFor(source, wallet, list?.members);
  const recommended = useRecommendedList();
  const filters: IncidentFilters = { platform: platform || undefined, city: city || undefined, type: type || undefined, includeDemo, creators };
  const result = useAsync(async () => {
    if ((source.kind === "list" && !list) || (creators && creators.length === 0)) return null;
    // Replies are fetched once for every report on the page; they carry no platform or city.
    const [incidents, replies] = await Promise.all([readIncidents(reader, filters), readReplies(reader, { includeDemo })]);
    return { ...incidents, replies: replies.items };
  }, [reader, revision, platform, city, type, includeDemo, source.kind, list?.key, list?.members.length, wallet?.address]);

  const items = result.data?.items ?? [];
  const replies = result.data?.replies ?? [];
  const stats = incidentStats(items, { trusted: trustedSetFor(source, recommended) });
  // Updates point at their original through `parent`; cards show how many each original has.
  const updates = new Map<string, number>();
  for (const i of items) if (i.parent) updates.set(i.parent, (updates.get(i.parent) ?? 0) + 1);
  const originals = items.filter((i) => !i.parent).sort((a, b) => b.period - a.period);
  const resolved = resolvedReports(items);
  const answered = answeredReports(originals, replies);
  // Replies count as the group's when they come from the wallet that runs the recommended trust list.
  const curator = recommended ? new Set([recommended.creator]) : undefined;
  const answeredByCurator = curator ? answeredReports(originals, replies, curator).size : 0;
  const latestReply = (key: string, creator: `0x${string}`) => repliesTo({ key: key as `0x${string}`, creator }, replies)[0]?.status;

  return (
    <section>
      <h2 className="no-print">{t("navIncidents")}</h2>
      <p className="muted no-print">{t("incidentsIntro")}</p>
      <div className="filters">
        <Field label="incidentType"><VocabSelect list={INCIDENT_TYPES} value={type} onChange={setType} any /></Field>
        <Field label="platform"><VocabSelect list={PLATFORMS} value={platform} onChange={setPlatform} any /></Field>
        <Field label="city"><VocabSelect list={CITIES} value={city} onChange={setCity} any /></Field>
        <SourcePicker source={source} setSource={setSource} />
      </div>
      <p className="small eshram no-print">{t("eshram")} <a href={ESHRAM_URL} target="_blank" rel="noreferrer">{t("eshramLink")}</a></p>
      <label className="check"><input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} /> {t("showDemo")}</label>
      {includeDemo && <p className="small muted">{t("demoDisclaimer")}</p>}
      <ErrorNote error={result.error} />
      {result.loading && <p className="muted">{t("loading")}</p>}
      {result.data && (
        <>
          <div className="print-only report-head">
            <h2>{t("reportTitle")}</h2>
            <p>{[type ? v(type) : t("reportAllTypes"), platform ? v(platform) : t("reportAllPlatforms"), city ? v(city) : t("reportAllCities")].join(" · ")}{includeDemo ? ` · ${t("syntheticDemo")}` : ""}</p>
            <p className="small">{t("reportGenerated", { date: new Date().toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN") })}</p>
            <p className="small">{t("reportVerify")}</p>
            <p className="small mono">{result.data.query}</p>
          </div>
          {originals.length > 0 && (
            <p className="answered">
              {t("answeredLine", { a: answered.size, n: originals.length })}
              {recommended && answered.size > 0 && <> {t("answeredTrusted", { a: answeredByCurator, name: recommended.name })}</>}
            </p>
          )}
          {originals.length > 0 && <button className="secondary no-print" onClick={() => window.print()}>{t("reportPrint")}</button>}
          {stats.length > 0 && (
            <div className="table-wrap">
              <table className="cards">
                <thead><tr><th>{t("colType")}</th><th>{t("colReports")}</th><th>{t("colWorkers")}</th><th>{t("colDaysLost")}</th><th>{t("colNoReason")}</th><th>{t("colResolved")}</th></tr></thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.type}>
                      <td className="group"><b>{v(s.type)}</b></td>
                      <td data-label={t("colReports")}>{s.reports}</td>
                      <td data-label={t("colWorkers")}>{s.workers}{!s.confirmed && <span className="badge warn" title={t("unconfirmedTitle")}>{t("unconfirmed")}</span>}</td>
                      <td data-label={t("colDaysLost")}>{s.medianDaysLost > 0 ? t("daysShort", { n: s.medianDaysLost }) : "—"}</td>
                      <td data-label={t("colNoReason")}>{Math.round(s.noReasonShare * 100)}%</td>
                      <td data-label={t("colResolved")}>{Math.round(s.resolvedShare * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <QueryBox query={result.data.query} block={result.data.blockNumber} cli={cliFor("incidents", filters, source)} rejected={result.data.rejected} truncated={result.data.truncated} />
          {originals.length === 0 && <p className="muted">{t("empty")}</p>}
          <ol className="print-only report-keys">
            {originals.map((e) => <li key={e.key}>{v(e.type)} · {v(e.platform)} · {v(e.city)} · {month(e.period)} · {t("daysLost")}: {e.daysLost}{resolved.has(e.key) ? ` · ${t("resolvedBadge")}` : ""}{(() => { const r = latestReply(e.key, e.creator); return r ? ` · ${t("replyBadge", { status: v(r) })}` : ""; })()}<br /><span className="mono">{explorerEntity(e.key)}</span></li>)}
          </ol>
          <div className="grid">
            {originals.map((e) => <IncidentCard key={e.key} e={e} trusted={source.kind === "list" ? true : undefined} block={result.data?.blockNumber} updates={updates.get(e.key)} resolved={resolved.has(e.key)} reply={latestReply(e.key, e.creator)} />)}
          </div>
        </>
      )}
      {creators && creators.length === 0 && <p className="muted">{t("connectToSeeMine")}</p>}
    </section>
  );
}
