import { authorshipMessage, formatProof, parseProof, verifyAuthorship } from "nexora-ledger";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useArkiv } from "./arkiv.tsx";
import { useI18n } from "./i18n.tsx";

/**
 * "This report is mine", shown only to the person someone chooses to show it to. The worker signs a
 * statement with the key that wrote the entry; the checker compares the signer with the `$creator`
 * Arkiv recorded. Nothing is published, and the proof carries no name, phone or wallet of theirs.
 */
export function Authorship({ entityKey, creator }: { entityKey: Hex; creator: Address }) {
  const { walletFor } = useArkiv();
  const { t } = useI18n();
  const author = walletFor(creator);
  const [challenge, setChallenge] = useState("");
  const [proof, setProof] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [expected, setExpected] = useState("");
  const [verdict, setVerdict] = useState<"valid" | "invalid" | "unreadable" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function make() {
    if (!author) return;
    setError(null);
    try {
      const signature = await author.client.signMessage({ account: author.client.account ?? author.address, message: authorshipMessage(entityKey, challenge) });
      setProof(formatProof({ entityKey, challenge, signature }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function check() {
    const parsed = parseProof(pasted);
    if (!parsed) return setVerdict("unreadable");
    const ok = await verifyAuthorship(parsed, { entityKey, creator, challenge: expected.trim() ? expected : undefined });
    setVerdict(ok ? "valid" : "invalid");
  }

  return (
    <details className="card authorship">
      <summary>{author ? t("proofTitleOwn") : t("proofTitleCheck")}</summary>
      <p className="small muted">{t("proofIntro")}</p>
      {author && (
        <>
          <label className="field">
            <span>{t("proofChallenge")}</span>
            <input value={challenge} maxLength={120} placeholder={t("proofChallengePh")} onChange={(e) => { setChallenge(e.target.value); setProof(null); }} />
          </label>
          <button onClick={make}>{t("proofMake")}</button>
          {proof && (
            <>
              <pre className="mono small">{proof}</pre>
              <button className="secondary" onClick={() => void navigator.clipboard?.writeText(proof)}>{t("proofCopy")}</button>
              <p className="small muted">{t("proofShareNote")}</p>
            </>
          )}
          {error && <p className="error small" role="alert">{error}</p>}
          <hr />
        </>
      )}
      <p className="small"><b>{t("proofCheckTitle")}</b></p>
      <textarea rows={4} placeholder={t("proofPastePh")} value={pasted} onChange={(e) => { setPasted(e.target.value); setVerdict(null); }} />
      <label className="field">
        <span>{t("proofExpected")}</span>
        <input value={expected} maxLength={120} onChange={(e) => { setExpected(e.target.value); setVerdict(null); }} />
      </label>
      <button className="secondary" disabled={!pasted.trim()} onClick={() => void check()}>{t("proofCheck")}</button>
      {verdict === "valid" && <p className="card success" role="status">{t("proofValid")}</p>}
      {verdict === "invalid" && <p className="error" role="alert">{t("proofInvalid")}</p>}
      {verdict === "unreadable" && <p className="error" role="alert">{t("proofUnreadable")}</p>}
    </details>
  );
}
