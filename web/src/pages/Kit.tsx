import qrcode from "qrcode-generator";
import { useMemo, useState } from "react";
import { WhatsAppButton } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { appUrl } from "../share.ts";

/** Where the poster's QR code points: this host, or the main one when opened from the single file. */
const HOME = /^https?:$/.test(location.protocol) ? appUrl("#/?ui=hi") : "https://nexora-pi-snowy.vercel.app/#/?ui=hi";

/** A QR code drawn as SVG squares from the encoder's matrix; no generated markup is injected. */
function Qr({ text, label }: { text: string; label: string }) {
  const cells = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(text);
    code.make();
    const n = code.getModuleCount();
    const dark: [number, number][] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) dark.push([r, c]);
    return { n, dark };
  }, [text]);
  return (
    <svg className="qr" viewBox={`-4 -4 ${cells.n + 8} ${cells.n + 8}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-4} y={-4} width={cells.n + 8} height={cells.n + 8} fill="#fff" />
      {cells.dark.map(([r, c]) => <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#000" />)}
    </svg>
  );
}

/**
 * For unions and riders' groups: a poster to print for a rider hub, dark-store waiting area or
 * auto stand, in Hindi and English with a QR code, the same invitation as a WhatsApp message, and a
 * short guide to getting real entries honestly. Nothing here collects anything from workers.
 */
export function Kit() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const message = t("kitMessage", { url: HOME });
  return (
    <section className="kit-page">
      <h2>{t("kitTitle")}</h2>
      <p className="lead-small">{t("kitIntro")}</p>
      <p className="row no-print">
        <button onClick={() => print()}>{t("kitPrint")}</button>
        <WhatsAppButton text={message} />
        <button className="secondary" onClick={() => void navigator.clipboard?.writeText(message).then(() => setCopied(true))}>{copied ? t("copied") : t("kitCopy")}</button>
      </p>

      <article className="poster" aria-label={t("kitPosterLabel")}>
        <p className="poster-kicker">डिलीवरी · कैब · बाइक-टैक्सी · ऑटो &nbsp;|&nbsp; Delivery · cab · bike taxi · auto</p>
        <h3 className="poster-title">आपकी असली कमाई, आपकी अपनी रिपोर्ट<span>Your real take-home, reported by you</span></h3>
        <div className="poster-body">
          <ol className="poster-steps">
            <li><b>QR स्कैन करें</b><span>Scan the QR code</span></li>
            <li><b>30 सेकंड में अपना दिन दर्ज करें: कमाई, खर्च, घंटे</b><span>Log your day in 30 seconds: pay, costs, hours</span></li>
            <li><b>देखें आपके शहर में कौन-सा ऐप सच में ज़्यादा देता है</b><span>See which app really pays more in your city</span></li>
            <li><b>ID ब्लॉक या पे कट दर्ज करें, और अपने अधिकार जानें</b><span>Report an ID block or pay cut, and know your rights</span></li>
          </ol>
          <figure className="poster-qr">
            <Qr text={HOME} label={t("kitQrLabel")} />
            <figcaption className="mono">{HOME.replace(/^https?:\/\//, "").replace(/\?ui=hi$/, "")}</figcaption>
          </figure>
        </div>
        <ul className="poster-promises">
          <li>न नाम, न फ़ोन नंबर · No name, no phone number</li>
          <li>कोई साइन-अप नहीं · No sign-up</li>
          <li>कोई कंपनी इसे बदल या मिटा नहीं सकती · No company can edit or delete it</li>
        </ul>
        <p className="poster-foot">Nexora · हिंदी, English, ಕನ್ನಡ, தமிழ் · open source</p>
      </article>

      <div className="card no-print">
        <h3>{t("kitGuideTitle")}</h3>
        <ol className="kit-guide">
          <li>{t("kitGuide1")}</li>
          <li>{t("kitGuide2")}</li>
          <li>{t("kitGuide3")}</li>
          <li>{t("kitGuide4")}</li>
          <li>{t("kitGuide5")}</li>
        </ol>
        <p className="row"><a className="button secondary" href="#/trust">{t("kitToTrust")}</a> <a className="button secondary" href="#/rights">{t("navRights")}</a></p>
      </div>
    </section>
  );
}
