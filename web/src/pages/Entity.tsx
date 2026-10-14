import { readIncidents, readTrustList } from "../cache.ts";
import { ExpirationTime } from "@arkiv-network/sdk";
import { explainError, EXTEND_DAYS, HOURS_BAND_LABELS, blockToDate, fetchEntry, resolvedReports, unseal, type Incident, type PrivateDetails } from "@nexora/ledger";
import { useState } from "react";
import type { Hex } from "viem";
import { useArkiv } from "../arkiv.tsx";
import { Addr, EntityLink, ErrorNote, ExplorerEntity, Hourly, IncidentCard, TxLink, WalletBar, WhatsAppButton, useAsync, useMonth } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { PlatformLogo } from "../logos.tsx";
import { appUrl } from "../share.ts";

const BLOCKS_PER_DAY = 86_400 / 2;

export function Entity({ entityKey }: { entityKey: Hex }) {
  const { reader, wallet, revision, bump, ensureGas, walletFor } = useArkiv();
  const { t, v, lang } = useI18n();
  const month = useMonth();
  const data = useAsync(async () => {
    const [decoded, block] = await Promise.all([fetchEntry(reader, entityKey), reader.getBlockNumber()]);
    if (!decoded.ok) {
      const list = await readTrustList(reader, entityKey);
      return { kind: "other" as const, block, reason: decoded.reason, list: list.ok ? list.value : null };
    }
    // Incidents collect updates ("unblocked after 6 days") and "same here" reports through `parent`.
    let updates: Incident[] = [];
    let updatesQuery = "";
    if (decoded.value.kind === "incident") {
      const children = await readIncidents(reader, { parent: entityKey, includeDemo: true });
      updates = children.items;
      updatesQuery = children.query;
    }
    return { kind: "entry" as const, block, e: decoded.value, updates, updatesQuery };
  }, [reader, entityKey, revision]);

  const [busy, setBusy] = useState<string | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [details, setDetails] = useState<PrivateDetails | null>(null);

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
        <p>{t("curatedBy")} <Addr address={list.creator} /> · {list.scope === "all" ? t("allWork") : v(list.scope)} · <ExplorerEntity entityKey={list.key} /></p>
        <ul>{list.members.map((m) => <li key={m}><Addr address={m} /></li>)}</ul>
      </section>
    );
  }

  const { e, block, updates } = data.data;
  // The owner may be the connected wallet, the burner, or a one-time wallet kept in this browser.
  const ownerWallet = walletFor(e.owner);
  const expires = blockToDate(e.expiresAt, block);
  const locale = lang === "hi" ? "hi-IN" : "en-IN";
  const url = appUrl(`#/e/${e.key}?ui=${lang}`);
  const where = { platform: v(e.platform), work: v(e.work), city: v(e.city) };
  const shareText = e.kind === "shift"
    ? t("shareShift", { ...where, r: e.netHourly, url })
    : t("shareIncident", { ...where, type: v(e.type), url });
  const yesNo = (b: boolean) => (b ? t("yes") : t("no"));

  return (
    <section>
      {e.kind === "shift" ? (
        <>
          <h2><span className="with-logo"><PlatformLogo platform={e.platform} />{v(e.platform)} · {v(e.work)}</span> <Hourly value={e.netHourly} /></h2>
          <p className="muted">
            {v(e.city)} · {v(e.vehicle)} · {month(e.period)} · {HOURS_BAND_LABELS[e.hoursBand]} · {t("colCosts")} {e.costPct}% · {t("incentive")}: {v(e.incentive)}
            {e.demo && ` · ${t("syntheticDemo")}`}
          </p>
        </>
      ) : (
        <>
          {(() => {
            // Sorted out when published, or later by an update from the same worker.
            const resolved = resolvedReports([e, ...updates]).has(e.key) || (e.parent !== null && e.resolved);
            return <h2>{v(e.type)} <span className={resolved ? "badge ok" : "badge warn"}>{resolved ? t("resolvedBadge") : t("openBadge")}</span></h2>;
          })()}
          <p className="muted">
            {v(e.platform)} · {v(e.work)} · {v(e.city)} · {month(e.period)} · {t("daysLost")}: {e.daysLost} · {t("reasonGiven")}: {yesNo(e.reasonGiven)} · {t("appealed")}: {yesNo(e.appealed)}
            {e.demo && ` · ${t("syntheticDemo")}`}
          </p>
        </>
      )}
      <div className="table-wrap">
        <table className="kv">
          <tbody>
            <tr><th>{t("kvKey")}</th><td className="mono">{e.key} · <ExplorerEntity entityKey={e.key} /></td></tr>
            <tr><th>{t("kvCreator")}</th><td><Addr address={e.creator} /> <span className="muted small">{t("kvCreatorNote")}</span></td></tr>
            <tr><th>{t("kvOwner")}</th><td><Addr address={e.owner} /></td></tr>
            <tr><th>{t("kvExpires")}</th><td>{t("kvExpiresValue", { b: e.expiresAt.toString(), date: expires.toLocaleDateString(locale), now: block.toString() })}</td></tr>
            <tr><th>{t("kvFlags")}</th><td>{e.readonly ? t("flagReadonly") : t("flagEditable")} · {e.communityCanExtend ? t("flagAnyExtend") : t("flagOwnerExtend")}</td></tr>
            {e.kind === "incident" && <tr><th>{t("kvUpdateOf")}</th><td>{e.parent ? <EntityLink entityKey={e.parent} /> : "—"}</td></tr>}
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
        {e.kind === "incident" && (
          <a className="button secondary" href={`#/log?tab=incident&parent=${e.parent ?? e.key}&platform=${e.platform}&work=${e.work}&city=${e.city}&type=${e.type}`}>{t("postUpdate")}</a>
        )}
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
          {details ? (
            <p>
              {details.grossInr !== undefined && t("figures", { g: details.grossInr.toLocaleString("en-IN"), c: (details.costsInr ?? 0).toLocaleString("en-IN") })}
              {details.hours !== undefined && t("figuresHours", { n: details.hours })}
              {details.orders !== undefined && t("figuresOrders", { n: details.orders })}
              {details.note && ` · “${details.note}”`}
            </p>
          ) : (
            <form className="row" onSubmit={(ev) => { ev.preventDefault(); unseal(e.sealed!, pass).then(setDetails, (err: Error) => setError(err.message)); }}>
              <input type="password" placeholder={t("passphrase")} value={pass} onChange={(ev) => setPass(ev.target.value)} />
              <button type="submit">{t("unseal")}</button>
            </form>
          )}
        </div>
      )}

      {e.kind === "incident" && (
        <>
          <h3>{t("updatesTitle", { n: updates.length })}</h3>
          <p className="small muted mono">{data.data.updatesQuery}</p>
          <div className="grid">{updates.map((c) => <IncidentCard key={c.key} e={c} block={block} />)}</div>
        </>
      )}
    </section>
  );
}
