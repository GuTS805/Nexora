/**
 * Optional gas sponsor, one of two small server helpers in Nexora (the other is api/read.ts). It sends a few test GLM to a visitor's
 * fresh wallet so they can publish without visiting a faucet first. It never writes entities, never
 * sees a passphrase, and stores nothing: if it is down, publishing still works with faucet GLM and
 * every read path is unaffected.
 *
 * Abuse limits are per instance and in memory (serverless instances are short-lived): one drip per
 * address per hour, three per IP per day, a global hourly cap, and a floor below which the sponsor
 * wallet stops paying. Free wallets make Sybil identities cheap; the per-IP cap raises that cost a
 * little, and the real defence is in the reader (trust lists, distinct-publisher counting).
 */
import { tiramisu } from "@arkiv-network/sdk/chains";
import { createPublicClient, createWalletClient, getAddress, http, isAddress, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DRIP = parseEther(process.env.SPONSOR_DRIP_GLM ?? "0.01");
const ALREADY_FUNDED = parseEther("0.001");
const SPONSOR_FLOOR = parseEther("0.05");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PER_IP_DAILY = 3;
const GLOBAL_HOURLY = 200;

const byAddress = new Map<string, number>();
const byIp = new Map<string, number[]>();
let global: number[] = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const key = process.env.NEXORA_SPONSOR_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return json(503, { error: "Gas sponsor is not configured." });

  let address: Address;
  try {
    const body = (await request.json()) as { address?: unknown };
    if (typeof body.address !== "string" || !isAddress(body.address)) throw new Error();
    address = getAddress(body.address);
  } catch {
    return json(400, { error: "Send { address } with a valid wallet address." });
  }

  const now = Date.now();
  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0]!.trim();
  global = global.filter((t) => now - t < HOUR);
  const ipHits = (byIp.get(ip) ?? []).filter((t) => now - t < DAY);
  if (now - (byAddress.get(address) ?? 0) < HOUR) return json(429, { error: "This wallet was funded less than an hour ago." });
  if (ipHits.length >= PER_IP_DAILY) return json(429, { error: "This network already received its free gas today." });
  if (global.length >= GLOBAL_HOURLY) return json(429, { error: "Hourly sponsor budget used up." });

  // ARKIV_RPC_URL may carry a Hub access key; it stays server-side, never in the browser bundle.
  const rpc = http(process.env.ARKIV_RPC_URL || tiramisu.rpcUrls.default.http[0], { retryCount: 1, timeout: 20_000 });
  const reader = createPublicClient({ chain: tiramisu, transport: rpc });
  const sponsor = privateKeyToAccount(key as `0x${string}`);
  const [balance, sponsorBalance] = await Promise.all([
    reader.getBalance({ address }),
    reader.getBalance({ address: sponsor.address }),
  ]);
  if (balance >= ALREADY_FUNDED) return json(200, { funded: false, reason: "Wallet already has gas." });
  if (sponsorBalance - DRIP < SPONSOR_FLOOR) return json(503, { error: "Sponsor wallet is low." });

  byAddress.set(address, now);
  byIp.set(ip, [...ipHits, now]);
  global.push(now);
  const wallet = createWalletClient({ chain: tiramisu, transport: rpc, account: sponsor });
  const txHash = await wallet.sendTransaction({ to: address, value: DRIP });
  return json(200, { funded: true, txHash });
}
