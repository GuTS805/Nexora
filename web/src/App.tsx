import { useEffect, useState } from "react";
import type { Hex } from "viem";
import mark from "./assets/mark.png";
import cityArt from "./assets/editorial/gig-work-city.jpg";
import incidentArt from "./assets/editorial/incident-report.jpg";
import evidenceArt from "./assets/editorial/ledger-evidence.jpg";
import notebookArt from "./assets/editorial/work-notebook.jpg";
import sharedArt from "./assets/editorial/shared-records.jpg";
import { UI_LANGS, useI18n, type UiLang } from "./i18n.tsx";
import { REGIONAL_NOTE } from "./strings-regional.ts";
import { PendingQueue } from "./pending.tsx";
import { store } from "./storage.ts";
import { About } from "./pages/About.tsx";
import { Compare } from "./pages/Compare.tsx";
import { Entity } from "./pages/Entity.tsx";
import { Explore } from "./pages/Explore.tsx";
import { Incidents } from "./pages/Incidents.tsx";
import { Log } from "./pages/Log.tsx";
import { Mine } from "./pages/Mine.tsx";
import { Proof } from "./pages/Proof.tsx";
import { Trust } from "./pages/Trust.tsx";
import { Rights } from "./pages/Rights.tsx";

/** Hash routing, so the static build works from any host, an IPFS gateway, or the portable single file. */
function useRoute() {
  const read = () => location.hash.replace(/^#/, "");
  const [hash, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  // Pages that read link parameters remount when those change, e.g. a shared link opened in this tab.
  const [path, query = ""] = hash.split("?");
  return { route: path || "/", query };
}

export function App() {
  const { route, query } = useRoute();
  const { t, ui, setLang } = useI18n();
  const [lightTheme, setLightTheme] = useState(() => store.get("theme") !== "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = lightTheme ? "light" : "dark";
    store.set("theme", lightTheme ? "light" : "dark");
  }, [lightTheme]);
  const nav: [string, string][] = [
    ["/", t("navExplore")], ["/compare", t("navCompare")], ["/log", t("navLog")], ["/incidents", t("navIncidents")],
    ["/rights", t("navRights")], ["/mine", t("navMine")], ["/trust", t("navTrust")], ["/proof", t("navProof")], ["/about", t("navAbout")],
  ];
  const entity = /^\/e\/(0x[0-9a-fA-F]{64})$/.exec(route)?.[1] as Hex | undefined;
  const sectionArt = route === "/incidents" || route === "/rights" ? incidentArt :
    route === "/log" || route === "/mine" ? notebookArt :
    route === "/trust" ? sharedArt :
    route === "/compare" || entity ? evidenceArt : cityArt;
  // Proof and How it works open with their own illustrated hero, so they get no banner.
  const sectionLabel = route === "/compare" ? t("navCompare") : route === "/log" ? t("navLog") :
    route === "/incidents" ? t("navIncidents") : route === "/rights" ? t("navRights") : route === "/mine" ? t("navMine") :
    route === "/trust" ? t("navTrust") : entity ? t("navExplore") : "";
  // On phones the nav scrolls sideways; keep the current page's tab in view.
  useEffect(() => {
    document.querySelector(".top nav a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [route]);
  // A shared link opened in this tab may carry the sender's language (?ui=hi).
  useEffect(() => {
    const fromLink = new URLSearchParams(query).get("ui");
    if (UI_LANGS.some(([code]) => code === fromLink) && fromLink !== ui) setLang(fromLink as UiLang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <>
      <header className="top">
        <a href="#/" className="brand"><img src={mark} alt="" width="34" height="34" />Nexora <span>ledger</span></a>
        <nav>
          {nav.map(([path, label]) => <a key={path} href={`#${path}`} className={route === path ? "active" : ""}>{label}</a>)}
        </nav>
        <a className="gh-link" href="https://github.com/GuTS805/Nexora" target="_blank" rel="noreferrer" title={t("openSourceTitle")} aria-label={t("openSourceTitle")}><svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg><span>{t("openSource")}</span></a>
        <button className="icon-control" onClick={() => setLightTheme(!lightTheme)} title={t(lightTheme ? "themeDark" : "themeLight")} aria-label={t(lightTheme ? "themeDark" : "themeLight")}>{lightTheme ? "☾" : "☼"}</button>
        <select className="icon-control lang" aria-label="Language / भाषा" value={ui} onChange={(e) => setLang(e.target.value as UiLang)}>
          {UI_LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </header>
      <main>
        <PendingQueue />
        {(ui === "kn" || ui === "ta") && <p className="card notice small regional-note" role="note">{REGIONAL_NOTE[ui]}</p>}
        {sectionLabel && <div className="editorial-banner" aria-hidden="true">
          <div><span>NEXORA / {sectionLabel}</span><strong>{sectionLabel}</strong></div>
          <img src={sectionArt} alt="" />
        </div>}
        {entity ? <Entity entityKey={entity} /> :
          route === "/compare" ? <Compare key={query} /> :
          route === "/log" ? <Log key={query} /> :
          route === "/incidents" ? <Incidents key={query} /> :
          route === "/mine" ? <Mine /> :
          route === "/trust" ? <Trust /> :
          route === "/rights" ? <Rights key={query} /> :
          route === "/about" ? <About /> :
          route === "/proof" ? <Proof /> :
          <Explore />}
      </main>
      <footer className="foot">
        {t("footer")} · <a href="https://github.com/GuTS805/Nexora" target="_blank" rel="noreferrer">{t("source")}</a>
      </footer>
    </>
  );
}
