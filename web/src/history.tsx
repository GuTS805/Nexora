import { blockAtDate, decodeEntry, decodeReply, decodeTrustList, entityAtBlock, entityKeyPredicate, explainError, memberChanges, queryText, type RawEntity, type TrustList } from "nexora-ledger";
import { useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { useArkiv } from "./arkiv.tsx";
import { Addr } from "./components.tsx";
import { useI18n } from "./i18n.tsx";

/** `YYYY-MM-DDTHH:mm` in local time, the format a datetime-local input takes. */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type Outcome = { block: bigint; when: Date; then: RawEntity | null } | { before: true };

/**
 * "What was on record then": reads one entity as of a past block. A report shows it was public
 * before a date, even after it was deleted or expired; a trust list shows who it vouched for.
 * `current` is the list as it is now, to show who joined and left since.
 */
export function AsOf({ entityKey, current, gone }: { entityKey: Hex; current?: TrustList | undefined; gone?: boolean | undefined }) {
  const { reader } = useArkiv();
  const { t, v, lang } = useI18n();
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locale = lang === "hi" ? "hi-IN" : "en-IN";

  function describe(then: RawEntity | null): ReactNode {
    if (!then) return <p>{t("asOfMissing")}</p>;
    const entry = decodeEntry(then);
    const list = decodeTrustList(then);
    const reply = decodeReply(then);
    let what: ReactNode = t("asOfOnRecord");
    if (entry.ok) {
      const e = entry.value;
      what = `${t("asOfOnRecord")} ${e.kind === "shift" ? `${v(e.platform)} · ${v(e.work)} · ${v(e.city)} · ${t("perHour", { n: e.netHourly })}` : `${v(e.type)} · ${v(e.platform)} · ${v(e.city)}`}${e.demo ? ` · ${t("syntheticDemo")}` : ""}`;
    } else if (reply.ok) what = `${t("asOfOnRecord")} ${v(reply.value.status)}`;
    else if (list.ok) what = `${t("asOfOnRecord")} ${list.value.name}`;
    const changes = list.ok && current ? memberChanges(list.value.members, current.members) : null;
    return (
      <>
        <p>{what}</p>
        {gone && <p className="small">{t("asOfGoneNow")}</p>}
        {list.ok && <p className="small">{t("asOfMembersThen", { n: list.value.members.length })}</p>}
        {changes && (
          <ul className="small">
            <li>{t("asOfJoined")}: {changes.added.length ? changes.added.map((a) => <span key={a}><Addr address={a} /> </span>) : "—"}</li>
            <li>{t("asOfLeft")}: {changes.removed.length ? changes.removed.map((a) => <span key={a}><Addr address={a} /> </span>) : "—"}</li>
          </ul>
        )}
      </>
    );
  }

  async function check() {
    const date = new Date(when);
    if (Number.isNaN(date.getTime())) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const block = await blockAtDate(reader, date);
      if (block === null) setOutcome({ before: true });
      else setOutcome({ block, when: date, then: await entityAtBlock(reader, entityKey, block) });
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card as-of" open={gone}>
      <summary>{t("asOfTitle")}</summary>
      <p className="small muted">{current ? t("asOfIntroList") : t("asOfIntro")}</p>
      <form className="row" onSubmit={(ev) => { ev.preventDefault(); void check(); }}>
        <label className="field">
          <span>{t("asOfWhen")}</span>
          <input type="datetime-local" step={1} value={when} max={localInput(new Date())} onChange={(ev) => setWhen(ev.target.value)} required />
        </label>
        <button type="submit" className="secondary" disabled={busy || !when}>{busy ? t("asOfChecking") : t("asOfCheck")}</button>
      </form>
      {outcome && "before" in outcome && <p>{t("asOfBeforeChain")}</p>}
      {outcome && "block" in outcome && (
        <>
          <p className="small muted">{t("asOfBlock", { b: outcome.block.toString(), date: outcome.when.toLocaleString(locale) })}</p>
          {describe(outcome.then)}
          <p className="small muted mono">{queryText(entityKeyPredicate(entityKey))} @ block {outcome.block.toString()}</p>
          <p className="small muted mono">npx -p nexora-ledger nexora at {entityKey} --block {outcome.block.toString()}</p>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </details>
  );
}
