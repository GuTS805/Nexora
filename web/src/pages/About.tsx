import { TIRAMISU_RPC } from "@nexora/ledger";
import { useState } from "react";
import { useArkiv } from "../arkiv.tsx";
import { useI18n } from "../i18n.tsx";

function English() {
  return (
    <>
      <h2>How it works</h2>
      <p>
        A tea seller in Indore and a saree seller in Surat each spend a few thousand rupees testing ads on Instagram, WhatsApp or Meesho.
        What they learn stays in their own heads, or in a platform dashboard that can change its numbers, its rules or its prices
        at any time. Nexora is a shared notebook of those experiments that no company owns.
      </p>
      <ol>
        <li><b>Log a result.</b> Category, platform, format, language, region and festival, all picked from fixed lists. Spend becomes a band and ROI is rounded to 10%; exact rupees are either thrown away or encrypted in your browser.</li>
        <li><b>It is written to Arkiv</b> from <em>your</em> wallet (a throwaway test wallet is created for you), read-only, with an expiry you choose.</li>
        <li><b>Anyone can query it:</b> this site, the command-line tool, or any Arkiv client, using the exact query shown under every list.</li>
        <li><b>Ask what to try.</b> Suggestions only count combinations that at least two independent sellers confirmed, and every suggestion links to its evidence. Share it to your WhatsApp group in one tap.</li>
        <li><b>Choose whom to trust.</b> Filter by trust lists curated by communities you know. Filtering uses Arkiv’s <code>$creator</code>, which nobody can fake.</li>
      </ol>
      <h3>What is on Arkiv, and what deliberately is not</h3>
      <ul>
        <li>On Arkiv: experiment details from fixed lists (searchable), creative choices, optional encrypted exact figures, trust lists.</li>
        <li>Never on Arkiv: names, phone numbers, shop names, product names, images, ad copy, customer data, passphrases.</li>
        <li>There is no Nexora database. The only server code is an optional helper that sends a few test GLM to new wallets.</li>
      </ul>
      <h3>If this website disappears</h3>
      <p>The data does not. Clone the MIT-licensed repository and run <code>npx tsx ledger/cli.ts query --demo</code>, or build the portable single-file version (<code>npm run build:portable -w web</code>) and open <code>nexora.html</code> straight from your phone or laptop. It talks to Arkiv directly.</p>
      <h3 id="network">Network</h3>
    </>
  );
}

