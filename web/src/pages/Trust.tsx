import { readTrustLists } from "../cache.ts";
import { ExpirationTime } from "@arkiv-network/sdk";
import { explainError, blockToDate, MAX_TRUST_MEMBERS, TRUST_LIST_DAYS, WORK_TYPES, trustListCreate, trustListPatch, trustRenewal, type TrustList, type WorkType } from "nexora-ledger";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useArkiv } from "../arkiv.tsx";
import { Addr, ErrorNote, ExplorerEntity, QueryBox, TxLink, WalletBar, useAsync } from "../components.tsx";
import { AsOf } from "../history.tsx";
import { useI18n } from "../i18n.tsx";

function Editor({ existing, onDone }: { existing?: TrustList; onDone: () => void }) {
  const { wallet, ensureGas, bump } = useArkiv();
  const { t, v } = useI18n();
  const [name, setName] = useState(existing?.name ?? "");
  const [scope, setScope] = useState<WorkType | "all">(existing?.scope ?? "all");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [members, setMembers] = useState(existing?.members.join("\n") ?? "");
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (!wallet) throw new Error(t("connectFirst"));
      const input = { name, scope, description, members: members.split(/[\s,]+/).filter(Boolean) as Address[] };
      await ensureGas();
      const result = existing
        ? await wallet.client.patchEntity(trustListPatch(existing.key, input))
        : await wallet.client.createEntity(trustListCreate(input));
      setTx(result.txHash);
      bump();
      onDone();
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>{existing ? t("editList", { name: existing.name }) : t("createList")}</h3>
      <div className="form-grid">
        <label className="field"><span>{t("listName")}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("listNamePh")} /></label>
        <label className="field">
          <span>{t("listScope")}</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as WorkType | "all")}>
            <option value="all">{t("allWork")}</option>
            {WORK_TYPES.map((w) => <option key={w} value={w}>{v(w)}</option>)}
          </select>
        </label>
      </div>
      <label className="field"><span>{t("listDesc")}</span><input value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="field"><span>{t("listMembers", { n: MAX_TRUST_MEMBERS })}</span><textarea rows={5} value={members} onChange={(e) => setMembers(e.target.value)} /></label>
      <button disabled={!wallet || busy} onClick={save}>{busy ? t("saving") : existing ? t("saveChanges") : t("publishList")}</button>
      {tx && <p className="small">{t("saved")} <TxLink hash={tx} /></p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * A list's vouching is a lease: it lapses unless the curator renews it, so a group that stops
 * curating stops vouching. Only the curator (the owner) can renew.
 */
function Lease({ list, block }: { list: TrustList; block: bigint }) {
  const { wallet, ensureGas, bump } = useArkiv();
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const curator = wallet?.address.toLowerCase() === list.owner.toLowerCase();
  const target = trustRenewal(list.expiresAt, block);
  const date = blockToDate(list.expiresAt, block).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN");

  async function renew() {
    if (!wallet || target === null) return;
    setBusy(true);
    setError(null);
    try {
      await ensureGas();
      const result = await wallet.client.extendEntity({ entityKey: list.key, expires: ExpirationTime.atBlock(target) });
      setTx(result.txHash);
      bump();
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="small muted">{t("trustLapses", { date })}</p>
      {curator && (
        <button className="secondary" disabled={busy || target === null} title={target === null ? t("trustRenewedRecently") : undefined} onClick={renew}>
          {busy ? t("extending") : t("trustRenew", { n: TRUST_LIST_DAYS })}
        </button>
      )}
      {tx && <p className="small">{t("doneTx")} <TxLink hash={tx} /></p>}
      {error && <p className="error">{error}</p>}
    </>
  );
}

export function Trust() {
  const { reader, wallet, revision } = useArkiv();
  const { t, v } = useI18n();
  const lists = useAsync(() => readTrustLists(reader), [reader, revision]);
  const [editing, setEditing] = useState<TrustList | "new" | null>(null);

  return (
    <section>
      <h2>{t("navTrust")}</h2>
      <p className="muted">{t("trustIntro")}</p>
      <WalletBar />
      {wallet && editing === null && <button onClick={() => setEditing("new")}>{t("createList")}</button>}
      {editing && <Editor existing={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
      <ErrorNote error={lists.error} />
      {lists.data && (
        <>
          {lists.data.items.length === 0 && <p className="muted">{t("noLists")}</p>}
          {lists.data.items.map((list) => (
            <article key={list.key} className="card">
              <h3>{list.name}</h3>
              <p className="small">{list.description}</p>
              <p className="small">{t("curator")} <Addr address={list.creator} /> · {list.scope === "all" ? t("allWork") : v(list.scope)} · {t("membersCount", { n: list.members.length })} · <ExplorerEntity entityKey={list.key} /></p>
              <p className="small">{list.members.map((m) => <span key={m}><Addr address={m} /> </span>)}</p>
              <Lease list={list} block={lists.data!.blockNumber} />
              <AsOf entityKey={list.key} current={list} />
              {wallet?.address.toLowerCase() === list.owner.toLowerCase() && <button className="secondary" onClick={() => setEditing(list)}>{t("editMembers")}</button>}
            </article>
          ))}
          <QueryBox query={lists.data.query} block={lists.data.blockNumber} cli="npx tsx ledger/cli.ts lists" rejected={lists.data.rejected} />
        </>
      )}
    </section>
  );
}
