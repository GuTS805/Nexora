import { createContext, useContext, useState, type ReactNode } from "react";
import { store } from "./storage.ts";
import { STRINGS, type StringKey } from "./strings.ts";
import { REGIONAL, REGIONAL_VOCAB, type RegionalLang } from "./strings-regional.ts";

/** The language of whole documents (letters, reports, dates, voice): English or Hindi. */
export type Lang = "en" | "hi";
/** The language of the screen: also Kannada and Tamil, machine-translated, English where not. */
export type UiLang = Lang | RegionalLang;
export const UI_LANGS: [UiLang, string][] = [["en", "EN"], ["hi", "हिंदी"], ["kn", "ಕನ್ನಡ"], ["ta", "தமிழ்"]];
const isUiLang = (value: unknown): value is UiLang => UI_LANGS.some(([code]) => code === value);

export type { StringKey };

/** Labels for the closed vocabularies. Unlisted values fall back to a readable form of the code. */
const VOCAB: Record<string, [string, string]> = {
  swiggy: ["Swiggy", "स्विगी"], zomato: ["Zomato", "ज़ोमैटो"], blinkit: ["Blinkit", "ब्लिंकिट"], zepto: ["Zepto", "ज़ेप्टो"],
  bigbasket: ["BigBasket", "बिगबास्केट"], amazon: ["Amazon", "अमेज़न"], flipkart: ["Flipkart", "फ़्लिपकार्ट"],
  uber: ["Uber", "उबर"], ola: ["Ola", "ओला"], rapido: ["Rapido", "रैपिडो"], porter: ["Porter", "पोर्टर"],
  urban_company: ["Urban Company", "अर्बन कंपनी"], other: ["Other", "अन्य"],
  food_delivery: ["Food delivery", "खाना डिलीवरी"], grocery_delivery: ["Grocery / quick delivery", "राशन / क्विक डिलीवरी"],
  parcel_delivery: ["Parcel delivery", "पार्सल डिलीवरी"], cab: ["Cab", "कैब"], bike_taxi: ["Bike taxi", "बाइक टैक्सी"],
  auto: ["Auto", "ऑटो"], home_services: ["Home services", "घरेलू सेवाएँ"],
  delhi_ncr: ["Delhi NCR", "दिल्ली NCR"], mumbai: ["Mumbai", "मुंबई"], bengaluru: ["Bengaluru", "बेंगलुरु"],
  hyderabad: ["Hyderabad", "हैदराबाद"], chennai: ["Chennai", "चेन्नई"], kolkata: ["Kolkata", "कोलकाता"],
  pune: ["Pune", "पुणे"], ahmedabad: ["Ahmedabad", "अहमदाबाद"], jaipur: ["Jaipur", "जयपुर"],
  lucknow: ["Lucknow", "लखनऊ"], indore: ["Indore", "इंदौर"], kochi: ["Kochi", "कोच्चि"],
  chandigarh: ["Chandigarh", "चंडीगढ़"], other_city: ["Other city", "दूसरा शहर"],
  bicycle: ["Bicycle", "साइकिल"], ev_scooter: ["Electric scooter", "इलेक्ट्रिक स्कूटर"], petrol_bike: ["Petrol bike", "पेट्रोल बाइक"],
  car: ["Car", "कार"], none: ["None", "कोई नहीं"],
  met: ["Met", "पूरा हुआ"], missed: ["Missed", "छूट गया"],
  id_blocked: ["ID blocked for a while", "ID कुछ समय के लिए ब्लॉक"], deactivated: ["ID permanently deactivated", "ID हमेशा के लिए बंद"],
  pay_cut: ["Pay per order / km cut", "हर ऑर्डर / किलोमीटर का पैसा घटा"], incentive_cut: ["Incentive cut or target raised", "इंसेंटिव घटा या टारगेट बढ़ा"],
  penalty: ["Unexplained penalty or deduction", "बिना वजह जुर्माना या कटौती"], payout_delayed: ["Payout delayed", "पेमेंट में देरी"],
  received: ["Received, looking into it", "मिल गई, देख रहे हैं"], taken_up: ["Taken up, working on it", "मामला उठाया, इस पर काम चल रहा है"],
  escalated: ["Escalated to the labour department or board", "श्रम विभाग या बोर्ड तक ले गए"], resolved: ["Resolved", "सुलझ गया"],
  cannot_help: ["Cannot help with this", "इसमें मदद नहीं कर सकते"],
  unsafe_pressure: ["Unsafe delivery-time pressure", "डिलीवरी टाइम का खतरनाक दबाव"], harassment: ["Abuse or violence at work", "काम पर गाली-गलौज या मारपीट"],
};

type Vars = Record<string, string | number>;
type I18n = { lang: Lang; ui: UiLang; setLang: (lang: UiLang) => void; t: (key: StringKey, vars?: Vars) => string; v: (code: string) => string };

const Context = createContext<I18n | null>(null);

function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [ui, setUi] = useState<UiLang>(() => {
    // A shared link can carry the sender's language (?ui=hi), so a Hindi WhatsApp share opens in Hindi.
    const fromLink = new URLSearchParams(location.hash.split("?")[1] ?? "").get("ui");
    if (isUiLang(fromLink)) return fromLink;
    const saved = store.get("lang");
    return isUiLang(saved) ? saved : "en";
  });
  const lang: Lang = ui === "hi" ? "hi" : "en";
  const index = lang === "hi" ? 1 : 0;
  const regional = ui === "kn" || ui === "ta" ? ui : null;
  if (typeof document !== "undefined") document.documentElement.lang = ui;
  const value: I18n = {
    lang,
    ui,
    setLang: (next) => {
      setUi(next);
      store.set("lang", next);
      document.documentElement.lang = next;
    },
    t: (key, vars) => fill((regional && REGIONAL[key]?.[regional]) || STRINGS[key][index], vars),
    v: (code) => (regional && REGIONAL_VOCAB[code]?.[regional]) || VOCAB[code]?.[index] || code.replace(/_/g, " "),
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error("useI18n outside provider");
  return value;
}
