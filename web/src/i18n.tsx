import { createContext, useContext, useState, type ReactNode } from "react";
import { store } from "./storage.ts";
import { STRINGS, type StringKey } from "./strings.ts";

export type Lang = "en" | "hi";

export type { StringKey };

/** Labels for the closed vocabularies. Unlisted values fall back to a readable form of the code. */
const VOCAB: Record<string, [string, string]> = {
  tea_coffee: ["Tea & coffee", "चाय-कॉफ़ी"], snacks_sweets: ["Snacks & sweets", "नमकीन-मिठाई"],
  spices_pickles: ["Spices & pickles", "मसाले-अचार"], ethnic_apparel: ["Ethnic wear", "पारंपरिक कपड़े"],
  sarees_textiles: ["Sarees & textiles", "साड़ी-कपड़ा"], handicrafts: ["Handicrafts", "हस्तशिल्प"],
  jewellery: ["Jewellery", "आभूषण"], beauty_ayurveda: ["Beauty & Ayurveda", "सौंदर्य-आयुर्वेद"],
  home_decor: ["Home decor", "घर की सजावट"], mobile_accessories: ["Mobile accessories", "मोबाइल एक्सेसरीज़"],
  books_stationery: ["Books & stationery", "किताबें-स्टेशनरी"], coaching_tuition: ["Coaching & tuition", "कोचिंग-ट्यूशन"],
  cloud_kitchen: ["Home / cloud kitchen", "घर का खाना / क्लाउड किचन"], fitness: ["Fitness", "फ़िटनेस"], other: ["Other", "अन्य"],
  instagram: ["Instagram", "इंस्टाग्राम"], facebook: ["Facebook", "फ़ेसबुक"], whatsapp: ["WhatsApp", "व्हाट्सऐप"],
  youtube: ["YouTube", "यूट्यूब"], google_search: ["Google Search", "गूगल सर्च"], meesho: ["Meesho", "मीशो"],
  amazon: ["Amazon", "अमेज़न"], flipkart: ["Flipkart", "फ़्लिपकार्ट"], sharechat: ["ShareChat", "शेयरचैट"],
  moj: ["Moj", "मोज"], telegram: ["Telegram", "टेलीग्राम"],
  reel: ["Reel / short video", "रील / छोटा वीडियो"], story: ["Story", "स्टोरी"], carousel: ["Carousel", "कैरोसेल"],
  static_image: ["Single image", "एक फ़ोटो"], long_video: ["Long video", "लंबा वीडियो"], search_text: ["Search text ad", "सर्च टेक्स्ट विज्ञापन"],
  status: ["Status post", "स्टेटस"], broadcast: ["Broadcast list", "ब्रॉडकास्ट"], influencer: ["Influencer post", "इन्फ़्लुएंसर"],
  listing_boost: ["Marketplace listing boost", "लिस्टिंग बूस्ट"],
  hi: ["Hindi", "हिंदी"], en: ["English", "अंग्रेज़ी"], hinglish: ["Hinglish", "हिंग्लिश"], ta: ["Tamil", "तमिल"],
  te: ["Telugu", "तेलुगु"], kn: ["Kannada", "कन्नड़"], ml: ["Malayalam", "मलयालम"], mr: ["Marathi", "मराठी"],
  bn: ["Bengali", "बांग्ला"], gu: ["Gujarati", "गुजराती"], pa: ["Punjabi", "पंजाबी"], or: ["Odia", "ओड़िया"],
  metro: ["Metro city", "महानगर"], tier1: ["Tier-1 city", "टियर-1 शहर"], tier2: ["Tier-2 city", "टियर-2 शहर"],
  tier3: ["Tier-3 town", "टियर-3 कस्बा"], rural: ["Rural / village", "गाँव"], pan_india: ["All India", "पूरा भारत"],
  none: ["None", "कोई नहीं"], diwali: ["Diwali", "दिवाली"], holi: ["Holi", "होली"], eid: ["Eid", "ईद"],
  wedding: ["Wedding season", "शादी का मौसम"], rakhi: ["Rakhi", "राखी"], onam_pongal: ["Onam / Pongal", "ओणम / पोंगल"],
  monsoon: ["Monsoon", "बारिश"], sale_event: ["Big sale event", "बड़ी सेल"],
  festive: ["Festive", "त्योहारी"], emotional: ["Emotional", "भावुक"], humorous: ["Funny", "मज़ेदार"],
  informative: ["Informative", "जानकारी वाला"], testimonial: ["Customer review", "ग्राहक की राय"], urgency: ["Hurry / limited", "जल्दी करें"],
  shop_now: ["Shop now", "अभी खरीदें"], whatsapp_us: ["WhatsApp us", "व्हाट्सऐप करें"], call_now: ["Call now", "कॉल करें"],
  dm_us: ["DM us", "मैसेज करें"], visit_store: ["Visit store", "दुकान आएँ"], learn_more: ["Learn more", "और जानें"],
  discount: ["Discount", "छूट"], free_shipping: ["Free delivery", "मुफ़्त डिलीवरी"], combo: ["Combo pack", "कॉम्बो पैक"],
  cod: ["Cash on delivery", "कैश ऑन डिलीवरी"], first_order: ["First-order offer", "पहले ऑर्डर पर ऑफ़र"],
};

type Vars = Record<string, string | number>;
type I18n = { lang: Lang; setLang: (lang: Lang) => void; t: (key: StringKey, vars?: Vars) => string; v: (code: string) => string };

const Context = createContext<I18n | null>(null);

function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    // A shared link can carry the sender's language (?ui=hi), so a Hindi WhatsApp share opens in Hindi.
    const fromLink = new URLSearchParams(location.hash.split("?")[1] ?? "").get("ui");
    if (fromLink === "hi" || fromLink === "en") return fromLink;
    return store.get("lang") === "hi" ? "hi" : "en";
  });
  const index = lang === "hi" ? 1 : 0;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  const value: I18n = {
    lang,
    setLang: (next) => {
      setLangState(next);
      store.set("lang", next);
      document.documentElement.lang = next;
    },
    t: (key, vars) => fill(STRINGS[key][index], vars),
    v: (code) => VOCAB[code]?.[index] ?? code.replace(/_/g, " "),
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error("useI18n outside provider");
  return value;
}
