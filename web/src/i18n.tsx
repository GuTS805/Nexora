import { createContext, useContext, useState, type ReactNode } from "react";
import { store } from "./storage.ts";

export type Lang = "en" | "hi";

const STRINGS = {
  tagline: ["What actually worked for sellers like you — ads tested by real small businesses, open to everyone.", "आप जैसे विक्रेताओं के लिए असल में क्या चला — छोटे व्यापारियों के आज़माए विज्ञापन, सबके लिए खुले।"],
  navExplore: ["Explore", "देखें"],
  navAdvisor: ["What to try", "क्या आज़माएँ"],
  navLog: ["Log a result", "नतीजा दर्ज करें"],
  navMine: ["My data", "मेरा डेटा"],
  navTrust: ["Trust lists", "भरोसा सूचियाँ"],
  navAbout: ["How it works", "यह कैसे काम करता है"],
  category: ["Product category", "उत्पाद श्रेणी"],
  platform: ["Platform", "प्लेटफ़ॉर्म"],
  format: ["Ad format", "विज्ञापन प्रकार"],
  lang: ["Ad language", "विज्ञापन की भाषा"],
  tier: ["Where buyers are", "ग्राहक कहाँ हैं"],
  season: ["Season / festival", "मौसम / त्योहार"],
  tone: ["Tone", "अंदाज़"],
  cta: ["Call to action", "ग्राहक से क्या कहा"],
  offer: ["Offer", "ऑफ़र"],
  spend: ["Total spend (₹)", "कुल खर्च (₹)"],
  revenue: ["Sales from this ad (₹)", "इस विज्ञापन से बिक्री (₹)"],
  days: ["Ran for (days)", "कितने दिन चला"],
  any: ["Any", "कोई भी"],
  allPublishers: ["All publishers", "सभी प्रकाशक"],
  onlyMine: ["Only mine", "सिर्फ़ मेरे"],
  showDemo: ["Include synthetic demo data", "डेमो (कृत्रिम) डेटा दिखाएँ"],
  publish: ["Publish to Arkiv", "Arkiv पर प्रकाशित करें"],
  publishing: ["Publishing…", "प्रकाशित हो रहा है…"],
  roi: ["ROI", "मुनाफ़ा %"],
  publishers: ["sellers", "विक्रेता"],
  experiments: ["experiments", "प्रयोग"],
  loading: ["Reading from Arkiv…", "Arkiv से पढ़ रहे हैं…"],
  empty: ["No experiments match yet. Be the first to publish one.", "अभी कोई प्रयोग नहीं मिला। पहला प्रकाशित करें।"],
  getAdvice: ["Show me what to try", "बताइए क्या आज़माऊँ"],
  keepAlive: ["Keep alive +30 days", "30 दिन और रखें"],
  delete: ["Delete", "हटाएँ"],
  unseal: ["Unlock exact figures", "असली आँकड़े खोलें"],
  passphrase: ["Passphrase (stays on this device)", "पासफ़्रेज़ (इसी डिवाइस पर रहता है)"],
  expiry: ["Keep this public for", "इसे कितने समय तक सार्वजनिक रखें"],
  daysUnit: ["days", "दिन"],
} as const;

export type StringKey = keyof typeof STRINGS;

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

type I18n = { lang: Lang; setLang: (lang: Lang) => void; t: (key: StringKey) => string; v: (code: string) => string };

const Context = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (store.get("lang") === "hi" ? "hi" : "en"));
  const index = lang === "hi" ? 1 : 0;
  const value: I18n = {
    lang,
    setLang: (next) => {
      setLangState(next);
      store.set("lang", next);
      document.documentElement.lang = next;
    },
    t: (key) => STRINGS[key][index],
    v: (code) => VOCAB[code]?.[index] ?? code.replace(/_/g, " "),
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error("useI18n outside provider");
  return value;
}
