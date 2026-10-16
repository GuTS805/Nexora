/**
 * Conformance test vectors for the Nexora Ledger v1 contract: entities that MUST be accepted and
 * entities that MUST be rejected, each with the reason. They let an implementation in any language
 * check itself against the JSON Schemas in arkiv/schema/ without running this code.
 *
 * Valid vectors are built by the codec, so they are exactly what Nexora writes. Invalid ones are the
 * same entities changed the way a careless or hostile writer could: an exact figure, a name, an
 * off-vocabulary value, an editable entity. Run `npm run vectors -w nexora-ledger` after changing the
 * contract; the tests fail if arkiv/vectors/vectors.json falls behind.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toWire, type ContractKind, type WireEntity } from "./src/contract.ts";
import { guideCreate, incidentCreate, replyCreate, shiftCreate, trustListCreate, MAX_DAYS_LOST, MAX_NAME_LENGTH, type SealedBox } from "./src/index.ts";

/** `at`, for an invalid vector, is the JSON Pointer under which a validator must report the problem. */
export type Vector = { id: string; kind: ContractKind; valid: boolean; description: string; at?: string; entity: WireEntity };

/** A real box, sealed once with the passphrase "test vector passphrase", so the file never changes. */
const SEALED: SealedBox = {
  alg: "AES-256-GCM", kdf: "PBKDF2-SHA256", iter: 600_000, salt: "qXKoCSiYmCFu9wpgwo3LVQ==", iv: "yDrSnoxfONye80cE",
  ct: "Wk+8D6XEiRSWw5pebziolrltbWARXen0TDPBXLF9VTktNcVzJkh/AYh9Gm7Vw3HHTMY51rQt/iR2gonCYHbkWLAE7h0Hmt+CPhhdKkbcT1O+h5EBHmTfluKeTtshRDaz8Y99gErphKZFRhQA0NIFlD2LFKPmScoxG4MvASluv17+c+QrbZPYfnBiqqLpIyLFngzkOUnR5Ur9MQVDiYU8e6Irh94UymkBE88ZgwOYmE1KR6uACft51M6rF6pDJlgLZbLlbz2doYIi1i9SBXhhNhaVImLCwuEhSXj1QCTK6f11qpNz84R9UhNQjImbLs14CFk9ubVJ3qTSI5sa88MKUTdTTOcDE4wC4fTQnx8ao4k=",
};

const REPORT = `0x${"0e".repeat(32)}` as const;
const MEMBERS = ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"] as const;

const shift = () => toWire(shiftCreate({
  platform: "swiggy", work: "food_delivery", city: "bengaluru", vehicle: "petrol_bike", period: 202610,
  grossInr: 1_180, costsInr: 240, hours: 9.5, incentive: "met", expiresInDays: 365, demo: false,
}));
const sealedShift = () => toWire(shiftCreate({
  platform: "blinkit", work: "grocery_delivery", city: "pune", vehicle: "ev_scooter", period: 202609,
  grossInr: 900, costsInr: 60, hours: 8, incentive: "none", expiresInDays: 90, demo: true, sealed: SEALED,
}));
const incident = () => toWire(incidentCreate({
  platform: "zomato", work: "food_delivery", city: "delhi_ncr", type: "id_blocked", period: 202610, daysLost: 6,
  reasonGiven: false, appealed: true, resolved: false, expiresInDays: 365, demo: false,
}));
const update = () => toWire(incidentCreate({
  platform: "zomato", work: "food_delivery", city: "delhi_ncr", type: "id_blocked", period: 202610, daysLost: 6,
  reasonGiven: true, appealed: true, resolved: true, expiresInDays: 365, demo: false, parent: REPORT, sealed: SEALED,
}));
const reply = () => toWire(replyCreate({ parent: REPORT, status: "escalated", period: 202610, expiresInDays: 365 }));
const list = () => toWire(trustListCreate({ name: "Bengaluru riders union", scope: "food_delivery", description: "Members we have met in person.", members: [...MEMBERS] }));
const law = () => toWire(guideCreate({
  scope: "karnataka", topic: "law", title: "A state gig-worker law", status: "In force.",
  points: ["Fourteen days' notice before termination."], sources: [{ label: "The Act", url: "https://example.org/act" }], checked: "2026-10-16",
  hi: { title: "एक राज्य कानून", status: "लागू है।", points: ["हटाने से पहले 14 दिन का नोटिस।"] },
}));
const rating = () => toWire(guideCreate({
  scope: "india", topic: "rating", title: "An independent rating", status: "Published in 2024.",
  points: ["Scored out of 10."], sources: [{ label: "The report", url: "https://example.org/report.pdf" }], scores: { swiggy: 6, uber: 0 }, checked: "2026-10-16",
}));

/** A copy with attributes, payload or flags changed by hand. */
function edit(entity: WireEntity, change: (e: WireEntity) => void): WireEntity {
  const copy = structuredClone(entity);
  change(copy);
  return copy;
}

