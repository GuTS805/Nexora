import { readEntries } from "../cache.ts";
import { useState } from "react";
import { useArkiv } from "../arkiv.tsx";
import { EntryCard, ErrorNote, QueryBox, WalletBar, useAsync } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { monthKeys, rememberMonthKeys } from "../months.ts";
import { store } from "../storage.ts";

export function Mine() {
  const { reader, wallet, revision, connectBurner, oneOffWallets } = useArkiv();
  const { t } = useI18n();
  const oneOffs = oneOffWallets().map((w) => w.address);
  // $creator OR over the main wallet and every one-time wallet; long lists are split into several queries.
  const creators = [...(wallet ? [wallet.address] : []), ...oneOffs];
  const result = useAsync(async () => (creators.length ? readEntries(reader, { creators, includeDemo: true }) : null), [reader, creators.join(","), revision]);
  const [showKey, setShowKey] = useState(false);
  const [importKey, setImportKey] = useState("");

  // Backup format: one key per line, "main 0x…" for the test wallet, "month-yyyymm 0x…" for a month's
  // earnings wallet and "one-time 0x…" for the rest. A single bare key restores as the main test wallet.
  const oneOffKeys = (): string[] => {
    try {
      return JSON.parse(store.get("oneoff") ?? "[]") as string[];
    } catch {
      return [];
    }
  };
  const backupText = () => {
    const months = Object.entries(monthKeys());
    const monthly = new Set<string>(months.map(([, k]) => k));
    return [store.get("burner") ? `main ${store.get("burner")}` : "", ...months.map(([period, k]) => `month-${period} ${k}`), ...oneOffKeys().filter((k) => !monthly.has(k)).map((k) => `one-time ${k}`)].filter(Boolean).join("\n");
  };
  const parseBackup = (text: string) => {
    const lines = [...text.matchAll(/(main|one-time|month-(\d{6}))?\s*(0x[0-9a-fA-F]{64})/g)];
    return lines.map((m) => ({ main: m[1] === "main" || (lines.length === 1 && !m[1]), month: m[2], key: m[3]! }));
  };
  function restore() {
    const keys = parseBackup(importKey);
    const main = keys.find((k) => k.main);
    const extra = keys.filter((k) => !k.main).map((k) => k.key);
    if (extra.length) store.set("oneoff", JSON.stringify([...new Set([...oneOffKeys(), ...extra])]));
    rememberMonthKeys(Object.fromEntries(keys.filter((k) => k.month).map((k) => [k.month!, k.key])));
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
          <QueryBox query={result.data.query} block={result.data.blockNumber} cli={`npx tsx ledger/cli.ts earnings --demo --creator ${wallet?.address ?? creators[0]}`} />
          {oneOffs.length > 0 && <p className="small muted">{t("oneOffCount", { n: oneOffs.length })}</p>}
          {result.data.items.length === 0 && <p className="muted">{t("mineEmpty")} <a href="#/log">{t("navLog")}</a></p>}
          <div className="grid">{result.data.items.map((e) => <EntryCard key={e.key} e={e} block={result.data?.blockNumber} />)}</div>
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
      {/* For a phone that someone else may check: nothing on it should say which reports are this worker's. */}
      <details className="card wipe">
        <summary>{t("wipeTitle")}</summary>
        <p className="small">{t("wipeDesc")}</p>
        <p className="small muted">{t("wipeLimits")}</p>
        <button className="danger" onClick={() => {
          if (!confirm(t("wipeConfirm"))) return;
          store.wipe();
          location.replace(location.pathname);
        }}>{t("wipeButton")}</button>
      </details>
    </section>
  );
}
