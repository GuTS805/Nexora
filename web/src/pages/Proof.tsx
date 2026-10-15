import { explainError, explorerEntity, explorerTx, getEntityOrNull, isLocked } from "nexora-ledger";
import { useEffect, useState, type ReactNode } from "react";
import type { Hex } from "viem";
import evidence from "../../../arkiv/evidence.json";
import { Cube, Icon, PATHS } from "../art.tsx";
import { useArkiv } from "../arkiv.tsx";
import { short } from "../components.tsx";
import { useI18n } from "../i18n.tsx";

type Step = { why?: string; tx?: Hex; txs?: Hex[]; key?: Hex; keys?: Hex[]; createTx?: Hex; deleteTx?: Hex; error?: string; [k: string]: unknown };

/** What to read back from chain for each recorded step, and what must hold. */
type Entity = { creator?: string; owner?: string; creationFlags?: { readonly: boolean; permissionlessExtension: boolean } } | null;
type Check = { key: (s: Step) => Hex | undefined; expect: [en: string, hi: string]; verify: (e: Entity, s: Step) => boolean };
const readonlyEntry: Check = { key: (s) => s.key ?? s.keys?.[0], expect: ["exists, readonly", "मौजूद है, readonly"], verify: (e) => !!e?.creationFlags?.readonly };
const CHECKS: Record<string, Check> = {
  batch_shifts: readonlyEntry,
  batch_spammer: readonlyEntry,
  batch_incidents: readonlyEntry,
  incident_followup: readonlyEntry,
  sealed_payload: readonlyEntry,
  trust_list_create: { key: (s) => s.key, expect: ["exists, editable by its owner", "मौजूद है, मालिक बदल सकता है"], verify: (e) => e !== null && e.creationFlags?.readonly === false },
  trust_list_patch: { key: (s) => s.key, expect: ["exists, edited in place by its owner", "मौजूद है, मालिक ने वहीं बदली"], verify: (e) => e !== null && e.creationFlags?.readonly === false },
  permissionless_extend: { key: (s) => s.key, expect: ["owner ≠ extender, community extension on", "मालिक ≠ बढ़ाने वाला, कम्युनिटी एक्सटेंशन चालू"], verify: (e, s) => !!e?.creationFlags?.permissionlessExtension && String(s.extendedBy).toLowerCase() !== String(e.owner).toLowerCase() },
  readonly_enforced: { key: (s) => s.key, expect: ["still readonly after the refused patch", "ठुकराए गए पैच के बाद भी readonly"], verify: (e) => !!e?.creationFlags?.readonly },
  owner_delete: { key: (s) => s.key, expect: ["gone after delete", "डिलीट के बाद मौजूद नहीं"], verify: (e) => e === null },
  union_reply: { key: (s) => s.keys?.[0], expect: ["exists, readonly, sent by the trust list's curator", "मौजूद है, readonly, भरोसा सूची चलाने वाले ने भेजा"], verify: (e, s) => !!e?.creationFlags?.readonly && String(e.creator).toLowerCase() === String(s.curator).toLowerCase() },
  ownership_lock: { key: (s) => s.key, expect: ["owned by 0x…dEaD, readonly: nobody can delete it", "मालिक 0x…dEaD, readonly: कोई डिलीट नहीं कर सकता"], verify: (e) => !!e?.creationFlags?.readonly && isLocked(String(e.owner)) },
};

/** evidence.json is written by the seed script in English; these are the Hindi versions. */
const WHY_HI: Record<string, string> = {
  batch_shifts: "executeBatch: नौ ईमानदार वर्कर्स में से हर एक के 16 सिंथेटिक दिनों की कमाई",
  batch_spammer: "executeBatch: जानबूझकर बनाए स्पैमर के ₹350–450/घंटा वाले 15 अविश्वसनीय दिन",
  batch_incidents: "executeBatch: हर ईमानदार वर्कर की 1–3 सिंथेटिक घटनाएँ (ID ब्लॉक, पे कट, पेनल्टी…)",
  incident_followup: "key-टाइप parent एट्रिब्यूट: वर्कर 5 बताता है कि ID ब्लॉक हट गया, वर्कर 6 बताता है कि उसके साथ भी यही हुआ",
  sealed_payload: "ब्राउज़र में AES-256-GCM से सील किए सटीक आँकड़े (डेमो पासफ़्रेज़ जानबूझकर सार्वजनिक है)",
  trust_list_create: "स्पॉन्सर वॉलेट की बनाई ट्रस्ट लिस्ट; शुरुआत में वर्कर 1–8",
  trust_list_patch: "मालिक का patchEntity: क्यूरेटर वर्कर 9 को जोड़ता है",
  permissionless_extend: "permissionlessExtension की वजह से मालिक के अलावा कोई और (स्पॉन्सर) वर्कर 1 की एंट्री की उम्र बढ़ाता है",
  readonly_enforced: "readonly एंट्री पर patchEntity ठुकराया जाना चाहिए, मालिक के लिए भी",
  owner_delete: "मालिक का deleteEntity: वर्कर 2 गलती से डाला दिन हटाता है",
  union_reply: "key-टाइप parent से जुड़े जवाब: डेमो भरोसा सूची चलाने वाला, यूनियन की जगह, एक ही बैच में तीन रिपोर्ट का जवाब देता है; जवाब से रिपोर्ट नहीं बदलती",
  ownership_lock: "ओनरशिप बदलने वाला executeBatch: वर्कर 6 ID बंद होने की रिपोर्ट करता है और उसी ट्रांज़ैक्शन में एंट्री 0x…dEaD को सौंप देता है, ताकि कोई भी (वर्कर 6 खुद भी) उसे समय से पहले डिलीट न कर सके",
};

