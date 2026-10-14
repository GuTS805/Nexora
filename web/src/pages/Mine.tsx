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
      <p className="muted">Everything here is found by asking Arkiv for entities whose <code>$creator</code> is your wallet. Open one to extend or delete it, or to unlock its sealed figures.</p>
      <ErrorNote error={result.error} />
      {result.data && (
        <>
          <QueryBox query={result.data.query} block={result.data.blockNumber} cli={`npx tsx ledger/cli.ts query --demo --creator ${wallet?.address}`} />
          {result.data.items.length === 0 && <p className="muted">You have not published anything from this wallet yet. <a href="#/log">Log a result</a>.</p>}
          <div className="grid">{result.data.items.map((e) => <ExperimentCard key={e.key} e={e} />)}</div>
        </>
      )}
      {wallet?.mode === "burner" && (
        <details className="card">
          <summary>Test wallet backup</summary>
          <p className="small">This throwaway Tiramisu key lives only in this browser. Copy it to keep control of what you published (to delete it later) on another device. Testnet only — never put real funds on it.</p>
          {showKey ? <pre className="mono small">{store.get("burner")}</pre> : <button className="secondary" onClick={() => setShowKey(true)}>Reveal key</button>}
          <div className="row">
            <input placeholder="Paste a backed-up test key (0x…)" value={importKey} onChange={(e) => setImportKey(e.target.value.trim())} />
            <button
              className="secondary"
              disabled={!/^0x[0-9a-fA-F]{64}$/.test(importKey)}
              onClick={() => {
                store.set("burner", importKey);
                connectBurner();
                setImportKey("");
              }}
            >
              Restore
            </button>
          </div>
        </details>
      )}
    </section>
  );
}
