import { explainError, explorerAddress, explorerEntity, explorerTx, getEntityOrNull } from "@nexora/ledger";
import { useState } from "react";
import type { Hex } from "viem";
import evidence from "../../../arkiv/evidence.json";
import { useArkiv } from "../arkiv.tsx";
import { short } from "../components.tsx";
import { useI18n } from "../i18n.tsx";

type Step = { why?: string; tx?: Hex; txs?: Hex[]; key?: Hex; keys?: Hex[]; createTx?: Hex; deleteTx?: Hex; at?: string; [k: string]: unknown };

/** What to read back from chain for each recorded step, and what must hold. */
const CHECKS: Record<string, { key: (s: Step) => Hex | undefined; expect: string; verify: (e: { creator?: string; owner?: string; creationFlags?: { readonly: boolean; permissionlessExtension: boolean } } | null, s: Step) => boolean }> = {
  sealed_payload: { key: (s) => s.key, expect: "exists, readonly", verify: (e) => !!e?.creationFlags?.readonly },
  trust_list_create: { key: (s) => s.key, expect: "exists, editable by its owner", verify: (e) => e !== null && e.creationFlags?.readonly === false },
  trust_list_patch: { key: (s) => s.key, expect: "exists, edited in place by its owner", verify: (e) => e !== null && e.creationFlags?.readonly === false },
  permissionless_extend: { key: (s) => s.key, expect: "owner ≠ extender, community extension on", verify: (e, s) => !!e?.creationFlags?.permissionlessExtension && String(s.extendedBy).toLowerCase() !== String(e.owner).toLowerCase() },
  readonly_enforced: { key: (s) => s.key, expect: "still readonly after the refused patch", verify: (e) => !!e?.creationFlags?.readonly },
  owner_delete: { key: (s) => s.key, expect: "gone after delete", verify: (e) => e === null },
};

export function Proof() {
  const { reader } = useArkiv();
  const { lang } = useI18n();
  const hi = lang === "hi";
  const steps = Object.entries((evidence as { features: Record<string, Step> }).features);
  const [results, setResults] = useState<Record<string, string>>({});

  async function verify(name: string, step: Step) {
    const check = CHECKS[name];
    if (!check) return;
    const key = check.key(step);
    if (!key) return;
    setResults((r) => ({ ...r, [name]: "…" }));
    try {
      const entity = await getEntityOrNull(reader, key);
      const ok = check.verify(entity as Parameters<typeof check.verify>[0], step);
      setResults((r) => ({ ...r, [name]: ok ? `✓ ${check.expect}` : `✗ expected: ${check.expect}` }));
    } catch (error) {
      setResults((r) => ({ ...r, [name]: `error: ${explainError(error)}` }));
    }
  }

  return (
    <section>
      <h2>{hi ? "सबूत: हर Arkiv फ़ीचर चेन पर" : "Proof: every Arkiv feature, on chain"}</h2>
      <p className="muted">
        {hi
          ? "हर पंक्ति एक असली Tiramisu ट्रांज़ैक्शन है, जो डेमो सीड स्क्रिप्ट ने दर्ज किया (arkiv/evidence.json)। एक्सप्लोरर पर खोलें, या यहीं चेन से दोबारा जाँचें।"
          : "Each row is a real Tiramisu transaction recorded by the demo seed script (arkiv/evidence.json). Open it on the explorer, or re-check it against the chain right here."}
      </p>
      {steps.length === 0 && <p className="card">{hi ? "सीड अभी नहीं चला है।" : "The seed has not run yet; nothing recorded."}</p>}
      {steps.length > 0 && <div className="table-wrap">
        <table>
          <thead><tr><th>{hi ? "फ़ीचर" : "Feature"}</th><th>{hi ? "ट्रांज़ैक्शन" : "Transactions"}</th><th>{hi ? "एंट्री" : "Entity"}</th><th /></tr></thead>
          <tbody>
            {steps.map(([name, step]) => {
              const txs = [step.tx, step.createTx, step.deleteTx, ...(step.txs ?? [])].filter(Boolean) as Hex[];
              const key = step.key ?? step.keys?.[0];
              return (
                <tr key={name}>
                  <td><b>{name}</b><br /><span className="small muted">{step.why}</span></td>
                  <td className="small">{txs.slice(0, 3).map((h) => <div key={h}><a className="mono" href={explorerTx(h)} target="_blank" rel="noreferrer">{short(h)} ↗</a></div>)}{txs.length > 3 && `+${txs.length - 3}`}</td>
                  <td className="small">{key ? <a className="mono" href={explorerEntity(key)} target="_blank" rel="noreferrer">{short(key)} ↗</a> : "—"}{typeof step.creator === "string" && <div><a className="mono" href={explorerAddress(step.creator as Hex)} target="_blank" rel="noreferrer">{short(step.creator)}</a></div>}</td>
                  <td className="small">
                    {CHECKS[name] && <button className="link" onClick={() => verify(name, step)}>{hi ? "चेन पर जाँचें" : "verify on chain"}</button>}
                    {results[name] && <div>{results[name]}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}
    </section>
  );
}
