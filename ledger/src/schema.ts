/**
 * The Nexora data contract, version 1.
 *
 * Every value that becomes a queryable Arkiv attribute is drawn from a closed vocabulary below.
 * Closed vocabularies are a privacy decision as much as a data-quality one: a seller can never type
 * a name, phone number or shop address into an attribute, because there is no free-text attribute.
 */

export const APP = "nexora";
export const SCHEMA_VERSION = 1;

export const KIND = {
  experiment: "experiment",
  trustList: "trust_list",
} as const;

export const CATEGORIES = [
  "tea_coffee",
  "snacks_sweets",
  "spices_pickles",
  "ethnic_apparel",
  "sarees_textiles",
  "handicrafts",
  "jewellery",
  "beauty_ayurveda",
  "home_decor",
  "mobile_accessories",
  "books_stationery",
  "coaching_tuition",
  "cloud_kitchen",
  "fitness",
  "other",
] as const;

export const PLATFORMS = [
  "instagram",
  "facebook",
  "whatsapp",
  "youtube",
  "google_search",
  "meesho",
  "amazon",
  "flipkart",
  "sharechat",
  "moj",
  "telegram",
] as const;

export const FORMATS = [
  "reel",
  "story",
  "carousel",
  "static_image",
  "long_video",
  "search_text",
  "status",
  "broadcast",
  "influencer",
  "listing_boost",
] as const;

export const LANGUAGES = ["hi", "en", "hinglish", "ta", "te", "kn", "ml", "mr", "bn", "gu", "pa", "or"] as const;

export const TIERS = ["metro", "tier1", "tier2", "tier3", "rural", "pan_india"] as const;

export const SEASONS = ["none", "diwali", "holi", "eid", "wedding", "rakhi", "onam_pongal", "monsoon", "sale_event"] as const;

export const TONES = ["festive", "emotional", "humorous", "informative", "testimonial", "urgency"] as const;
export const CTAS = ["shop_now", "whatsapp_us", "call_now", "dm_us", "visit_store", "learn_more"] as const;
export const OFFERS = ["none", "discount", "free_shipping", "combo", "cod", "first_order"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Platform = (typeof PLATFORMS)[number];
export type Format = (typeof FORMATS)[number];
export type Language = (typeof LANGUAGES)[number];
export type Tier = (typeof TIERS)[number];
export type Season = (typeof SEASONS)[number];
export type Tone = (typeof TONES)[number];
export type Cta = (typeof CTAS)[number];
export type Offer = (typeof OFFERS)[number];

/**
 * Spend is published as a band, never as an exact rupee figure. The upper bound of each band is
 * exclusive; the last band is open-ended.
 */
export const SPEND_BANDS_INR = [500, 2_000, 5_000, 20_000, 100_000] as const;
export const SPEND_BAND_LABELS = ["< ₹500", "₹500–2k", "₹2k–5k", "₹5k–20k", "₹20k–1L", "≥ ₹1L"] as const;

export function spendBand(spendInr: number): number {
  const index = SPEND_BANDS_INR.findIndex((upper) => spendInr < upper);
  return index === -1 ? SPEND_BANDS_INR.length : index;
}

/** ROI is published rounded to the nearest 10 percentage points, clamped to [-100, 1000]. */
export const ROI_STEP = 10;
export const ROI_MIN = -100;
export const ROI_MAX = 1000;

export function roiPct(spendInr: number, revenueInr: number): number {
  if (!(spendInr > 0)) throw new Error("Spend must be greater than zero to compute ROI.");
  const raw = ((revenueInr - spendInr) / spendInr) * 100;
  const rounded = Math.round(raw / ROI_STEP) * ROI_STEP;
  return Math.max(ROI_MIN, Math.min(ROI_MAX, rounded)) || 0;
}

export const MAX_DAYS = 90;
export const MAX_TRUST_MEMBERS = 25;
export const MAX_NAME_LENGTH = 48;

/** Lifetimes a seller may pick for a published experiment. */
export const EXPIRY_CHOICES_DAYS = [7, 30, 90, 365] as const;
export const TRUST_LIST_DAYS = 180;
/** How much a "keep alive" extension adds. */
export const EXTEND_DAYS = 30;

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}
