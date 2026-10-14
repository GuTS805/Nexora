import { CATEGORIES, MAX_TRUST_MEMBERS, fetchTrustLists, trustListCreate, trustListPatch, type Category, type TrustList } from "@nexora/ledger";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useArkiv } from "../arkiv.tsx";
import { Addr, ErrorNote, ExplorerEntity, QueryBox, TxLink, WalletBar, useAsync } from "../components.tsx";
import { useI18n } from "../i18n.tsx";

function Editor({ existing, onDone }: { existing?: TrustList; onDone: () => void }) {
  const { wallet, ensureGas, bump } = useArkiv();
  const { v } = useI18n();
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
      if (!wallet) throw new Error("Connect a wallet first.");
      const input = { name, scope, description, members: members.split(/[\s,]+/).filter(Boolean) as Address[] };
      const params = existing ? trustListPatch(existing.key, input) : trustListCreate(input);
      await ensureGas();
      const result = existing ? await wallet.client.patchEntity(params as ReturnType<typeof trustListPatch>) : await wallet.client.createEntity(params as ReturnType<typeof trustListCreate>);
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
      <h3>{existing ? `Edit “${existing.name}”` : "Create a trust list"}</h3>
      <div className="form-grid">
        <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jaipur block-print collective" /></label>
        <label className="field">
          <span>Scope</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as Category | "all")}>
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{v(c)}</option>)}
          </select>
        </label>
      </div>
      <label className="field"><span>Public description (no personal details)</span><input value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="field"><span>Member wallet addresses, one per line (max {MAX_TRUST_MEMBERS})</span><textarea rows={5} value={members} onChange={(e) => setMembers(e.target.value)} /></label>
      <button disabled={!wallet || busy} onClick={save}>{busy ? "Saving…" : existing ? "Save changes" : "Publish list"}</button>
      {tx && <p className="small">Saved: <TxLink hash={tx} /></p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function Trust() {
  const { reader, wallet, revision } = useArkiv();
  const { t, v } = useI18n();
  const lists = useAsync(() => fetchTrustLists(reader), [reader, revision]);
  const [editing, setEditing] = useState<TrustList | "new" | null>(null);

  return (
    <section>
      <h2>{t("navTrust")}</h2>
      <p className="muted">Anyone can publish results, so anyone can publish fake ones. A trust list is a set of wallets someone vouches for — a seller association, a marketplace community, or just you. Picking a list filters every page by Arkiv’s engine-set <code>$creator</code>, which a writer cannot fake. There is no central list and no gatekeeper: lists compete, and you choose.</p>
      <WalletBar />
      {wallet && editing === null && <button onClick={() => setEditing("new")}>Create a trust list</button>}
      {editing && <Editor existing={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
      <ErrorNote error={lists.error} />
      {lists.data && (
        <>
          {lists.data.items.length === 0 && <p className="muted">No trust lists yet.</p>}
          {lists.data.items.map((list) => (
            <article key={list.key} className="card">
              <h3>{list.name}</h3>
              <p className="small">{list.description}</p>
              <p className="small">Curator <Addr address={list.creator} /> · {list.scope === "all" ? "all categories" : v(list.scope)} · {list.members.length} members · <ExplorerEntity entityKey={list.key} /></p>
              <p className="small">{list.members.map((m) => <span key={m}><Addr address={m} /> </span>)}</p>
              {wallet?.address.toLowerCase() === list.owner.toLowerCase() && <button className="secondary" onClick={() => setEditing(list)}>Edit members</button>}
            </article>
          ))}
          <QueryBox query={lists.data.query} block={lists.data.blockNumber} cli="npx tsx ledger/cli.ts lists" rejected={lists.data.rejected} />
        </>
      )}
    </section>
  );
}
