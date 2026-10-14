import { readTrustLists } from "../cache.ts";
import { CATEGORIES, MAX_TRUST_MEMBERS, trustListCreate, trustListPatch, type Category, type TrustList } from "@nexora/ledger";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useArkiv } from "../arkiv.tsx";
import { Addr, ErrorNote, ExplorerEntity, QueryBox, TxLink, WalletBar, useAsync } from "../components.tsx";
import { useI18n } from "../i18n.tsx";

function Editor({ existing, onDone }: { existing?: TrustList; onDone: () => void }) {
  const { wallet, ensureGas, bump } = useArkiv();
  const { t, v } = useI18n();
  const [name, setName] = useState(existing?.name ?? "");
  const [scope, setScope] = useState<Category | "all">(existing?.scope ?? "all");
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
      setError(cause instanceof Error ? cause.message : String(cause));
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
          <select value={scope} onChange={(e) => setScope(e.target.value as Category | "all")}>
            <option value="all">{t("allCategories")}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{v(c)}</option>)}
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
              <p className="small">{t("curator")} <Addr address={list.creator} /> · {list.scope === "all" ? t("allCategories") : v(list.scope)} · {t("membersCount", { n: list.members.length })} · <ExplorerEntity entityKey={list.key} /></p>
              <p className="small">{list.members.map((m) => <span key={m}><Addr address={m} /> </span>)}</p>
              {wallet?.address.toLowerCase() === list.owner.toLowerCase() && <button className="secondary" onClick={() => setEditing(list)}>{t("editMembers")}</button>}
            </article>
          ))}
          <QueryBox query={lists.data.query} block={lists.data.blockNumber} cli="npx tsx ledger/cli.ts lists" rejected={lists.data.rejected} />
        </>
      )}
    </section>
  );
}
