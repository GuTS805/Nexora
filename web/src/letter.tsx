import { explorerEntity, resolvedReports, type City, type Incident, type IncidentType, type PrivateDetails } from "nexora-ledger";
import { useEffect, useState } from "react";
import { WhatsAppButton, useMonth } from "./components.tsx";
import { useI18n, type Lang } from "./i18n.tsx";
import { appUrl } from "./share.ts";
import { SpeakButton } from "./voice.tsx";

/** The Labour Ministry's e-Shram registration portal, where platform workers sign up for social security schemes. */
export const ESHRAM_URL = "https://register.eshram.gov.in";

/**
 * Turns one incident report into a complaint letter the worker can send: to the platform, to a union,
 * or to the state labour department or gig workers' welfare board.
 *
 * Everything here stays on the device. The letter is built from the public record plus anything the
 * worker unsealed on this page; their name and partner ID are blank brackets they fill in themselves
 * after copying, because the app never asks for them.
 */

export type Recipient = "platform" | "union" | "labour";

/** States by city, for the labour-department letter. Delhi NCR spans three states, so it stays blank. */
export const STATE: Partial<Record<City, [string, string]>> = {
  mumbai: ["Maharashtra", "महाराष्ट्र"], pune: ["Maharashtra", "महाराष्ट्र"], bengaluru: ["Karnataka", "कर्नाटक"],
  hyderabad: ["Telangana", "तेलंगाना"], chennai: ["Tamil Nadu", "तमिलनाडु"], kolkata: ["West Bengal", "पश्चिम बंगाल"],
  ahmedabad: ["Gujarat", "गुजरात"], jaipur: ["Rajasthan", "राजस्थान"], lucknow: ["Uttar Pradesh", "उत्तर प्रदेश"],
  indore: ["Madhya Pradesh", "मध्य प्रदेश"], kochi: ["Kerala", "केरल"], chandigarh: ["Chandigarh", "चंडीगढ़"],
};

/** What the worker asks for, by what happened. */
export const ASK: Record<IncidentType, [string, string]> = {
  id_blocked: ["Restore my ID, and pay for the days I could not work if the block was a mistake.", "मेरी ID फिर से चालू करें, और अगर ब्लॉक गलती से हुआ था तो जिन दिनों मैं काम नहीं कर पाया उनका भुगतान करें।"],
  deactivated: ["Have a person (not only an automated system) review the deactivation, and restore my ID if it was wrong.", "ID बंद करने के फ़ैसले की जाँच कोई इंसान करे (सिर्फ़ ऑटोमैटिक सिस्टम नहीं), और अगर फ़ैसला गलत था तो मेरी ID फिर से चालू करें।"],
  pay_cut: ["Explain how my pay per order or per km is calculated, and why it changed.", "बताएँ कि हर ऑर्डर या हर किलोमीटर का मेरा पैसा कैसे तय होता है, और यह क्यों बदला।"],
  incentive_cut: ["Explain the change to my incentive or target, and pay any incentive I had already earned.", "मेरे इंसेंटिव या टारगेट में बदलाव की वजह बताएँ, और जो इंसेंटिव मैं कमा चुका था उसका भुगतान करें।"],
  penalty: ["Show me the reason for the penalty or deduction, and refund it if it was wrong.", "जुर्माने या कटौती की वजह दिखाएँ, और अगर वह गलत थी तो पैसा वापस करें।"],
  payout_delayed: ["Pay the pending amount, and tell me the date it will reach my account.", "बकाया पैसा दें, और बताएँ कि वह किस तारीख तक मेरे खाते में आएगा।"],
  unsafe_pressure: ["Review the delivery-time targets that push riders to ride unsafely.", "डिलीवरी टाइम के उन टारगेट की जाँच करें जिनकी वजह से राइडर्स को खतरनाक तरीके से चलाना पड़ता है।"],
  harassment: ["Act on the abuse or violence I faced at work, and tell me in writing what was done.", "काम के दौरान मेरे साथ हुई गाली-गलौज या मारपीट पर कार्रवाई करें, और लिखकर बताएँ कि क्या किया गया।"],
};

export type Facts = {
  platform: string; work: string; city: string; type: string; month: string; daysLost: number;
  reasonGiven: string; appealed: string; resolved: string; state: string | null;
  explorer: string; page: string; similar: string; ask: string; details: string | null;
};

