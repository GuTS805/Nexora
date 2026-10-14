import { fetchExperiments } from "@nexora/ledger";
import { useState } from "react";
import { useArkiv } from "../arkiv.tsx";
import { ErrorNote, ExperimentCard, QueryBox, WalletBar, useAsync } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { store } from "../storage.ts";

export function Mine() {
  const { reader, wallet, revision, connectBurner } = useArkiv();
  const { t } = useI18n();
  const result = useAsync(async () => (wallet ? fetchExperiments(reader, { creators: [wallet.address], includeDemo: true }) : null), [reader, wallet?.address, revision]);
  const [showKey, setShowKey] = useState(false);
  const [importKey, setImportKey] = useState("");

  return (
    <section>
      <h2>{t("navMine")}</h2>
      <WalletBar />
      <p className="muted">{t("mineIntro")}</p>
      <ErrorNote error={result.error} />
      {result.data && (
        <>
          <QueryBox query={result.data.query} block={result.data.blockNumber} cli={`npx tsx ledger/cli.ts query --demo --creator ${wallet?.address}`} />
          {result.data.items.length === 0 && <p className="muted">{t("mineEmpty")} <a href="#/log">{t("navLog")}</a></p>}
          <div className="grid">{result.data.items.map((e) => <ExperimentCard key={e.key} e={e} />)}</div>
        </>
      )}
      {wallet?.mode === "burner" && (
        <details className="card">
          <summary>{t("backupTitle")}</summary>
          <p className="small">{t("backupDesc")}</p>
          {showKey ? <pre className="mono small">{store.get("burner")}</pre> : <button className="secondary" onClick={() => setShowKey(true)}>{t("revealKey")}</button>}
          <div className="row">
            <input placeholder={t("restorePh")} value={importKey} onChange={(e) => setImportKey(e.target.value.trim())} />
            <button
              className="secondary"
              disabled={!/^0x[0-9a-fA-F]{64}$/.test(importKey)}
              onClick={() => {
                store.set("burner", importKey);
                connectBurner();
                setImportKey("");
              }}
            >
              {t("restore")}
            </button>
          </div>
        </details>
      )}
    </section>
  );
}
