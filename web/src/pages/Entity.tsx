import { readIncidents, readReplies } from "../cache.ts";
import { ExpirationTime } from "@arkiv-network/sdk";
import {
  explainError, EXTEND_DAYS, HOURS_BAND_LABELS, REPLY_STATUSES, blockToDate, decodeEntry, decodeReply, decodeTrustList, getEntityOrNull,
  isLocked, periodOf, replyCreate, repliesTo, resolvedReports, unseal, type Incident, type PrivateDetails, type Reply, type ReplyStatus,
} from "nexora-ledger";
import { useState } from "react";
import type { Hex } from "viem";
import { useArkiv } from "../arkiv.tsx";
import { Addr, EntityLink, ErrorNote, ExplorerEntity, Field, Hourly, IncidentCard, TxLink, VocabSelect, WalletBar, WhatsAppButton, useAsync, useMonth } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { AsOf } from "../history.tsx";
import { ComplaintLetter } from "../letter.tsx";
import { PlatformLogo } from "../logos.tsx";
import { Authorship } from "../proof.tsx";
import { appUrl } from "../share.ts";
import { SpeakButton } from "../voice.tsx";
import { useRecommendedList } from "./Explore.tsx";

const BLOCKS_PER_DAY = 86_400 / 2;

export function Entity({ entityKey }: { entityKey: Hex }) {
  const { reader, wallet, revision, bump, ensureGas, walletFor } = useArkiv();
  const { t, v, lang } = useI18n();
  const month = useMonth();
  const data = useAsync(async () => {
    const [raw, block] = await Promise.all([getEntityOrNull(reader, entityKey), reader.getBlockNumber()]);
    const decoded = raw ? decodeEntry(raw) : ({ ok: false, key: entityKey, reason: "not found: expired, deleted, or never created" } as const);
    if (!decoded.ok) {
      const list = raw ? decodeTrustList(raw) : null;
      const reply = raw ? decodeReply(raw) : null;
      return { kind: "other" as const, block, gone: raw === null, reason: decoded.reason, list: list?.ok ? list.value : null, reply: reply?.ok ? reply.value : null };
    }
    // Incidents collect updates ("unblocked after 6 days") and "same here" reports through `parent`,
    // and replies from unions or groups the same way.
    let updates: Incident[] = [];
    let updatesQuery = "";
    let replies: Reply[] = [];
    let repliesQuery = "";
    if (decoded.value.kind === "incident") {
      const [children, answers] = await Promise.all([
        readIncidents(reader, { parent: entityKey, includeDemo: true }),
        readReplies(reader, { parent: entityKey, includeDemo: true }),
      ]);
      updates = children.items;
      updatesQuery = children.query;
      replies = answers.items;
      repliesQuery = answers.query;
    }
    return { kind: "entry" as const, block, e: decoded.value, updates, updatesQuery, replies, repliesQuery };
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
    const { list, reply } = data.data;
    if (reply) {
      return (
        <section>
          <h2>{t("replyBadge", { status: v(reply.status) })}</h2>
          <p>{t("kvUpdateOf")}: <EntityLink entityKey={reply.parent} /> · {month(reply.period)}{reply.demo && ` · ${t("syntheticDemo")}`}</p>
          <p><Addr address={reply.creator} /> · <ExplorerEntity entityKey={reply.key} /></p>
        </section>
      );
    }
    if (!list) {
      // Deleted or expired entries leave the current state, not history: offer to read it as of earlier.
      return (
        <section>
          <p className="error">{t("notContract", { reason: data.data.reason })}</p>
          {data.data.gone && <AsOf entityKey={entityKey} gone />}
        </section>
      );
    }
    return (
      <section>
        <h2>{t("trustListTitle", { name: list.name })}</h2>
        <p>{list.description}</p>
        <p>{t("curatedBy")} <Addr address={list.creator} /> · {list.scope === "all" ? t("allWork") : v(list.scope)} · <ExplorerEntity entityKey={list.key} /></p>
        <ul>{list.members.map((m) => <li key={m}><Addr address={m} /></li>)}</ul>
        <AsOf entityKey={list.key} current={list} />
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
            <tr><th>{t("kvOwner")}</th><td><Addr address={e.owner} />{isLocked(e.owner) && <> <span className="badge ok">🔒</span> <span className="muted small">{t("lockedOwner")}</span></>}</td></tr>
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
        <SpeakButton text={shareText} />
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

      <Authorship entityKey={e.key} creator={e.creator} />

      {e.kind === "incident" && <Replies report={e} replies={data.data.replies} query={data.data.repliesQuery} />}

      {e.kind === "incident" && <ComplaintLetter e={e} updates={updates} details={details} />}

      {e.kind === "incident" && (
        <>
          <h3>{t("updatesTitle", { n: updates.length })}</h3>
          <p className="small muted mono">{data.data.updatesQuery}</p>
          <div className="grid">{updates.map((c) => <IncidentCard key={c.key} e={c} block={block} />)}</div>
        </>
      )}

      <AsOf entityKey={e.key} />
    </section>
  );
}

/**
 * Where a union, worker group or the platform says the report stands. Anyone can reply, so a reply
 * is only marked when its wallet runs the trust list this app recommends; the rest are claims.
 */
function Replies({ report, replies, query }: { report: Incident; replies: Reply[]; query: string }) {
  const { wallet, ensureGas, bump, walletFor } = useArkiv();
  const { t, v } = useI18n();
  const month = useMonth();
  const recommended = useRecommendedList();
  const [status, setStatus] = useState<ReplyStatus>("received");
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = repliesTo(report, replies);
  // The reporter's own wallet, or a one-time wallet of theirs kept in this browser.
  const own = walletFor(report.creator) !== null;

  async function send() {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    try {
      await ensureGas();
      const result = await wallet.client.createEntity(replyCreate({ parent: report.key, status, period: periodOf(new Date()), expiresInDays: 365 }));
      setTx(result.txHash);
      bump();
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card replies">
      <h3>{t("repliesTitle", { n: shown.length })}</h3>
      <p className="small muted">{t("repliesIntro")}</p>
      {shown.length === 0 && <p className="muted">{t("repliesNone")}</p>}
      {shown.length > 0 && (
        <ul className="reply-list">
          {shown.map((r) => {
            const curator = recommended !== null && recommended.creator.toLowerCase() === r.creator.toLowerCase();
            return (
              <li key={r.key}>
                <span className={r.status === "resolved" ? "badge ok" : r.status === "cannot_help" ? "badge warn" : "badge"}>{v(r.status)}</span>
                <span className="small muted">{month(r.period)}{r.demo && ` · ${t("syntheticDemo")}`}</span>
                <Addr address={r.creator} />
                {curator
                  ? <span className="badge ok">{t("replyCurator", { name: recommended.name })}</span>
                  : <span className="badge warn" title={t("replyUnknownTitle")}>{t("unverified")}</span>}
                <EntityLink entityKey={r.key} />
              </li>
            );
          })}
        </ul>
      )}
      <p className="small muted mono">{query}</p>
      <details className="reply-form">
        <summary>{t("replyAs")}</summary>
        <p className="small muted">{t("replyHelp")}</p>
        {own ? <p className="small">{t("replyOwn")}</p> : (
          <div className="row">
            <Field label="replyStatus"><VocabSelect list={REPLY_STATUSES} value={status} onChange={(x) => x && setStatus(x)} /></Field>
            <button disabled={!wallet || busy} onClick={send}>{busy ? t("publishing") : t("replySend")}</button>
          </div>
        )}
        {!wallet && !own && <p className="small muted">{t("connectFirst")}</p>}
        {tx && <p className="card success">{t("doneTx")} <TxLink hash={tx} /></p>}
        {error && <p className="error" role="alert">{error}</p>}
      </details>
    </div>
  );
}