export function letter(lang: Lang, to: Recipient, f: Facts): string {
  if (lang === "hi") {
    const head = to === "platform"
      ? `सेवा में: शिकायत अधिकारी / सपोर्ट टीम, ${f.platform}`
      : to === "union"
        ? "सेवा में: [यूनियन का नाम]"
        : `सेवा में: श्रम विभाग / गिग वर्कर्स वेलफ़ेयर बोर्ड, ${f.state ?? "[आपका राज्य]"}`;
    const intro = to === "platform"
      ? `मैं ${f.city} में ${f.platform} पर ${f.work} का काम करता/करती हूँ। मैं नीचे लिखी घटना के बारे में शिकायत कर रहा/रही हूँ।`
      : to === "union"
        ? `मैं ${f.city} में ${f.platform} पर ${f.work} का काम करता/करती हूँ। कृपया मेरा मामला ${f.platform} के सामने उठाएँ।`
        : `मैं ${f.city} में ${f.platform} पर ${f.work} का काम करने वाला/वाली प्लेटफ़ॉर्म वर्कर हूँ। मैं ${f.platform} के ख़िलाफ़ यह शिकायत दर्ज करना चाहता/चाहती हूँ।`;
    return [
      head,
      `विषय: ${f.type}, ${f.month}, ${f.city}`,
      "",
      intro,
      "",
      `क्या हुआ: ${f.type}`,
      `कब: ${f.month}`,
      `इसकी वजह से कितने दिन काम नहीं मिला: ${f.daysLost}`,
      `क्या कोई वजह बताई गई: ${f.reasonGiven}`,
      `क्या मैंने अपील की: ${f.appealed}`,
      `क्या मामला सुलझा: ${f.resolved}`,
      ...(f.details ? [`मेरा निजी ब्योरा: ${f.details}`] : []),
      "",
      "यह रिकॉर्ड Arkiv पर दर्ज है, जो एक सार्वजनिक लेजर है। इसे कोई भी नहीं बदल सकता, मैं खुद भी नहीं। कोई भी इसे यहाँ जाँच सकता है:",
      f.explorer,
      f.page,
      ...(to === "platform" ? [] : ["", `${f.city} में ${f.platform} के बारे में ऐसी ही दूसरी रिपोर्ट:`, f.similar]),
      "",
      "मेरा अनुरोध:",
      "1. इस कार्रवाई की वजह लिखकर बताई जाए।",
      `2. ${f.ask}`,
      "3. 14 दिनों के भीतर जवाब दिया जाए।",
      "",
      "नाम: [आपका नाम]",
      "पार्टनर / राइडर ID: [आपकी ID]",
      "फ़ोन: [आपका नंबर]",
      "तारीख: [आज की तारीख]",
    ].join("\n");
  }
  const head = to === "platform"
    ? `To: The Grievance Officer / Support team, ${f.platform}`
    : to === "union"
      ? "To: [Name of the union]"
      : `To: The Labour Department / Gig Workers' Welfare Board, ${f.state ?? "[your state]"}`;
  const intro = to === "platform"
    ? `I work for ${f.platform} in ${f.work} in ${f.city}. I am writing to complain about the following.`
    : to === "union"
      ? `I work for ${f.platform} in ${f.work} in ${f.city}. Please take up my case with ${f.platform}.`
      : `I am a platform worker doing ${f.work} for ${f.platform} in ${f.city}. I wish to register this complaint against ${f.platform}.`;
  return [
    head,
    `Subject: ${f.type}, ${f.month}, ${f.city}`,
    "",
    intro,
    "",
    `What happened: ${f.type}`,
    `When: ${f.month}`,
    `Days without work because of it: ${f.daysLost}`,
    `Was a reason given: ${f.reasonGiven}`,
    `Did I appeal: ${f.appealed}`,
    `Has it been resolved: ${f.resolved}`,
    ...(f.details ? [`My private details: ${f.details}`] : []),
    "",
    "This record is published on Arkiv, a public ledger. Nobody can change it, including me, and anyone can check it here:",
    f.explorer,
    f.page,
    ...(to === "platform" ? [] : ["", `Other reports like this about ${f.platform} in ${f.city}:`, f.similar]),
    "",
    "I request:",
    "1. The reason for this action, in writing.",
    `2. ${f.ask}`,
    "3. A reply within 14 days.",
    "",
    "Name: [your name]",
    "Partner / rider ID: [your ID]",
    "Phone: [your number]",
    "Date: [today's date]",
  ].join("\n");
}

