import { readIncidents } from "../cache.ts";
import { CITIES, INCIDENT_TYPES, PLATFORMS, incidentStats, isOneOf, resolvedReports, type City, type IncidentFilters, type IncidentType, type Platform } from "@nexora/ledger";
import { useMemo, useState } from "react";
import { useArkiv } from "../arkiv.tsx";
import { ErrorNote, Field, IncidentCard, QueryBox, VocabSelect, useAsync, useSource } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { SourcePicker, cliFor, creatorsFor, trustedSetFor, useRecommendedList } from "./Explore.tsx";

export function Incidents() {
  const { reader, wallet, revision } = useArkiv();
  const { t, v } = useI18n();
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
    return readIncidents(reader, filters);
  }, [reader, revision, platform, city, type, includeDemo, source.kind, list?.key, list?.members.length, wallet?.address]);

  const items = result.data?.items ?? [];
  const stats = incidentStats(items, { trusted: trustedSetFor(source, recommended) });
  // Updates point at their original through `parent`; cards show how many each original has.
  const updates = new Map<string, number>();
  for (const i of items) if (i.parent) updates.set(i.parent, (updates.get(i.parent) ?? 0) + 1);
  const originals = items.filter((i) => !i.parent).sort((a, b) => b.period - a.period);
  const resolved = resolvedReports(items);

  return (
    <section>
      <h2>{t("navIncidents")}</h2>
      <p className="muted">{t("incidentsIntro")}</p>
      <div className="filters">
        <Field label="incidentType"><VocabSelect list={INCIDENT_TYPES} value={type} onChange={setType} any /></Field>
        <Field label="platform"><VocabSelect list={PLATFORMS} value={platform} onChange={setPlatform} any /></Field>
        <Field label="city"><VocabSelect list={CITIES} value={city} onChange={setCity} any /></Field>
        <SourcePicker source={source} setSource={setSource} />
      </div>
      <label className="check"><input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} /> {t("showDemo")}</label>
      {includeDemo && <p className="small muted">{t("demoDisclaimer")}</p>}
      <ErrorNote error={result.error} />
      {result.loading && <p className="muted">{t("loading")}</p>}
      {result.data && (
        <>
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
          <QueryBox query={result.data.query} block={result.data.blockNumber} cli={cliFor("incidents", filters, source)} rejected={result.data.rejected} />
          {originals.length === 0 && <p className="muted">{t("empty")}</p>}
          <div className="grid">
            {originals.map((e) => <IncidentCard key={e.key} e={e} trusted={source.kind === "list" ? true : undefined} block={result.data?.blockNumber} updates={updates.get(e.key)} resolved={resolved.has(e.key)} />)}
          </div>
        </>
      )}
      {creators && creators.length === 0 && <p className="muted">{t("connectToSeeMine")}</p>}
    </section>
  );
}
