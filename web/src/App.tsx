import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { useI18n } from "./i18n.tsx";
import { About } from "./pages/About.tsx";
import { Advisor } from "./pages/Advisor.tsx";
import { Entity } from "./pages/Entity.tsx";
import { Explore } from "./pages/Explore.tsx";
import { Log } from "./pages/Log.tsx";
import { Mine } from "./pages/Mine.tsx";
import { Trust } from "./pages/Trust.tsx";

/** Hash routing, so the static build works from any host, an IPFS gateway, or a local folder. */
function useRoute() {
  const read = () => location.hash.replace(/^#/, "").split("?")[0] || "/";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const { t, lang, setLang } = useI18n();
  const nav: [string, string][] = [
    ["/", t("navExplore")], ["/advisor", t("navAdvisor")], ["/log", t("navLog")],
    ["/mine", t("navMine")], ["/trust", t("navTrust")], ["/about", t("navAbout")],
  ];
  const entity = /^\/e\/(0x[0-9a-fA-F]{64})$/.exec(route)?.[1] as Hex | undefined;

  return (
    <>
      <header className="top">
        <a href="#/" className="brand">Nexora <span>ledger</span></a>
        <nav>
          {nav.map(([path, label]) => <a key={path} href={`#${path}`} className={route === path ? "active" : ""}>{label}</a>)}
        </nav>
        <button className="link lang" onClick={() => setLang(lang === "en" ? "hi" : "en")}>{lang === "en" ? "हिंदी" : "English"}</button>
      </header>
      <main>
        {entity ? <Entity entityKey={entity} /> :
          route === "/advisor" ? <Advisor /> :
          route === "/log" ? <Log /> :
          route === "/mine" ? <Mine /> :
          route === "/trust" ? <Trust /> :
          route === "/about" ? <About /> :
          <Explore />}
      </main>
      <footer className="foot">
        Data lives on <a href="https://arkiv.network" target="_blank" rel="noreferrer">Arkiv</a> Tiramisu testnet · MIT · <a href="https://github.com/" target="_blank" rel="noreferrer">source</a> · ad results are self-reported; synthetic demo rows are labelled
      </footer>
    </>
  );
}