/** Where a letter can go. Statements here are deliberately general; no section numbers are quoted. */
export const WHERE: Record<Lang, { title: string; points: string[]; notAdvice: string }> = {
  en: {
    title: "Where to send it",
    points: [
      "Start with the app: most platforms have a help or grievance section. Keep a screenshot of what you send and when.",
      "India's Code on Social Security, 2020, in force since 21 November 2025, recognises gig and platform workers.",
      "Karnataka (2025 law for platform-based gig workers): complaints about payouts, deductions or termination go first to the platform's internal dispute resolution committee, then to the state's gig workers' welfare board.",
      "Rajasthan (2023 law for platform-based gig workers): grievances about payments and benefits can be filed through the state's online portal or with a designated officer.",
      "Other states are making their own rules. A union can help you raise a case together with other workers.",
      `Social security: platform workers can register on e-Shram, the Labour Ministry's portal, to be considered for government schemes for them: ${ESHRAM_URL}`,
    ],
    notAdvice: "This is general information, not legal advice. A union or a lawyer can tell you what applies to you.",
  },
  hi: {
    title: "इसे कहाँ भेजें",
    points: [
      "शुरुआत ऐप से करें: ज़्यादातर प्लेटफ़ॉर्म में हेल्प या शिकायत का सेक्शन होता है। जो भेजें और जब भेजें, उसका स्क्रीनशॉट रखें।",
      "भारत की सामाजिक सुरक्षा संहिता (Code on Social Security), 2020, जो 21 नवंबर 2025 से लागू है, गिग और प्लेटफ़ॉर्म वर्कर्स को मान्यता देती है।",
      "कर्नाटक (प्लेटफ़ॉर्म गिग वर्कर्स के लिए 2025 का कानून): पेमेंट, कटौती या काम से हटाने की शिकायत पहले प्लेटफ़ॉर्म की अंदरूनी विवाद समिति के पास जाती है, फिर राज्य के गिग वर्कर्स वेलफ़ेयर बोर्ड के पास।",
      "राजस्थान (प्लेटफ़ॉर्म गिग वर्कर्स के लिए 2023 का कानून): पेमेंट और फ़ायदों से जुड़ी शिकायत राज्य के ऑनलाइन पोर्टल पर या तय अधिकारी के पास दर्ज की जा सकती है।",
      "दूसरे राज्य अपने नियम बना रहे हैं। यूनियन आपकी शिकायत दूसरे वर्कर्स के साथ मिलकर उठाने में मदद कर सकती है।",
      `सामाजिक सुरक्षा: प्लेटफ़ॉर्म वर्कर्स श्रम मंत्रालय के e-Shram पोर्टल पर रजिस्टर कर सकते हैं, ताकि उनके लिए बनी सरकारी योजनाओं में उनका नाम आ सके: ${ESHRAM_URL}`,
    ],
    notAdvice: "यह आम जानकारी है, कानूनी सलाह नहीं। आप पर क्या लागू होता है, यह यूनियन या वकील बता सकते हैं।",
  },
};

export function ComplaintLetter({ e, updates, details }: { e: Incident; updates: Incident[]; details: PrivateDetails | null }) {
  const { t, v, lang } = useI18n();
  const month = useMonth();
  const [to, setTo] = useState<Recipient>("platform");
  const [withDetails, setWithDetails] = useState(false);
  const yesNo = (b: boolean) => (b ? t("yes") : t("no"));
  const resolved = resolvedReports([e, ...updates]).has(e.key) || e.resolved;
  const detailText = details
    ? [
        details.grossInr !== undefined ? t("figures", { g: details.grossInr.toLocaleString("en-IN"), c: (details.costsInr ?? 0).toLocaleString("en-IN") }) : "",
        details.hours !== undefined ? t("figuresHours", { n: details.hours }) : "",
        details.orders !== undefined ? t("figuresOrders", { n: details.orders }) : "",
        details.note ? `“${details.note}”` : "",
      ].filter(Boolean).join(" ")
    : null;
  const facts: Facts = {
    platform: v(e.platform), work: v(e.work), city: v(e.city), type: v(e.type), month: month(e.period), daysLost: e.daysLost,
    reasonGiven: yesNo(e.reasonGiven), appealed: yesNo(e.appealed), resolved: yesNo(resolved),
    state: STATE[e.city]?.[lang === "hi" ? 1 : 0] ?? null,
    explorer: explorerEntity(e.key),
    page: appUrl(`#/e/${e.key}?ui=${lang}`),
    similar: appUrl(`#/incidents?platform=${e.platform}&city=${e.city}&ui=${lang}`),
    ask: ASK[e.type][lang === "hi" ? 1 : 0],
    details: withDetails && detailText ? detailText : null,
  };
  const generated = letter(lang, to, facts);
  const [text, setText] = useState(generated);
  // A new recipient, language or detail choice rewrites the draft; edits in between are the worker's own.
  useEffect(() => setText(generated), [generated]);
  const [copied, setCopied] = useState(false);
  const where = WHERE[lang];

  return (
    <div className="card letter">
      <h3>{t("letterTitle")}</h3>
      <p className="small muted">{t("letterIntro")}</p>
      <div className="row letter-options">
        <label>
          {t("letterTo")}{" "}
          <select value={to} onChange={(ev) => setTo(ev.target.value as Recipient)}>
            <option value="platform">{t("letterToPlatform", { platform: v(e.platform) })}</option>
            <option value="union">{t("letterToUnion")}</option>
            <option value="labour">{t("letterToLabour")}</option>
          </select>
        </label>
        {detailText && (
          <label className="check"><input type="checkbox" checked={withDetails} onChange={(ev) => setWithDetails(ev.target.checked)} /> {t("letterWithDetails")}</label>
        )}
      </div>
      <textarea className="letter-text" value={text} onChange={(ev) => { setText(ev.target.value); setCopied(false); }} rows={22} spellCheck={false} aria-label={t("letterTitle")} />
      <p className="small muted">{t("letterFillIn")}</p>
      <div className="actions">
        <button onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false))}>{copied ? t("copied") : t("letterCopy")}</button>
        <WhatsAppButton text={text} />
        <SpeakButton text={text} />
      </div>
      <details className="letter-where">
        <summary>{where.title}</summary>
        <ul>{where.points.map((p) => <li key={p}>{p}</li>)}</ul>
        <p className="small muted">{where.notAdvice}</p>
      </details>
    </div>
  );
}
