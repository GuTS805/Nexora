import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { useI18n } from "./i18n.tsx";
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
  const { t, lang, setLang } = useI18n();
  const [lightTheme, setLightTheme] = useState(() => store.get("theme") === "light");
  useEffect(() => {
    document.documentElement.dataset.theme = lightTheme ? "light" : "dark";
    store.set("theme", lightTheme ? "light" : "dark");
  }, [lightTheme]);
  const nav: [string, string][] = [
    ["/", t("navExplore")], ["/compare", t("navCompare")], ["/log", t("navLog")], ["/incidents", t("navIncidents")],
    ["/mine", t("navMine")], ["/trust", t("navTrust")], ["/proof", t("navProof")], ["/about", t("navAbout")],
  ];
  const entity = /^\/e\/(0x[0-9a-fA-F]{64})$/.exec(route)?.[1] as Hex | undefined;
  // On phones the nav scrolls sideways; keep the current page's tab in view.
  useEffect(() => {
    document.querySelector(".top nav a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [route]);
  // A shared link opened in this tab may carry the sender's language (?ui=hi).
  useEffect(() => {
    const ui = new URLSearchParams(query).get("ui");
    if ((ui === "hi" || ui === "en") && ui !== lang) setLang(ui);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <>
      <header className="top">
        <a href="#/" className="brand">Nexora <span>ledger</span></a>
        <nav>
          {nav.map(([path, label]) => <a key={path} href={`#${path}`} className={route === path ? "active" : ""}>{label}</a>)}
        </nav>
        <button className="icon-control" onClick={() => setLightTheme(!lightTheme)} title={t(lightTheme ? "themeDark" : "themeLight")} aria-label={t(lightTheme ? "themeDark" : "themeLight")}>{lightTheme ? "☾" : "☼"}</button>
        <button className="icon-control lang" onClick={() => setLang(lang === "en" ? "hi" : "en")}>{t("switchLang")}</button>
      </header>
      <main>
        {entity ? <Entity entityKey={entity} /> :
          route === "/compare" ? <Compare key={query} /> :
          route === "/log" ? <Log key={query} /> :
          route === "/incidents" ? <Incidents key={query} /> :
          route === "/mine" ? <Mine /> :
          route === "/trust" ? <Trust /> :
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
