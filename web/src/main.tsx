import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ArkivProvider } from "./arkiv.tsx";
import { I18nProvider } from "./i18n.tsx";
import "./styles.css";

// Offline shell: the hosted app keeps opening on a dead connection. Not for the portable file (file://),
// which has no service worker and needs none.
if (import.meta.env.PROD && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <ArkivProvider>
        <App />
      </ArkivProvider>
    </I18nProvider>
  </StrictMode>,
);