function Hindi() {
  return (
    <>
      <h2>यह कैसे काम करता है</h2>
      <p>
        इंदौर का चाय विक्रेता और सूरत की साड़ी विक्रेता, दोनों कुछ हज़ार रुपये Instagram, WhatsApp या Meesho पर विज्ञापन आज़माने में लगाते हैं।
        जो सीखते हैं वो या तो उनके दिमाग में रह जाता है, या किसी प्लेटफ़ॉर्म के डैशबोर्ड में, जो कभी भी अपने आँकड़े, नियम या दाम बदल सकता है।
        Nexora इन प्रयोगों की एक साझा बही है, जिसकी मालिक कोई कंपनी नहीं।
      </p>
      <ol>
        <li><b>नतीजा दर्ज करें।</b> श्रेणी, प्लेटफ़ॉर्म, विज्ञापन का प्रकार, भाषा, इलाका और त्योहार, सब तय सूचियों से। खर्च एक रेंज बन जाता है और मुनाफ़ा 10% तक गोल होता है; असली रकम या तो मिटा दी जाती है या आपके ब्राउज़र में ही एन्क्रिप्ट होती है।</li>
        <li><b>यह Arkiv पर लिखा जाता है</b> <em>आपके</em> वॉलेट से (आपके लिए एक अस्थायी टेस्ट वॉलेट बन जाता है), सिर्फ़ पढ़ने के लिए, और उतने समय के लिए जितना आप चुनें।</li>
        <li><b>कोई भी इसे खोज सकता है:</b> यह साइट, कमांड-लाइन टूल, या कोई भी Arkiv ऐप, हर सूची के नीचे दिखी असली क्वेरी से।</li>
        <li><b>पूछिए क्या आज़माएँ।</b> सुझाव में सिर्फ़ वही तरीके आते हैं जिन्हें कम से कम दो अलग विक्रेताओं ने परखा हो, और हर सुझाव के साथ उसका सबूत है। एक टैप में अपने WhatsApp ग्रुप में भेजिए।</li>
        <li><b>चुनिए किस पर भरोसा करें।</b> उन समुदायों की भरोसा सूचियों से छाँटिए जिन्हें आप जानते हैं। छँटाई Arkiv के <code>$creator</code> से होती है, जिसे कोई नकली नहीं बना सकता।</li>
      </ol>
      <h3>Arkiv पर क्या है, और जानबूझकर क्या नहीं</h3>
      <ul>
        <li>Arkiv पर: तय सूचियों वाली प्रयोग की जानकारी (खोजने लायक), विज्ञापन के चुनाव, वैकल्पिक एन्क्रिप्टेड असली आँकड़े, भरोसा सूचियाँ।</li>
        <li>Arkiv पर कभी नहीं: नाम, फ़ोन नंबर, दुकान का नाम, उत्पाद का नाम, फ़ोटो, विज्ञापन का टेक्स्ट, ग्राहकों की जानकारी, पासफ़्रेज़।</li>
        <li>Nexora का कोई डेटाबेस नहीं है। सर्वर पर सिर्फ़ एक वैकल्पिक मददगार चलता है जो नए वॉलेट को थोड़े टेस्ट GLM भेजता है।</li>
      </ul>
      <h3>अगर यह वेबसाइट बंद हो जाए</h3>
      <p>तो भी डेटा रहेगा। MIT लाइसेंस वाला कोड लेकर <code>npx tsx ledger/cli.ts query --demo</code> चलाइए, या एक-फ़ाइल वाला वर्ज़न (<code>npm run build:portable -w web</code>) बनाकर <code>nexora.html</code> सीधे अपने फ़ोन या लैपटॉप से खोलिए। यह सीधे Arkiv से बात करती है।</p>
      <h3 id="network">नेटवर्क</h3>
    </>
  );
}

export function About() {
  const { rpcUrl, setRpcUrl, reader } = useArkiv();
  const { lang } = useI18n();
  const [draft, setDraft] = useState(rpcUrl);
  const [check, setCheck] = useState<string | null>(null);
  const hi = lang === "hi";

  return (
    <section className="prose">
      {hi ? <Hindi /> : <English />}
      <p className="small">
        {hi ? "यह ब्राउज़र यहाँ से पढ़ता है:" : "This browser reads from"} <code className="mono">{rpcUrl}</code>.{" "}
        {hi ? "अगर यह बंद या ब्लॉक हो, तो कोई दूसरा Arkiv Tiramisu नोड डालें।" : "If that endpoint is blocked or down, point it at any other Arkiv Tiramisu node."}
      </p>
      <div className="row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="secondary" onClick={() => setRpcUrl(draft === TIRAMISU_RPC ? null : draft)}>{hi ? "यह RPC इस्तेमाल करें" : "Use this RPC"}</button>
        <button className="link" onClick={() => { setDraft(TIRAMISU_RPC); setRpcUrl(null); }}>{hi ? "रीसेट" : "reset"}</button>
        <button className="link" onClick={() => reader.getBlockNumber().then((b) => setCheck(`OK, ${hi ? "ब्लॉक" : "block"} ${b}`), (e: Error) => setCheck(`${hi ? "नहीं चला" : "Failed"}: ${e.message}`))}>{hi ? "जाँचें" : "test"}</button>
      </div>
      {check && <p className="small">{check}</p>}
    </section>
  );
}
