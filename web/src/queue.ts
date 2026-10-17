import { ExpirationTime, type CreateEntityParameters } from "@arkiv-network/sdk";
import { bool, i32, key as keyAttr, str } from "@arkiv-network/sdk/attr";
import { EXPIRY_CHOICES_DAYS, decodeEntry, incidentCreate, shiftCreate, type IncidentInput, type ShiftInput } from "nexora-ledger";
import type { Hex } from "viem";
import { store } from "./storage.ts";

/**
 * Entries written with no network, kept on this device until they can be published. Riders often
 * log a day in a basement parking or on a patchy 2G signal; losing the form there loses the entry.
 *
 * What is kept is exactly what will be published, already banded and rounded, with any private
 * details already sealed: never the exact rupees or hours, and never the passphrase. It is checked
 * again by the same decoder readers use before it is sent. An entry is queued only when the device
 * says it is offline before anything is sent, so nothing that may have reached the chain is queued
 * twice.
 *
 * The same queue sends entries later on purpose. A report published three minutes after an ID block
 * can be matched against the platform's own logs of who was blocked then; a worker can instead have
 * it sent at a random moment one to six hours later. The one-time wallet is created and funded only
 * at that moment too, so neither the write nor its gas points back to when the form was filled in.
 */

/** What the form produces. */
export type FormEntry = { kind: "shift"; input: ShiftInput } | { kind: "incident"; input: IncidentInput };

type Lifetime = (typeof EXPIRY_CHOICES_DAYS)[number];

/** The entity as it will be written, in a form that survives JSON. */
export type QueuedEntry = {
  kind: "shift" | "incident";
  attributes: Record<string, { type: string; value: unknown }>;
  /** The JSON payload, as text. */
  payload: string;
  expiresInDays: Lifetime;
};

export type Pending = {
  id: string;
  savedAt: number;
  entry: QueuedEntry;
  /** Publish from a fresh one-time wallet, as the worker chose in the form. */
  oneOff: boolean;
  /** Publish from the wallet for this month (yyyymm), as the worker chose for an earnings entry. */
  month?: number;
  /** Hand to 0x…dEaD in the same transaction. */
  lock: boolean;
  /** Not sent before this time (ms since epoch): a random delay the worker chose, to hide when they wrote it. */
  notBefore?: number;
};

/** The window for a delayed send: at least one hour, at most six. */
export const DELAY_MIN_MS = 60 * 60 * 1000;
export const DELAY_MAX_MS = 6 * 60 * 60 * 1000;

/** A moment picked uniformly at random from the delay window, with the browser's secure randomness. */
export function randomSendTime(now = Date.now()): number {
  const [word] = crypto.getRandomValues(new Uint32Array(1));
  return now + DELAY_MIN_MS + Math.floor((word! / 2 ** 32) * (DELAY_MAX_MS - DELAY_MIN_MS));
}

/** True when an entry may be sent now. */
export const isDue = (item: Pending, now = Date.now()) => item.notBefore === undefined || item.notBefore <= now;

const KEY = "pending";
export const QUEUE_EVENT = "nexora-queue";
const ZERO = `0x${"0".repeat(40)}` as const;
// Entries are read-only and anyone may extend them, exactly as the codec writes them.
const FLAGS = { readonly: true, permissionlessExtension: true } as const;

export function formParams(form: FormEntry): CreateEntityParameters {
  return form.kind === "shift" ? shiftCreate(form.input) : incidentCreate(form.input);
}

/** Keeps only what the codec built: the banded attributes and the (sealed) payload. */
export function toQueued(form: FormEntry): QueuedEntry {
  const params = formParams(form);
  const attributes: QueuedEntry["attributes"] = {};
  for (const [name, cell] of Object.entries(params.attributes as Record<string, { type: string; value: unknown }>)) attributes[name] = { type: cell.type, value: cell.value };
  return { kind: form.kind, attributes, payload: new TextDecoder().decode(params.payload), expiresInDays: form.input.expiresInDays };
}

const BUILD: Record<string, (value: never) => unknown> = { str, i32, bool, key: keyAttr };

/** Rebuilds the create parameters, and refuses anything readers would reject. */
export function paramsFor(entry: QueuedEntry): CreateEntityParameters {
  if (!(EXPIRY_CHOICES_DAYS as readonly number[]).includes(entry.expiresInDays)) throw new Error("bad lifetime");
  const attributes: Record<string, unknown> = {};
  for (const [name, cell] of Object.entries(entry.attributes)) {
    const build = BUILD[cell.type];
    if (!build) throw new Error(`bad attribute type: ${cell.type}`);
    attributes[name] = build(cell.value as never);
  }
  const payload = new TextEncoder().encode(entry.payload);
  const decoded = decodeEntry({
    key: `0x${"0".repeat(64)}` as Hex, creator: ZERO, owner: ZERO, expiresAt: 0n, creationFlags: FLAGS,
    contentType: "application/json", payload, attributes: entry.attributes,
  });
  if (!decoded.ok || decoded.value.kind !== entry.kind) throw new Error(decoded.ok ? "wrong kind" : decoded.reason);
  return { payload, contentType: "application/json", attributes: attributes as CreateEntityParameters["attributes"], expires: ExpirationTime.fromDays(entry.expiresInDays), flags: FLAGS };
}

/** Saved entries that still pass the contract. Anything unreadable or invalid is dropped, not sent. */
export function pendingEntries(): Pending[] {
  try {
    const parsed = JSON.parse(store.get(KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Pending => {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.savedAt !== "number") return false;
      if (typeof item.oneOff !== "boolean" || typeof item.lock !== "boolean" || !item.entry || typeof item.entry !== "object") return false;
      if (item.notBefore !== undefined && typeof item.notBefore !== "number") return false;
      if (item.month !== undefined && !(Number.isInteger(item.month) && /^\d{6}$/.test(String(item.month)))) return false;
      try {
        paramsFor(item.entry);
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function save(items: Pending[]): void {
  store.set(KEY, items.length ? JSON.stringify(items) : null);
  dispatchEvent(new Event(QUEUE_EVENT));
}

export function enqueue(form: FormEntry, options: { oneOff: boolean; lock: boolean; notBefore?: number; month?: number }): Pending {
  const entry = toQueued(form);
  paramsFor(entry);
  const { notBefore, month, ...rest } = options;
  const item: Pending = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, savedAt: Date.now(), entry, ...rest, ...(notBefore !== undefined && { notBefore }), ...(month !== undefined && { month }) };
  save([...pendingEntries(), item]);
  return item;
}

export function dequeue(id: string): void {
  save(pendingEntries().filter((item) => item.id !== id));
}

/** True when the browser reports no network at all. A slow or failing RPC is not "offline". */
export const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
