import type { PublicArkivClient } from "@arkiv-network/sdk";
import { fetchExperiments, fetchTrustList, fetchTrustLists, type ExperimentFilters } from "@nexora/ledger";
import type { Hex } from "viem";

/**
 * A 30-second in-memory cache for reads. The public RPC gives each visitor IP a small query budget
 * (friction F6); without this, switching between pages re-runs the same queries. Writes call
 * `clearReads()` so a visitor always sees their own new entity.
 */
const TTL = 30_000;
const entries = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>;
  const value = load();
  entries.set(key, { at: Date.now(), value });
  value.catch(() => entries.delete(key));
  return value;
}

export function clearReads(): void {
  entries.clear();
}

const id = (client: PublicArkivClient) => (client.transport as { url?: string }).url ?? "default";

export const readExperiments = (client: PublicArkivClient, filters: ExperimentFilters, maxItems = 200) =>
  cached(`exp|${id(client)}|${maxItems}|${JSON.stringify(filters)}`, () => fetchExperiments(client, filters, maxItems));

export const readTrustLists = (client: PublicArkivClient) => cached(`lists|${id(client)}`, () => fetchTrustLists(client));

export const readTrustList = (client: PublicArkivClient, key: Hex) => cached(`list|${id(client)}|${key}`, () => fetchTrustList(client, key));
