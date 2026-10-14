import { SPEND_BAND_LABELS, explorerAddress, explorerEntity, explorerTx, fetchTrustList, type Experiment, type TrustList } from "@nexora/ledger";
import { useEffect, useState, type ReactNode } from "react";
import type { Address, Hex } from "viem";
import { useArkiv } from "./arkiv.tsx";
import { useI18n, type StringKey } from "./i18n.tsx";
import { store } from "./storage.ts";

export function useAsync<T>(run: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    run().then(
      (data) => live && setState({ data, loading: false }),
      (error: unknown) => live && setState({ error: error instanceof Error ? error.message : String(error), loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

export function Addr({ address, trusted }: { address: Address; trusted?: boolean | undefined }) {
  const { wallet } = useArkiv();
  const mine = wallet?.address.toLowerCase() === address.toLowerCase();
  return (
    <span className="addr">
      <a href={explorerAddress(address)} target="_blank" rel="noreferrer" title={address}>{short(address)}</a>
      {mine && <span className="badge">you</span>}
      {trusted === true && <span className="badge ok" title="Creator is on the selected trust list">trusted</span>}
      {trusted === false && <span className="badge warn" title="Creator is not on the selected trust list">unverified</span>}
    </span>
  );
}

export function EntityLink({ entityKey }: { entityKey: Hex }) {
  return <a href={`#/e/${entityKey}`} className="mono" title={entityKey}>{short(entityKey)}</a>;
}

export function TxLink({ hash }: { hash: Hex }) {
  return <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="mono">{short(hash)} ↗</a>;
}

export function ExplorerEntity({ entityKey }: { entityKey: Hex }) {
  return <a href={explorerEntity(entityKey)} target="_blank" rel="noreferrer">explorer ↗</a>;
}

export function Roi({ value }: { value: number }) {
  return <span className={value > 0 ? "roi up" : value < 0 ? "roi down" : "roi"}>{value > 0 ? "+" : ""}{value}%</span>;
}

/** Shows the exact predicate the page ran, so anyone can rerun it without this site. */
export function QueryBox({ query, block, cli, rejected }: { query: string; block?: bigint | undefined; cli?: string | undefined; rejected?: { key: string; reason: string }[] | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="query" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        Exact Arkiv query{block !== undefined ? ` · block ${block}` : ""}
        {rejected && rejected.length > 0 ? ` · ${rejected.length} entities rejected by the data contract` : ""}
      </summary>
      <pre>{query}</pre>
      {cli && (
        <>
          <p className="muted">Same result without this website:</p>
          <pre>{cli}</pre>
        </>
      )}
      {rejected && rejected.length > 0 && (
        <ul className="muted small">
          {rejected.slice(0, 10).map((r) => <li key={r.key}><span className="mono">{short(r.key)}</span>: {r.reason}</li>)}
        </ul>
      )}
    </details>
  );
}

export function ExperimentCard({ e, trusted }: { e: Experiment; trusted?: boolean | undefined }) {
  const { v } = useI18n();
  return (
    <article className="card experiment">
      <header>
        <strong>{v(e.platform)} · {v(e.format)}</strong>
        <Roi value={e.roiPct} />
      </header>
      <p className="tags">
        <span>{v(e.category)}</span><span>{v(e.tier)}</span><span>{v(e.lang)}</span>
        {e.season !== "none" && <span>{v(e.season)}</span>}
        <span>{SPEND_BAND_LABELS[e.spendBand]}</span><span>{e.days}d</span>
        {e.demo && <span className="badge">synthetic</span>}
        {e.sealed && <span className="badge" title="Exact figures are encrypted; only the seller can open them">🔒 sealed</span>}
      </p>
      <footer>
        <Addr address={e.creator} trusted={trusted} />
        <EntityLink entityKey={e.key} />
      </footer>
    </article>
  );
}

/** Where results come from: everyone, only my wallet, or the members of a trust list. */
export type Source = { kind: "all" } | { kind: "mine" } | { kind: "list"; key: Hex };

export function useSource(): [Source, (s: Source) => void, TrustList | null] {
  const [source, setSource] = useState<Source>(() => {
    const saved = store.get("source");
    if (saved === "mine") return { kind: "mine" };
    if (saved?.startsWith("0x")) return { kind: "list", key: saved as Hex };
    return { kind: "all" };
  });
  const { reader } = useArkiv();
  const list = useAsync(async () => {
    if (source.kind !== "list") return null;
    const decoded = await fetchTrustList(reader, source.key);
    return decoded.ok ? decoded.value : null;
  }, [source.kind === "list" ? source.key : source.kind, reader]);
  const update = (next: Source) => {
    store.set("source", next.kind === "list" ? next.key : next.kind);
    setSource(next);
  };
  return [source, update, list.data ?? null];
}

export function Field({ label, children }: { label: StringKey; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <label className="field">
      <span>{t(label)}</span>
      {children}
    </label>
  );
}

export function VocabSelect<T extends string>({ list, value, onChange, any }: { list: readonly T[]; value: T | ""; onChange: (value: T | "") => void; any?: boolean }) {
  const { t, v } = useI18n();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T | "")}>
      {any && <option value="">{t("any")}</option>}
      {list.map((item) => <option key={item} value={item}>{v(item)}</option>)}
    </select>
  );
}

export function ErrorNote({ error }: { error?: string | undefined }) {
  if (!error) return null;
  return <p className="error" role="alert">Arkiv request failed: {error}. If this RPC is unreachable, set another one under “How it works → Network”.</p>;
}

export function WalletBar() {
  const { wallet, connectBurner, connectInjected, disconnect } = useArkiv();
  const [error, setError] = useState<string>();
  if (wallet) {
    return (
      <div className="walletbar">
        <span className="muted small">{wallet.mode === "burner" ? "Test wallet" : "Browser wallet"}</span>
        <Addr address={wallet.address} />
        <button className="link" onClick={disconnect}>disconnect</button>
      </div>
    );
  }
  return (
    <div className="walletbar">
      <button onClick={() => connectBurner()} title="A throwaway Tiramisu key kept in this browser. Testnet only.">Use test wallet</button>
      <button className="secondary" onClick={() => connectInjected().catch((e: Error) => setError(e.message))}>Browser wallet</button>
      {error && <span className="error small">{error}</span>}
    </div>
  );
}
