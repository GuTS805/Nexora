import { readExperiments, readTrustList } from "../cache.ts";
import { ExpirationTime } from "@arkiv-network/sdk";
import { explainError, EXTEND_DAYS, SPEND_BAND_LABELS, blockToDate, fetchExperiment, unseal, type PrivateFigures } from "@nexora/ledger";
import { useState } from "react";
import type { Hex } from "viem";
import { useArkiv } from "../arkiv.tsx";
import { Addr, EntityLink, ErrorNote, ExperimentCard, ExplorerEntity, Roi, TxLink, WalletBar, WhatsAppButton, useAsync } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { appUrl } from "../share.ts";

const BLOCKS_PER_DAY = 86_400 / 2;

export function Entity({ entityKey }: { entityKey: Hex }) {
  const { reader, wallet, revision, bump, ensureGas, walletFor } = useArkiv();
  const { t, v, lang } = useI18n();
  const data = useAsync(async () => {
    const [decoded, block] = await Promise.all([fetchExperiment(reader, entityKey), reader.getBlockNumber()]);
    if (!decoded.ok) {
      const list = await readTrustList(reader, entityKey);
      return { kind: "other" as const, block, reason: decoded.reason, list: list.ok ? list.value : null };
    }
    const children = await readExperiments(reader, { parent: entityKey, includeDemo: true });
    return { kind: "experiment" as const, block, e: decoded.value, children: children.items, childQuery: children.query };
  }, [reader, entityKey, revision]);

  const [busy, setBusy] = useState<string | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [figures, setFigures] = useState<PrivateFigures | null>(null);

  async function act(label: string, run: () => Promise<{ txHash: Hex }>, payer?: `0x${string}`) {
    setBusy(label);
    setError(null);
    try {
      await ensureGas(payer);
      const result = await run();
      setTx(result.txHash);
      bump();
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setBusy(null);
    }
  }

  if (data.loading && !data.data) return <p className="muted">{t("loading")}</p>;
  if (data.error) return <ErrorNote error={data.error} />;
  if (!data.data) return null;

  if (data.data.kind === "other") {
    const list = data.data.list;
    if (!list) return <p className="error">{t("notContract", { reason: data.data.reason })}</p>;
    return (
      <section>
        <h2>{t("trustListTitle", { name: list.name })}</h2>
        <p>{list.description}</p>
        <p>{t("curatedBy")} <Addr address={list.creator} /> · {list.scope === "all" ? t("allCategories") : v(list.scope)} · <ExplorerEntity entityKey={list.key} /></p>
        <ul>{list.members.map((m) => <li key={m}><Addr address={m} /></li>)}</ul>
      </section>
    );
  }

  const { e, block, children } = data.data;
  // The owner may be the connected wallet, the burner, or a one-time wallet kept in this browser.
  const ownerWallet = walletFor(e.owner);
  const expires = blockToDate(e.expiresAt, block);
  const locale = lang === "hi" ? "hi-IN" : "en-IN";
  const combo = `${v(e.platform)} · ${v(e.format)}`;
  const shareText = t("shareEntity", { combo, category: v(e.category), where: `${v(e.tier)}, ${v(e.lang)}`, r: `${e.roiPct > 0 ? "+" : ""}${e.roiPct}`, url: appUrl(`#/e/${e.key}?ui=${lang}`) });

  return (
    <section>
      <h2>{combo} <Roi value={e.roiPct} /></h2>
      <p className="muted">{v(e.category)} · {v(e.tier)} · {v(e.lang)} · {v(e.season)} · {SPEND_BAND_LABELS[e.spendBand]} · {t("daysShort", { n: e.days })} · {v(e.tone)} · {v(e.cta)} · {v(e.offer)}{e.demo && ` · ${t("syntheticDemo")}`}</p>
      <div className="table-wrap">
        <table className="kv">
          <tbody>
            <tr><th>{t("kvKey")}</th><td className="mono">{e.key} · <ExplorerEntity entityKey={e.key} /></td></tr>
            <tr><th>{t("kvCreator")}</th><td><Addr address={e.creator} /> <span className="muted small">{t("kvCreatorNote")}</span></td></tr>
            <tr><th>{t("kvOwner")}</th><td><Addr address={e.owner} /></td></tr>
            <tr><th>{t("kvExpires")}</th><td>{t("kvExpiresValue", { b: e.expiresAt.toString(), date: expires.toLocaleDateString(locale), now: block.toString() })}</td></tr>
            <tr><th>{t("kvFlags")}</th><td>{e.readonly ? t("flagReadonly") : t("flagEditable")} · {e.communityCanExtend ? t("flagAnyExtend") : t("flagOwnerExtend")}</td></tr>
            <tr><th>{t("kvVariantOf")}</th><td>{e.parent ? <EntityLink entityKey={e.parent} /> : "—"}</td></tr>
          </tbody>
        </table>
      </div>

      <WalletBar />
      <div className="actions">
        {e.communityCanExtend && (
          <button disabled={!wallet || busy !== null} onClick={() => act("extend", () => wallet!.client.extendEntity({ entityKey: e.key, expires: ExpirationTime.atBlock(e.expiresAt + BigInt(EXTEND_DAYS * BLOCKS_PER_DAY)) }))}>
            {busy === "extend" ? t("extending") : t("keepAlive")}
          </button>
        )}
        <a className="button secondary" href={`#/log?parent=${e.key}&category=${e.category}&platform=${e.platform}&format=${e.format}`}>{t("ranVariant")}</a>
        <WhatsAppButton text={shareText} />
        {ownerWallet && (
          <button className="danger" disabled={busy !== null} onClick={() => confirm(t("deleteConfirm")) && act("delete", () => ownerWallet.client.deleteEntity({ entityKey: e.key }), ownerWallet.address)}>
            {busy === "delete" ? t("deleting") : t("delete")}
          </button>
        )}
      </div>
      {tx && <p className="card success">{t("doneTx")} <TxLink hash={tx} /></p>}
      {error && <p className="error" role="alert">{error}</p>}

      {e.sealed && (
        <div className="card">
          <h3>{t("sealedFigures")}</h3>
          <p className="small muted">{t("sealedInfo", { alg: e.sealed.alg, kdf: e.sealed.kdf, iter: e.sealed.iter.toLocaleString(locale) })}</p>
          {figures ? (
            <p>
              {t("figures", { s: figures.spendInr.toLocaleString("en-IN"), r: figures.revenueInr.toLocaleString("en-IN") })}
              {figures.orders !== undefined && t("figuresOrders", { n: figures.orders })}
              {figures.note && ` · “${figures.note}”`}
            </p>
          ) : (
            <form className="row" onSubmit={(ev) => { ev.preventDefault(); unseal(e.sealed!, pass).then(setFigures, (err: Error) => setError(err.message)); }}>
              <input type="password" placeholder={t("passphrase")} value={pass} onChange={(ev) => setPass(ev.target.value)} />
              <button type="submit">{t("unseal")}</button>
            </form>
          )}
        </div>
      )}

      <h3>{t("variantsTitle", { n: children.length })}</h3>
      <p className="small muted mono">{data.data.childQuery}</p>
      <div className="grid">{children.map((c) => <ExperimentCard key={c.key} e={c} block={block} />)}</div>
    </section>
  );
}
