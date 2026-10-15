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
import { clientIp, createLimiter } from "./_limits.js";

const DEFAULT_DRIP = parseEther("0.01");
// A typo in the optional override ("10" for "0.010") must not hand out the sponsor's whole balance.
const MAX_DRIP = parseEther("0.05");
const DRIP = (() => {
  try {
    const value = parseEther(process.env.SPONSOR_DRIP_GLM ?? "0.01");
    return value > 0n && value <= MAX_DRIP ? value : DEFAULT_DRIP;
  } catch {
    return DEFAULT_DRIP;
  }
})();
const ALREADY_FUNDED = parseEther("0.001");
const SPONSOR_FLOOR = parseEther("0.05");

/**
 * Browsers send `Origin` on every POST. A request from another website is refused, so no other page
 * can quietly spend this sponsor through its visitors' browsers. Scripts that send no Origin still
 * reach the limits below; this is not a substitute for them.
 */
export function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).hostname === new URL(request.url).hostname;
  } catch {
    return false;
  }
}

const limiter = createLimiter();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const key = process.env.NEXORA_SPONSOR_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return json(503, { error: "Gas sponsor is not configured." });
  if (!sameSite(request)) return json(403, { error: "The gas sponsor only serves this site." });

  let address: Address;
  try {
    const body = (await request.json()) as { address?: unknown };
    if (typeof body.address !== "string" || !isAddress(body.address)) throw new Error();
    address = getAddress(body.address);
  } catch {
    return json(400, { error: "Send { address } with a valid wallet address." });
  }

  const now = Date.now();
  const ip = clientIp(request.headers);
  const refusal = limiter.admit(ip, address, now);
  if (refusal) return json(refusal.status, { error: refusal.error });

  try {
    return await drip(key, address, ip, now);
  } finally {
    limiter.release(address);
  }
}

async function drip(key: string, address: Address, ip: string, now: number): Promise<Response> {
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

  const wallet = createWalletClient({ chain: tiramisu, transport: rpc, account: sponsor });
  // Counted before sending so a burst of requests cannot slip past the limits while this one is in flight.
  limiter.commit(ip, address, now);
  // Vercel type-checks this file with its own settings, where the SDK's chain type asks for a `kzg`
  // field that a plain transfer never uses; the cast keeps the build output free of that noise.
  const txHash = await wallet.sendTransaction({ to: address, value: DRIP } as unknown as Parameters<typeof wallet.sendTransaction>[0]);
  return json(200, { funded: true, txHash });
}
