import { readGuides } from "./cache.ts";
import { CITY_STATE, type City, type Guide, type Platform, type WorkType } from "nexora-ledger";
import { useArkiv } from "./arkiv.tsx";
import { Addr, ExplorerEntity, useAsync } from "./components.tsx";
import { GUIDE_CURATOR } from "./config.ts";
import { AsOf } from "./history.tsx";
import { useI18n } from "./i18n.tsx";
import guideFixtures from "../../arkiv/guides.json";
import guideKeys from "../../arkiv/guides-onchain.json";

/** Guides from the curator this app trusts by default (the recommended trust list's curator). */
export function useGuides() {
  const { reader } = useArkiv();
  return useAsync(async () => {
    if (import.meta.env.VITE_README_CAPTURE === "1") {
      return {
        items: guideFixtures.guides.map((guide) => ({
          ...guide,
          key: guideKeys.guides.find((item) => item.scope === guide.scope && item.topic === guide.topic)?.key ?? "0x0",
          creator: GUIDE_CURATOR,
          owner: GUIDE_CURATOR,
          expiresAt: 0n,
        })) as unknown as Guide[],
        rejected: [], query: "README capture fixture from arkiv/guides.json", truncated: false, blockNumber: undefined,
      };
    }
    return GUIDE_CURATOR ? readGuides(reader, GUIDE_CURATOR) : null;
  }, [reader]);
}

/** A guide's wording in the reader's language, falling back to English where there is no translation. */
export function useGuideText(guide: Guide) {
  const { lang } = useI18n();
  const hi = lang === "hi" ? guide.hi : undefined;
  return {
    title: hi?.title ?? guide.title,
    status: hi?.status ?? guide.status,
    points: hi?.points ?? guide.points,
    action: (i: number) => hi?.actions?.[i] ?? guide.actions?.[i]?.label ?? "",
  };
}

export function GuideCard({ guide, open = true }: { guide: Guide; open?: boolean }) {
  const { t, v } = useI18n();
  const text = useGuideText(guide);
  const scores = guide.scores ? Object.entries(guide.scores).sort((a, b) => b[1] - a[1]) : [];
  return (
    <details className="card guide" open={open}>
      <summary><h3>{text.title}</h3></summary>
      <p className="guide-status">{text.status}</p>
      <ul className="guide-points">{text.points.map((point, i) => <li key={i}>{point}</li>)}</ul>
      {scores.length > 0 && (
        <table className="guide-scores">
          <tbody>
            {scores.map(([platform, score]) => (
              <tr key={platform}>
                <th>{v(platform)}</th>
                <td><span className="score-bar" style={{ width: `${score * 10}%` }} /></td>
                <td className="mono">{score}/10</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {guide.actions && guide.actions.length > 0 && (
        <p className="row">{guide.actions.map((a, i) => <a key={a.url} className="button" href={a.url} target="_blank" rel="noopener noreferrer">{text.action(i)}</a>)}</p>
      )}
      <p className="small"><b>{t("guideSources", { date: guide.checked })}</b></p>
      <ul className="small guide-sources">
        {guide.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a></li>)}
      </ul>
      <p className="small muted">{t("guideCurated")} <Addr address={guide.creator} /> · <ExplorerEntity entityKey={guide.key} /></p>
      <AsOf entityKey={guide.key} />
    </details>
  );
}

/** "Fairwork 2024: 6/10", linking to the rating, for a platform the rating covers. */
export function RatingTag({ guides, platform }: { guides: readonly Guide[] | undefined; platform: Platform }) {
  const { t } = useI18n();
  const rating = guides?.find((g) => g.topic === "rating" && g.scores?.[platform] !== undefined);
  if (!rating) return null;
  return <a className="badge" href="#/rights" title={rating.title}>{t("ratingTag", { n: rating.scores![platform]! })}</a>;
}

/**
 * Which finding of the survey guide speaks to a kind of work: its first point is about cab drivers,
 * its third about delivery workers, its fifth about ID blocking (the published order in guides.json).
 */
function surveyPoint(work: WorkType | ""): number {
  if (work === "cab" || work === "bike_taxi" || work === "auto") return 0;
  if (work === "food_delivery" || work === "grocery_delivery" || work === "parcel_delivery") return 2;
  return 4;
}

/** Beside the comparison: what real workers in the same kind of work reported to an independent survey. */
export function SurveyNote({ guides, work }: { guides: readonly Guide[] | undefined; work: WorkType | "" }) {
  const survey = guides?.find((g) => g.topic === "survey");
  return survey ? <SurveyLine guide={survey} index={surveyPoint(work)} /> : null;
}

function SurveyLine({ guide, index }: { guide: Guide; index: number }) {
  const { t } = useI18n();
  const point = useGuideText(guide).points[index];
  if (!point) return null;
  return (
    <p className="card rights-note survey-note">
      <b>{t("surveyNoteTitle")}</b> {point} <a href="#/rights">{t("surveyNoteLink")} →</a>
    </p>
  );
}

/** On a report: the law where it happened, in one line, with a way to read it all. */
export function RightsNote({ city }: { city: City }) {
  const { t, v } = useI18n();
  const guides = useGuides();
  const state = CITY_STATE[city];
  const law = guides.data?.items.find((g) => g.topic === "law" && g.scope === state) ?? guides.data?.items.find((g) => g.topic === "law" && g.scope === "india");
  const text = law ? <RightsTitle guide={law} /> : null;
  if (!law) return null;
  return (
    <p className="card rights-note">
      <b>{t("rightsNoteTitle", { city: v(city) })}</b> {text} <a href={`#/rights?city=${city}`}>{t("rightsNoteLink")} →</a>
    </p>
  );
}

function RightsTitle({ guide }: { guide: Guide }) {
  return <>{useGuideText(guide).title}.</>;
}