const ICON_PATHS: Record<string, ReactNode> = {
  batch_shifts: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  batch_spammer: <><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z" /><path d="M12 8v5M12 16h.01" /></>,
  batch_incidents: <><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  incident_followup: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  sealed_payload: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  trust_list_create: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  trust_list_patch: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  permissionless_extend: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></>,
  readonly_enforced: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  owner_delete: <><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" /></>,
  ownership_lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4M12 15v2" /></>,
  union_reply: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /><path d="M8 9h8M8 13h5" /></>,
};

const External = () => <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;

type Result = { state: "checking" } | { state: "ok" | "fail"; error?: string };

export function Proof() {
  const { reader } = useArkiv();
  const { lang } = useI18n();
  const hi = lang === "hi";
  const doc = evidence as { network?: { name: string; chainId: number }; features: Record<string, Step> };
  const steps = Object.entries(doc.features);
  const entities = new Set(steps.flatMap(([, s]) => [s.key, ...(s.keys ?? [])]).filter(Boolean)).size;
  const [results, setResults] = useState<Record<string, Result>>({});

  async function verify(name: string, step: Step) {
    const check = CHECKS[name];
    const key = check?.key(step);
    if (!check || !key) return;
    setResults((r) => ({ ...r, [name]: { state: "checking" } }));
    try {
      const entity = (await getEntityOrNull(reader, key)) as Entity;
      const ok = check.verify(entity, step);
      setResults((r) => ({ ...r, [name]: { state: ok ? "ok" : "fail" } }));
    } catch (error) {
      setResults((r) => ({ ...r, [name]: { state: "fail", error: explainError(error) } }));
    }
  }

  // Re-check every step from this browser on arrival, one at a time to stay gentle on the RPC.
  useEffect(() => {
    let stop = false;
    (async () => {
      for (const [name, step] of steps) {
        if (stop) return;
        await verify(name, step);
      }
    })();
    return () => { stop = true; };
  }, [reader]);

  const checkable = steps.filter(([name]) => CHECKS[name]).length;
  const done = Object.values(results).filter((r) => r.state !== "checking");
  const passed = done.filter((r) => r.state === "ok").length;
  const failed = done.length - passed;
  const checking = done.length < checkable;

  return (
    <section className="proof-page">
      <div className="proof-hero">
        <div className="proof-copy">
          <h2>{hi ? <>सबूत: हर Arkiv फ़ीचर, <em>चेन पर</em></> : <>Proof: every Arkiv feature, <em>on chain</em></>}</h2>
          <p>
            {hi
              ? "हर पंक्ति एक असली Tiramisu ट्रांज़ैक्शन है, जो डेमो सीड स्क्रिप्ट ने दर्ज किया (arkiv/evidence.json)। एक्सप्लोरर पर खोलें, या यहीं चेन से दोबारा जाँचें।"
              : "Each row is a real Tiramisu transaction recorded by the demo seed script (arkiv/evidence.json). Open it on the explorer, or re-check it against the chain right here."}
          </p>
        </div>
        <div className="proof-badge">
          <span className="dot live" />
          <div><b>{hi ? "कोई भी जाँच सकता है" : "Verifiable by anyone"}</b><span>{hi ? "हर हैश सार्वजनिक एक्सप्लोरर पर खुलता है" : "Every hash opens on the public explorer"}</span></div>
        </div>
        <svg className="proof-art" viewBox="0 0 260 200" aria-hidden="true">
          <path className="cube-grid" d="M10 150 130 90 250 150M40 165 160 105M70 180 190 120M130 90v100" />
          <Cube x={110} y={70} s={44} />
          <Cube x={185} y={95} s={52} />
          <Cube x={150} y={150} s={36} />
        </svg>
      </div>

      <div className="proof-stats">
        <div>
          <Icon>{ICON_PATHS.incident_followup}</Icon>
          <span>{hi ? "दर्ज कदम" : "Recorded steps"}</span><b>{steps.length}</b><small>{hi ? "Arkiv फ़ीचर जो इस्तेमाल हुए" : "Arkiv features exercised"}</small>
        </div>
        <div className={failed ? "bad" : checking ? "" : "good"}>
          <Icon><><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></></Icon>
          <span>{hi ? "अभी जाँचे गए" : "Verified just now"}</span><b>{passed} / {checkable}</b>
          <small>{checking ? (hi ? "आपके ब्राउज़र से जाँच हो रही है…" : "checking from your browser…") : failed ? (hi ? `${failed} नहीं मिले, नीचे देखें` : `${failed} did not match, see below`) : (hi ? "आपके ब्राउज़र ने चेन से पढ़कर जाँचा" : "read back from chain by your browser")}</small>
        </div>
        <div>
          <Icon>{ICON_PATHS.permissionless_extend}</Icon>
          <span>{hi ? "एंट्रीज़" : "Entities"}</span><b>{entities}</b><small>{hi ? "सीड से बनी अलग-अलग एंट्रीज़" : "distinct entities the seed created"}</small>
        </div>
        <div>
          <Icon>{PATHS.box}</Icon>
          <span>{hi ? "नेटवर्क" : "Network"}</span><b>{doc.network?.name ?? "Tiramisu"}</b><small>{hi ? "टेस्टनेट" : "testnet"} · chain {doc.network?.chainId ?? 7738577}</small>
        </div>
      </div>

      {steps.length === 0 && <p className="card">{hi ? "सीड अभी नहीं चला है।" : "The seed has not run yet; nothing recorded."}</p>}
      {steps.length > 0 && (
        <div className="proof-table">
          <table>
            <thead><tr><th>{hi ? "फ़ीचर" : "Feature"}</th><th>{hi ? "विवरण" : "Description"}</th><th>{hi ? "ट्रांज़ैक्शन" : "Transactions"}</th><th>{hi ? "एंट्री" : "Entity"}</th><th>{hi ? "जाँच" : "Check"}</th></tr></thead>
            <tbody>
              {steps.map(([name, step]) => {
                const txs = [step.tx, step.createTx, step.deleteTx, ...(step.txs ?? [])].filter(Boolean) as Hex[];
                const key = step.key ?? step.keys?.[0];
                const result = results[name];
                return (
                  <tr key={name}>
                    <td className="feature"><span className="proof-icon"><Icon>{ICON_PATHS[name] ?? ICON_PATHS.incident_followup}</Icon></span><b>{name}</b></td>
                    <td className="why">{(hi && WHY_HI[name]) || step.why}</td>
                    <td className="chips">
                      {txs.slice(0, 3).map((h) => <a key={h} className="chip" href={explorerTx(h)} target="_blank" rel="noreferrer">{short(h)} <External /></a>)}
                      {txs.length > 3 && <span className="more">+{txs.length - 3}</span>}
                      {txs.length === 0 && step.error && <span className="chip refused" title={step.error}>{hi ? "ठुकराया गया · कोई tx नहीं" : "refused · no tx"}</span>}
                    </td>
                    <td className="chips">{key ? <a className="chip" href={explorerEntity(key)} target="_blank" rel="noreferrer">{short(key)} <External /></a> : "—"}</td>
                    <td className="verify">
                      {CHECKS[name] && (
                        <button className={`secondary ${result?.state ?? ""}`} disabled={result?.state === "checking"} onClick={() => verify(name, step)}>
                          {!result ? (hi ? "चेन पर जाँचें" : "Verify on chain")
                            : result.state === "checking" ? (hi ? "जाँच रहे हैं…" : "Checking…")
                            : result.state === "ok" ? (hi ? "✓ सही निकला" : "✓ Verified")
                            : (hi ? "✗ मेल नहीं" : "✗ Mismatch")}
                        </button>
                      )}
                      {result && result.state !== "checking" && (
                        <small className={result.state}>
                          {result.error ?? `${result.state === "fail" ? (hi ? "उम्मीद थी: " : "expected: ") : ""}${CHECKS[name]!.expect[hi ? 1 : 0]}`}
                        </small>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
