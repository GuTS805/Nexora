import { SPEND_BAND_LABELS, explainError, explorerAddress, explorerEntity, explorerTx, fetchTrustList, type Experiment, type TrustList } from "@nexora/ledger";
import { useEffect, useState, type ReactNode } from "react";
import type { Address, Hex } from "viem";
import { useArkiv } from "./arkiv.tsx";
import { useI18n, type StringKey } from "./i18n.tsx";
import { whatsappUrl } from "./share.ts";
import { store } from "./storage.ts";

export function useAsync<T>(run: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    run().then(
      (data) => live && setState({ data, loading: false }),
      (error: unknown) => live && setState({ error: explainError(error), loading: false }),
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
  const { t } = useI18n();
  const mine = wallet?.address.toLowerCase() === address.toLowerCase();
  return (
    <span className="addr">
      <a href={explorerAddress(address)} target="_blank" rel="noreferrer" title={address}>{short(address)}</a>
      {mine && <span className="badge">{t("you")}</span>}
      {trusted === true && <span className="badge ok" title={t("trustedTitle")}>{t("trusted")}</span>}
      {trusted === false && <span className="badge warn" title={t("unverifiedTitle")}>{t("unverified")}</span>}
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
  const { t } = useI18n();
  return <a href={explorerEntity(entityKey)} target="_blank" rel="noreferrer">{t("explorer")}</a>;
}

export function Roi({ value }: { value: number }) {
  return <span className={value > 0 ? "roi up" : value < 0 ? "roi down" : "roi"}>{value > 0 ? "+" : ""}{value}%</span>;
}

export function WhatsAppButton({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <a className="button whatsapp" href={whatsappUrl(text)} target="_blank" rel="noreferrer">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" /></svg>
      {t("shareWhatsApp")}
    </a>
  );
}

/** Shows the exact predicate the page ran, so anyone can rerun it without this site. */
export function QueryBox({ query, block, cli, rejected }: { query: string; block?: bigint | undefined; cli?: string | undefined; rejected?: { key: string; reason: string }[] | undefined }) {
  const { t } = useI18n();
  return (
    <details className="query">
      <summary>
        {t("queryTitle")}
        {block !== undefined ? t("queryBlock", { n: block.toString() }) : ""}
        {rejected && rejected.length > 0 ? t("queryRejected", { n: rejected.length }) : ""}
      </summary>
      <pre>{query}</pre>
      {cli && (
        <>
          <p className="muted">{t("querySame")}</p>
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
  const { t, v } = useI18n();
  return (
    <article className="card experiment">
      <header>
        <strong>{v(e.platform)} · {v(e.format)}</strong>
        <Roi value={e.roiPct} />
      </header>
      <p className="tags">
        <span>{v(e.category)}</span><span>{v(e.tier)}</span><span>{v(e.lang)}</span>
        {e.season !== "none" && <span>{v(e.season)}</span>}
        <span>{SPEND_BAND_LABELS[e.spendBand]}</span><span>{t("daysShort", { n: e.days })}</span>
        {e.demo && <span className="badge">{t("synthetic")}</span>}
        {e.sealed && <span className="badge" title={t("sealedTitle")}>{t("sealedBadge")}</span>}
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
  const { t } = useI18n();
  if (!error) return null;
  if (error.includes("ANON_COST_LIMITED")) return <p className="error" role="alert">{t("rateLimited")}<br /><span className="small muted">{error}</span></p>;
  return <p className="error" role="alert">{t("arkivFailed", { error })}</p>;
}

export function WalletBar() {
  const { wallet, connectBurner, connectInjected, disconnect } = useArkiv();
  const { t } = useI18n();
  const [error, setError] = useState<string>();
  if (wallet) {
    return (
      <div className="walletbar">
        <span className="muted small">{wallet.mode === "burner" ? t("testWallet") : t("browserWallet")}</span>
        <Addr address={wallet.address} />
        <button className="link" onClick={disconnect}>{t("disconnect")}</button>
      </div>
    );
  }
  return (
    <div className="walletbar">
      <button onClick={() => connectBurner()} title={t("testWalletTitle")}>{t("useTestWallet")}</button>
      <button className="secondary" onClick={() => connectInjected().catch((e: Error) => setError(window.ethereum ? e.message : t("noBrowserWallet")))}>{t("browserWallet")}</button>
      {error && <span className="error small">{error}</span>}
    </div>
  );
}
