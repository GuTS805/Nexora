/**
 * Creates the project's Tiramisu **test** wallets and shows their balances.
 *
 *   npm run wallets           create missing keys in .env.local, print addresses + balances
 *   npm run wallets -- --fund move GLM from the sponsor wallet to any seed wallet below the threshold
 *
 * Private keys are written only to the gitignored `.env.local` and never printed.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createWalletClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { formatEther, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arkivHttp, readClient } from "../ledger/src/index.ts";
import { ENV_FILE, SEED_KEY_NAMES, SPONSOR_KEY_NAME, loadEnv, requireKey } from "./env.ts";

const SEED_TARGET = parseEther("0.05");

loadEnv();
const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const roles: [string, string][] = [
  [SPONSOR_KEY_NAME, "sponsor: gas sponsor for visitors' burner wallets + funds seed wallets"],
  ...SEED_KEY_NAMES.map((name, i) => [name, `seed publisher ${i + 1}: synthetic demo sellers`] as [string, string]),
];
for (const [name] of roles) {
  if (!process.env[name]) {
    const key = generatePrivateKey();
    appendFileSync(ENV_FILE, `${existing.endsWith("\n") || existing === "" ? "" : "\n"}${name}=${key}\n`);
    process.env[name] = key;
  }
}

const client = readClient();
const fund = process.argv.includes("--fund");
const sponsor = privateKeyToAccount(requireKey(SPONSOR_KEY_NAME));
const wallet = createWalletClient({ chain: tiramisu, transport: arkivHttp(), account: sponsor });

for (const [name, role] of roles) {
  const account = privateKeyToAccount(requireKey(name));
  let balance = await client.getBalance({ address: account.address });
  if (fund && name !== SPONSOR_KEY_NAME && balance < SEED_TARGET) {
    const hash = await wallet.sendTransaction({ to: account.address, value: SEED_TARGET - balance, chain: tiramisu, account: sponsor });
    await client.waitForTransactionReceipt({ hash });
    balance = await client.getBalance({ address: account.address });
  }
  console.log(`${account.address}  ${formatEther(balance).padStart(10)} GLM  ${role}`);
}
if (!fund) console.log("\nFund the sponsor wallet at https://hub.arkiv.network/faucet, then run: npm run wallets -- --fund");
