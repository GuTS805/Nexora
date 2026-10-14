import { ExpirationTime } from "@arkiv-network/sdk";
import {
  EXTEND_DAYS, SPEND_BAND_LABELS, blockToDate, fetchExperiment, fetchExperiments, fetchTrustList, unseal,
  type PrivateFigures,
} from "@nexora/ledger";
import { useState } from "react";
import type { Hex } from "viem";
import { useArkiv } from "../arkiv.tsx";
import { Addr, EntityLink, ErrorNote, ExperimentCard, ExplorerEntity, Roi, TxLink, WalletBar, useAsync } from "../components.tsx";
import { useI18n } from "../i18n.tsx";

const BLOCKS_PER_DAY = 86_400 / 2;

export function Entity({ entityKey }: { entityKey: Hex }) {
  const { reader, wallet, revision, bump, ensureGas } = useArkiv();
  const { t, v } = useI18n();
  const data = useAsync(async () => {
    const [decoded, block] = await Promise.all([fetchExperiment(reader, entityKey), reader.getBlockNumber()]);
    if (!decoded.ok) {
      const list = await fetchTrustList(reader, entityKey);
      return { kind: "other" as const, block, reason: decoded.reason, list: list.ok ? list.value : null };
    }
    const children = await fetchExperiments(reader, { parent: entityKey, includeDemo: true });
    return { kind: "experiment" as const, block, e: decoded.value, children: children.items, childQuery: children.query };
  }, [reader, entityKey, revision]);

  const [busy, setBusy] = useState<string | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [figures, setFigures] = useState<PrivateFigures | null>(null);

  async function act(label: string, run: () => Promise<{ txHash: Hex }>) {
    setBusy(label);
    setError(null);
    try {
      await ensureGas();
      const result = await run();
      setTx(result.txHash);
      bump();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  if (data.loading && !data.data) return <p className="muted">{t("loading")}</p>;
  if (data.error) return <ErrorNote error={data.error} />;
  if (!data.data) return null;

  if (data.data.kind === "other") {
    const list = data.data.list;
    if (!list) return <p className="error">This entity does not satisfy the Nexora data contract ({data.data.reason}). It may have expired, been deleted, or been written by someone else.</p>;
    return (
      <section>
        <h2>Trust list: {list.name}</h2>
        <p>{list.description}</p>
        <p>Curated by <Addr address={list.creator} /> · scope {list.scope === "all" ? "all categories" : v(list.scope)} · <ExplorerEntity entityKey={list.key} /></p>
        <ul>{list.members.map((m) => <li key={m}><Addr address={m} /></li>)}</ul>
      </section>
    );
  }

  const { e, block, children } = data.data;
  const isOwner = wallet?.address.toLowerCase() === e.owner.toLowerCase();
  const expires = blockToDate(e.expiresAt, block);

  return (
    <section>
      <h2>{v(e.platform)} · {v(e.format)} <Roi value={e.roiPct} /></h2>
      <p className="muted">{v(e.category)} · {v(e.tier)} · {v(e.lang)} · {v(e.season)} · {SPEND_BAND_LABELS[e.spendBand]} · {e.days} days · {v(e.tone)} · {v(e.cta)} · {v(e.offer)}{e.demo && " · synthetic demo"}</p>
      <div className="table-wrap">
        <table className="kv">
          <tbody>
            <tr><th>Entity key</th><td className="mono">{e.key} · <ExplorerEntity entityKey={e.key} /></td></tr>
            <tr><th>Published by ($creator)</th><td><Addr address={e.creator} /> <span className="muted small">— set by Arkiv, cannot be forged by the writer</span></td></tr>
            <tr><th>Owner ($owner)</th><td><Addr address={e.owner} /></td></tr>
            <tr><th>Expires</th><td>block {e.expiresAt.toString()} ≈ {expires.toLocaleDateString()} (now at block {block.toString()})</td></tr>
            <tr><th>Flags</th><td>{e.readonly ? "read-only: nobody can edit it" : "editable"} · {e.communityCanExtend ? "anyone may extend its life" : "only the owner may extend"}</td></tr>
            <tr><th>Variant of</th><td>{e.parent ? <EntityLink entityKey={e.parent} /> : "—"}</td></tr>
          </tbody>
        </table>
      </div>

      <WalletBar />
      <div className="actions">
        {e.communityCanExtend && (
          <button disabled={!wallet || busy !== null} onClick={() => act("extend", () => wallet!.client.extendEntity({ entityKey: e.key, expires: ExpirationTime.atBlock(e.expiresAt + BigInt(EXTEND_DAYS * BLOCKS_PER_DAY)) }))}>
            {busy === "extend" ? "Extending…" : t("keepAlive")}
          </button>
        )}
        <a className="button secondary" href={`#/log?parent=${e.key}&category=${e.category}&platform=${e.platform}&format=${e.format}`}>I ran a variant of this</a>
        {isOwner && (
          <button className="danger" disabled={busy !== null} onClick={() => confirm("Delete this experiment from Arkiv? This cannot be undone.") && act("delete", () => wallet!.client.deleteEntity({ entityKey: e.key }))}>
            {busy === "delete" ? "Deleting…" : t("delete")}
          </button>
        )}
      </div>
      {tx && <p className="card success">Done. Transaction <TxLink hash={tx} /></p>}
      {error && <p className="error" role="alert">{error}</p>}

      {e.sealed && (
        <div className="card">
          <h3>🔒 Sealed figures</h3>
          <p className="small muted">Encrypted with {e.sealed.alg}, key from {e.sealed.kdf} × {e.sealed.iter.toLocaleString()}. Decryption happens only in this browser.</p>
          {figures ? (
            <p>Spend ₹{figures.spendInr.toLocaleString("en-IN")} · sales ₹{figures.revenueInr.toLocaleString("en-IN")}{figures.orders !== undefined && ` · ${figures.orders} orders`}{figures.note && ` · “${figures.note}”`}</p>
          ) : (
            <form onSubmit={(ev) => { ev.preventDefault(); unseal(e.sealed!, pass).then(setFigures, (err: Error) => setError(err.message)); }}>
              <input type="password" placeholder={t("passphrase")} value={pass} onChange={(ev) => setPass(ev.target.value)} />
              <button type="submit">{t("unseal")}</button>
            </form>
          )}
        </div>
      )}

      <h3>Variants published by other sellers ({children.length})</h3>
      <p className="small muted mono">{data.data.childQuery}</p>
      <div className="grid">{children.map((c) => <ExperimentCard key={c.key} e={c} />)}</div>
    </section>
  );
}
