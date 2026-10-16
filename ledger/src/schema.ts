/**
 * The Nexora data contract, version 1: what gig workers in India actually earn, and what happens to
 * them at work (ID blocks, pay cuts, penalties).
 *
 * Every value that becomes a queryable Arkiv attribute is drawn from a closed vocabulary below.
 * Closed vocabularies are a privacy decision as much as a data-quality one: a worker can never type
 * a name, phone number, rider ID or address into an attribute, because there is no free-text
 * attribute.
 */

export const APP = "nexora";
export const SCHEMA_VERSION = 1;

export const KIND = {
  shift: "shift",
  incident: "incident",
  trustList: "trust_list",
  reply: "reply",
  guide: "guide",
} as const;

export const PLATFORMS = [
  "swiggy",
  "zomato",
  "blinkit",
  "zepto",
  "bigbasket",
  "amazon",
  "flipkart",
  "uber",
  "ola",
  "rapido",
  "porter",
  "urban_company",
  "other",
] as const;

export const WORK_TYPES = [
  "food_delivery",
  "grocery_delivery",
  "parcel_delivery",
  "cab",
  "bike_taxi",
  "auto",
  "home_services",
] as const;

/**
 * Which kinds of work each platform offers. Keeps the form honest; readers do not reject other
 * pairs, because platforms add services faster than any contract can track.
 */
export const PLATFORM_WORK: Readonly<Record<(typeof PLATFORMS)[number], readonly (typeof WORK_TYPES)[number][]>> = {
  swiggy: ["food_delivery", "grocery_delivery"],
  zomato: ["food_delivery"],
  blinkit: ["grocery_delivery"],
  zepto: ["grocery_delivery"],
  bigbasket: ["grocery_delivery"],
  amazon: ["parcel_delivery", "grocery_delivery"],
  flipkart: ["parcel_delivery", "grocery_delivery"],
  uber: ["cab", "bike_taxi", "auto"],
  ola: ["cab", "bike_taxi", "auto"],
  rapido: ["bike_taxi", "auto", "cab"],
  porter: ["parcel_delivery"],
  urban_company: ["home_services"],
  other: [...WORK_TYPES],
};

export function workFor(platform: (typeof PLATFORMS)[number]): readonly (typeof WORK_TYPES)[number][] {
  return PLATFORM_WORK[platform];
}

export const CITIES = [
  "delhi_ncr",
  "mumbai",
  "bengaluru",
  "hyderabad",
  "chennai",
  "kolkata",
  "pune",
  "ahmedabad",
  "jaipur",
  "lucknow",
  "indore",
  "kochi",
  "chandigarh",
  "other_city",
] as const;

export const VEHICLES = ["bicycle", "ev_scooter", "petrol_bike", "auto", "car", "none"] as const;

/** Whether the day's incentive target was met. Shown and counted, never filtered on. */
export const INCENTIVES = ["met", "missed", "none"] as const;

export const INCIDENT_TYPES = [
  "id_blocked",
  "deactivated",
  "pay_cut",
  "incentive_cut",
  "penalty",
  "payout_delayed",
  "unsafe_pressure",
  "harassment",
] as const;

/**
 * Where a union, worker group or platform says a report stands. A reply is its own read-only entity
 * pointing at the report through `parent`; it never changes the report, and only the reporter's own
 * updates mark a report resolved. Closed vocabulary again: a reply cannot carry a name or a phone
 * number either.
 */
export const REPLY_STATUSES = ["received", "taken_up", "escalated", "resolved", "cannot_help"] as const;

export type Platform = (typeof PLATFORMS)[number];
export type WorkType = (typeof WORK_TYPES)[number];
export type City = (typeof CITIES)[number];
export type Vehicle = (typeof VEHICLES)[number];
export type Incentive = (typeof INCENTIVES)[number];
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

/**
 * Hours logged in are published as a band, never exactly. The upper bound of each band is
 * exclusive; the last band is open-ended.
 */
export const HOURS_BANDS = [4, 8, 10, 12, 14] as const;
export const HOURS_BAND_LABELS = ["< 4 h", "4–8 h", "8–10 h", "10–12 h", "12–14 h", "14 h +"] as const;

/**
 * Day-length filters over `hours_band`, shared by the app and the CLI, as band indexes into
 * HOURS_BAND_LABELS. Long days often pay a different rate per hour (incentive targets reward them),
 * so "what do full days pay" is a question of its own.
 */
export const DAY_LENGTHS = {
  under8: { max: 1 },
  "8plus": { min: 2 },
  "10plus": { min: 3 },
  "12plus": { min: 4 },
} as const satisfies Record<string, { min?: number; max?: number }>;
export type DayLength = keyof typeof DAY_LENGTHS;

export function hoursBand(hours: number): number {
  const index = HOURS_BANDS.findIndex((upper) => hours < upper);
  return index === -1 ? HOURS_BANDS.length : index;
}

/**
 * Take-home per logged-in hour, after the day's fuel, maintenance and data costs, rounded to ₹10.
 * Logged-in time includes waiting for orders, which is the honest denominator: it is the time the
 * worker could not spend elsewhere.
 */
export const NET_STEP = 10;
export const NET_MIN = -500;
export const NET_MAX = 2_000;

export function netHourly(grossInr: number, costsInr: number, hours: number): number {
  if (!(hours > 0)) throw new Error("Hours must be greater than zero.");
  const rounded = Math.round((grossInr - costsInr) / hours / NET_STEP) * NET_STEP;
  return Math.max(NET_MIN, Math.min(NET_MAX, rounded)) || 0;
}

/** Costs as a share of the day's gross, rounded to 10 percentage points, clamped to 0–100. */
export const COST_STEP = 10;

export function costPct(grossInr: number, costsInr: number): number {
  if (costsInr <= 0) return 0;
  if (grossInr <= 0) return 100;
  const rounded = Math.round((costsInr / grossInr) * 100 / COST_STEP) * COST_STEP;
  return Math.max(0, Math.min(100, rounded));
}

/** Months are published as YYYYMM integers, e.g. 202610, so ranges ("since August") are queries. */
export const PERIOD_MIN = 202401;
export const PERIOD_MAX = 203012;

export function isPeriod(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < PERIOD_MIN || value > PERIOD_MAX) return false;
  const month = value % 100;
  return month >= 1 && month <= 12;
}

export function periodOf(date: Date): number {
  return date.getFullYear() * 100 + date.getMonth() + 1;
}

/** The month before `period`, e.g. 202601 → 202512. */
export function previousPeriod(period: number): number {
  return period % 100 === 1 ? period - 100 + 11 : period - 1;
}

/** Days without work after an incident, capped so one outlier cannot dominate a median. */
export const MAX_DAYS_LOST = 90;
export const MAX_HOURS = 24;
export const MAX_DAY_INR = 50_000;
export const MAX_TRUST_MEMBERS = 25;
export const MAX_NAME_LENGTH = 48;

/** Lifetimes a worker may pick for a published entry. */
export const EXPIRY_CHOICES_DAYS = [7, 30, 90, 365] as const;
export const TRUST_LIST_DAYS = 180;
/** How much a "keep alive" extension adds. */
export const EXTEND_DAYS = 30;

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}