export function buildVectors(): Vector[] {
  const ok = (id: string, kind: ContractKind, description: string, entity: WireEntity): Vector => ({ id, kind, valid: true, description, entity });
  const bad = (id: string, kind: ContractKind, description: string, at: string, entity: WireEntity): Vector => ({ id, kind, valid: false, description, at, entity });
  return [
    ok("shift-basic", "shift", "A day of food delivery: banded hours, take-home rounded to ₹10, cost share rounded to 10%.", shift()),
    ok("shift-sealed-demo", "shift", "Synthetic demo day with the exact figures in a sealed box.", sealedShift()),
    ok("incident-basic", "incident", "An ID block reported with days lost and three yes/no outcomes.", incident()),
    ok("incident-update", "incident", "The worker's own update to a report, linked by parent, with a sealed note.", update()),
    ok("reply-basic", "reply", "A union says it escalated a report.", reply()),
    ok("trust-list-basic", "trust_list", "A list of wallets a union vouches for, for food delivery.", list()),
    ok("guide-law", "guide", "A state law for gig workers, with its source and a Hindi translation.", law()),
    ok("guide-rating", "guide", "An independent rating of platforms, scored out of 10.", rating()),

    bad("shift-exact-hours-attribute", "shift", "Exact hours as an extra attribute. Only hours_band may be published.", "/attributes", edit(shift(), (e) => { e.attributes.hours = { type: "i32", value: 9 }; })),
    bad("shift-name-attribute", "shift", "A rider's name as an extra attribute: the leak the closed attribute list exists to stop.", "/attributes", edit(shift(), (e) => { e.attributes.rider_name = { type: "str", value: "Ravi" }; })),
    bad("shift-exact-rupees-in-payload", "shift", "The exact day's pay in clear text in the payload.", "/payload", edit(shift(), (e) => { (e.payload as Record<string, unknown>).grossInr = 1_180; })),
    bad("shift-net-not-rounded", "shift", "Take-home per hour of ₹73, not rounded to ₹10.", "/attributes/net_hourly", edit(shift(), (e) => { e.attributes.net_hourly = { type: "i32", value: 73 }; })),
    bad("shift-cost-not-rounded", "shift", "Cost share of 35%, not rounded to 10%.", "/attributes/cost_pct", edit(shift(), (e) => { e.attributes.cost_pct = { type: "i32", value: 35 }; })),
    bad("shift-hours-band-out-of-range", "shift", "An hours band that does not exist (bands are 0–5).", "/attributes/hours_band", edit(shift(), (e) => { e.attributes.hours_band = { type: "i32", value: 9 }; })),
    bad("shift-unknown-city", "shift", "A city outside the closed vocabulary.", "/attributes/city", edit(shift(), (e) => { e.attributes.city = { type: "str", value: "atlantis" }; })),
    bad("shift-untyped-attribute", "shift", "An attribute without its Arkiv type.", "/attributes/city", edit(shift(), (e) => { e.attributes.city = { type: "untyped", value: "bengaluru" }; })),
    bad("shift-editable", "shift", "Created without readonly, so it could be rewritten after others relied on it.", "/flags", edit(shift(), (e) => { e.flags = { readonly: false, permissionlessExtension: true }; })),
    bad("shift-wrong-content-type", "shift", "A payload that is not application/json.", "/contentType", edit(shift(), (e) => { e.contentType = "text/plain"; })),
    bad("shift-future-version", "shift", "Contract version 2. A v1 reader must not guess at it.", "/attributes/v", edit(shift(), (e) => { e.attributes.v = { type: "i32", value: 2 }; })),
    bad("shift-weak-sealed-box", "shift", "A sealed box that claims another cipher.", "/payload/sealed", edit(sealedShift(), (e) => { ((e.payload as Record<string, unknown>).sealed as Record<string, unknown>).alg = "AES-128-CBC"; })),
    bad("incident-unknown-type", "incident", "An incident type outside the closed vocabulary.", "/attributes/type", edit(incident(), (e) => { e.attributes.type = { type: "str", value: "fired_for_complaining" }; })),
    bad("incident-too-many-days", "incident", `More than ${MAX_DAYS_LOST} days lost.`, "/attributes/days_lost", edit(incident(), (e) => { e.attributes.days_lost = { type: "i32", value: MAX_DAYS_LOST + 1 }; })),
    bad("reply-unknown-status", "reply", "A reply status outside the closed vocabulary, which could carry a message.", "/attributes/status", edit(reply(), (e) => { e.attributes.status = { type: "str", value: "call me on this number" }; })),
    bad("trust-list-name-too-long", "trust_list", `A list name longer than ${MAX_NAME_LENGTH} characters.`, "/attributes/name", edit(list(), (e) => { e.attributes.name = { type: "str", value: "x".repeat(MAX_NAME_LENGTH + 1) }; })),
    bad("guide-insecure-source", "guide", "A source that is not an https link.", "/payload/sources/0/url", edit(law(), (e) => { ((e.payload as { sources: { url: string }[] }).sources[0]!).url = "http://example.org/act"; })),
    bad("guide-score-out-of-range", "guide", "A rating above 10.", "/payload/scores/swiggy", edit(rating(), (e) => { (e.payload as { scores: Record<string, number> }).scores.swiggy = 11; })),
    bad("guide-unknown-scope", "guide", "A place outside the closed list of scopes.", "/attributes/scope", edit(law(), (e) => { e.attributes.scope = { type: "str", value: "atlantis" }; })),
  ];
}

export const vectorsFileText = () => `${JSON.stringify({ contract: "nexora ledger v1", schemas: "arkiv/schema/<kind>.schema.json", vectors: buildVectors() }, null, 2)}\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = new URL("../arkiv/vectors/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("vectors.json", dir), vectorsFileText());
  console.log(`arkiv/vectors/vectors.json: ${buildVectors().length} vectors`);
}
