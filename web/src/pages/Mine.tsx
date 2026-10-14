import { readExperiments } from "../cache.ts";
import { useState } from "react";
import { useArkiv } from "../arkiv.tsx";
import { ErrorNote, ExperimentCard, QueryBox, WalletBar, useAsync } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { store } from "../storage.ts";

export function Mine() {
  const { reader, wallet, revision, connectBurner, oneOffWallets } = useArkiv();
  const { t } = useI18n();
  const oneOffs = oneOffWallets().map((w) => w.address);
  // $creator OR over the main wallet and every one-time wallet; fetchExperiments splits long lists.
  const creators = [...(wallet ? [wallet.address] : []), ...oneOffs];
  const result = useAsync(async () => (creators.length ? readExperiments(reader, { creators, includeDemo: true }) : null), [reader, creators.join(","), revision]);
  const [showKey, setShowKey] = useState(false);
  const [importKey, setImportKey] = useState("");

  // Backup format: one key per line, "main 0x…" for the test wallet and "one-time 0x…" for the rest.
  // A single bare key restores as the main test wallet.
  const oneOffKeys = (): string[] => {
    try {
      return JSON.parse(store.get("oneoff") ?? "[]") as string[];
    } catch {
      return [];
    }
  };
  const backupText = () =>
    [store.get("burner") ? `main ${store.get("burner")}` : "", ...oneOffKeys().map((k) => `one-time ${k}`)].filter(Boolean).join("\n");
  const parseBackup = (text: string) => {
    const lines = [...text.matchAll(/(main|one-time)?\s*(0x[0-9a-fA-F]{64})/g)];
    return lines.map((m) => ({ main: m[1] === "main" || (lines.length === 1 && !m[1]), key: m[2]! }));
  };
  function restore() {
    const keys = parseBackup(importKey);
    const main = keys.find((k) => k.main);
    const extra = keys.filter((k) => !k.main).map((k) => k.key);
    if (extra.length) store.set("oneoff", JSON.stringify([...new Set([...oneOffKeys(), ...extra])]));
    if (main) {
      store.set("burner", main.key);
      connectBurner();
    }
    setImportKey("");
  }

  return (
    <section>
      <h2>{t("navMine")}</h2>
      <WalletBar />
      <p className="muted">{t("mineIntro")}</p>
      <ErrorNote error={result.error} />
      {result.data && (
        <>
          <QueryBox query={result.data.query} block={result.data.blockNumber} cli={`npx tsx ledger/cli.ts query --demo --creator ${wallet?.address}`} />
          {oneOffs.length > 0 && <p className="small muted">{t("oneOffCount", { n: oneOffs.length })}</p>}
          {result.data.items.length === 0 && <p className="muted">{t("mineEmpty")} <a href="#/log">{t("navLog")}</a></p>}
          <div className="grid">{result.data.items.map((e) => <ExperimentCard key={e.key} e={e} block={result.data?.blockNumber} />)}</div>
        </>
      )}
      {(wallet?.mode === "burner" || oneOffs.length > 0) && (
        <details className="card">
          <summary>{t("backupTitle")}</summary>
          <p className="small">{t("backupDesc")}</p>
          {showKey ? <pre className="mono small">{backupText()}</pre> : <button className="secondary" onClick={() => setShowKey(true)}>{t("revealKey")}</button>}
          <textarea rows={3} placeholder={t("restorePh")} value={importKey} onChange={(e) => setImportKey(e.target.value)} />
          <button className="secondary" disabled={parseBackup(importKey).length === 0} onClick={restore}>{t("restore")}</button>
        </details>
      )}
    </section>
  );
}
