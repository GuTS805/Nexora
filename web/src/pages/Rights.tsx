import { CITIES, CITY_STATE, isOneOf, type City } from "nexora-ledger";
import { useMemo, useState } from "react";
import { ErrorNote, Field, QueryBox, VocabSelect } from "../components.tsx";
import { GUIDE_CURATOR } from "../config.ts";
import { GuideCard, useGuides } from "../guides.tsx";
import { useI18n } from "../i18n.tsx";
import { store } from "../storage.ts";

/** The worker's city: from a shared link, else the city they log under, else Bengaluru. */
function initialCity(): City {
  const fromLink = new URLSearchParams(location.hash.split("?")[1] ?? "").get("city");
  if (isOneOf(CITIES, fromLink)) return fromLink;
  try {
    const saved = (JSON.parse(store.get("profile") ?? "{}") as { city?: unknown }).city;
    if (isOneOf(CITIES, saved)) return saved;
  } catch {
    /* no saved profile */
  }
  return "bengaluru";
}

/**
 * What the law gives gig workers where they work, and how independent researchers rate the
 * platforms. Every point carries its sources and the day it was checked; the guides live on Arkiv,
 * signed by the curator, and any earlier wording can be read as of a past date.
 */
export function Rights() {
  const { t, v } = useI18n();
  const [city, setCity] = useState<City>(useMemo(initialCity, []));
  const guides = useGuides();
  const items = guides.data?.items ?? [];
  const state = CITY_STATE[city];
  const stateLaw = items.filter((g) => g.topic === "law" && g.scope === state);
  const india = items.filter((g) => g.topic === "law" && g.scope === "india");
  const ratings = items.filter((g) => g.topic === "rating");
  const surveys = items.filter((g) => g.topic === "survey");
  const claims = items.filter((g) => g.topic === "claim");
  const others = items.filter((g) => g.topic === "law" && g.scope !== "india" && g.scope !== state);

  return (
    <section>
      <h2>{t("navRights")}</h2>
      <p className="lead-small">{t("rightsIntro")}</p>
      <div className="filters">
        <Field label="city"><VocabSelect list={CITIES} value={city} onChange={(c) => c && setCity(c)} /></Field>
      </div>
      <ErrorNote error={guides.error} />
      {guides.loading && !guides.data && <p className="muted">{t("loading")}</p>}
      {guides.data && (
        <>
          <h3 className="guide-heading">{t("rightsWhere", { city: v(city) })}</h3>
          {stateLaw.length > 0 ? stateLaw.map((g) => <GuideCard key={g.key} guide={g} />) : <p className="card">{t("rightsNoState", { city: v(city) })}</p>}
          <h3 className="guide-heading">{t("rightsIndia")}</h3>
          {india.map((g) => <GuideCard key={g.key} guide={g} />)}
          <h3 className="guide-heading">{t("rightsRatings")}</h3>
          {ratings.map((g) => <GuideCard key={g.key} guide={g} />)}
          {surveys.length > 0 && (
            <>
              <h3 className="guide-heading">{t("rightsSurveys")}</h3>
              {surveys.map((g) => <GuideCard key={g.key} guide={g} />)}
            </>
          )}
          {claims.length > 0 && (
            <>
              <h3 className="guide-heading">{t("rightsClaims")}</h3>
              <p className="small muted">{t("rightsClaimsNote")}</p>
              {claims.map((g) => <GuideCard key={g.key} guide={g} />)}
            </>
          )}
          {others.length > 0 && (
            <>
              <h3 className="guide-heading">{t("rightsOther")}</h3>
              {others.map((g) => <GuideCard key={g.key} guide={g} open={false} />)}
            </>
          )}
          <p className="small muted">{t("rightsDisclaimer")}</p>
          <p><a href="#/kit">{t("kitLink")} →</a></p>
          <QueryBox query={guides.data.query} block={guides.data.blockNumber} cli={`npx -p nexora-ledger nexora guides --curator ${GUIDE_CURATOR}`} rejected={guides.data.rejected} />
        </>
      )}
    </section>
  );
}
