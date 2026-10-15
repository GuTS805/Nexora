/** Inputs and helpers shared by the test files. */
import { getAddress, type Hex } from "viem";
import { decodeIncident, decodeShift, incidentCreate, shiftCreate, type IncidentInput, type RawEntity, type ShiftInput } from "../src/index.ts";


export const ALICE = getAddress("0x1111111111111111111111111111111111111111");
export const BOB = getAddress("0x2222222222222222222222222222222222222222");
export const KEY = `0x${"ab".repeat(32)}` as Hex;

export const shift: ShiftInput = {
  platform: "swiggy", work: "food_delivery", city: "bengaluru", vehicle: "petrol_bike", period: 202610,
  grossInr: 1_180, costsInr: 240, hours: 10, incentive: "met", expiresInDays: 90,
};

export const incident: IncidentInput = {
  platform: "zomato", work: "food_delivery", city: "delhi_ncr", type: "id_blocked", period: 202610,
  daysLost: 4, reasonGiven: false, appealed: true, resolved: false, expiresInDays: 365,
};

/** Simulates what the node hands back for an entity created with `params`. */
export function asStored(params: ReturnType<typeof shiftCreate>, creator = ALICE, key = KEY): RawEntity {
  return {
    key, creator, owner: creator, expiresAt: 1_000_000n, createdAt: 10n,
    creationFlags: { readonly: true, permissionlessExtension: true },
    contentType: params.contentType, payload: params.payload,
    attributes: params.attributes as RawEntity["attributes"],
  };
}

export const keyOf = (i: number) => `0x${i.toString(16).padStart(64, "0")}` as Hex;

export function storedShift(overrides: Partial<ShiftInput>, creator = ALICE, i = 1) {
  const decoded = decodeShift(asStored(shiftCreate({ ...shift, ...overrides }), creator, keyOf(i)));
  if (!decoded.ok) throw new Error(decoded.reason);
  return decoded.value;
}

export function storedIncident(overrides: Partial<IncidentInput>, creator = ALICE, i = 1) {
  const decoded = decodeIncident(asStored(incidentCreate({ ...incident, ...overrides }), creator, keyOf(i)));
  if (!decoded.ok) throw new Error(decoded.reason);
  return decoded.value;
}
