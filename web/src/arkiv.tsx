import { clearReads } from "./cache.ts";
import { createWalletClient, type WalletArkivClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { TIRAMISU_RPC, arkivHttp, readClient } from "@nexora/ledger";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { custom, formatEther, parseEther, type Address, type EIP1193Provider } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { store } from "./storage.ts";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export type WalletMode = "burner" | "injected";

type Connected = { address: Address; mode: WalletMode; client: WalletArkivClient };

type ArkivState = {
  rpcUrl: string;
  setRpcUrl: (url: string | null) => void;
  reader: ReturnType<typeof readClient>;
  wallet: Connected | null;
  connectBurner: () => Connected;
  connectInjected: () => Promise<Connected>;
  disconnect: () => void;
  /** Makes sure a wallet (the connected one by default) can pay for one more write; asks the sponsor if not. */
  ensureGas: (address?: Address) => Promise<string>;
  /**
   * One-time wallets: a fresh key per published result, so results cannot be linked by `$creator`.
   * Keys stay in this browser so the seller can still extend or delete those results later.
   */
  oneOffWallets: () => Connected[];
  createOneOff: () => Connected;
  /** The locally held wallet that owns `address`, if any (connected, burner or one-time). */
  walletFor: (address: Address) => Connected | null;
  /** Bumped after every write so pages re-query. */
  revision: number;
  bump: () => void;
};

const Context = createContext<ArkivState | null>(null);
const LOW_BALANCE = parseEther("0.001");

function burnerClient(): Connected {
  let key = store.get("burner") as `0x${string}` | null;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    key = generatePrivateKey();
    store.set("burner", key);
  }
  const account = privateKeyToAccount(key);
  return { address: account.address, mode: "burner", client: createWalletClient({ chain: tiramisu, transport: arkivHttp(store.get("rpc") ?? TIRAMISU_RPC), account }) };
}

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

function readOneOffKeys(): `0x${string}`[] {
  try {
    const parsed = JSON.parse(store.get("oneoff") ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is `0x${string}` => typeof k === "string" && KEY_RE.test(k)) : [];
  } catch {
    return [];
  }
}

function keyClient(key: `0x${string}`, mode: WalletMode): Connected {
  const account = privateKeyToAccount(key);
  return { address: account.address, mode, client: createWalletClient({ chain: tiramisu, transport: arkivHttp(store.get("rpc") ?? TIRAMISU_RPC), account }) };
}

/**
 * The deployment's cached read endpoint (api/read.ts), used only after the public RPC rate-limits
 * this visitor. None for the portable file or a custom RPC: those read Arkiv directly, always.
 */
function readFallbackUrl(): string | undefined {
  if (!/^https?:$/.test(location.protocol)) return undefined;
  return new URL("api/read", location.origin + location.pathname).toString();
}

export function ArkivProvider({ children }: { children: ReactNode }) {
  const [rpcUrl, setRpc] = useState(() => store.get("rpc") ?? TIRAMISU_RPC);
  const [wallet, setWallet] = useState<Connected | null>(() => (store.get("wallet") === "burner" && store.get("burner") ? burnerClient() : null));
  const [revision, setRevision] = useState(0);
  const reader = useMemo(() => readClient(rpcUrl, rpcUrl === TIRAMISU_RPC ? readFallbackUrl() : undefined), [rpcUrl]);

  const connectBurner = useCallback(() => {
    const connected = burnerClient();
    store.set("wallet", "burner");
    setWallet(connected);
    return connected;
  }, []);

  const connectInjected = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) throw new Error("No browser wallet found. Use the built-in test wallet instead.");
    const [address] = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
    if (!address) throw new Error("The wallet returned no account.");
    const chainHex = `0x${tiramisu.id.toString(16)}` as const;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    } catch {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: chainHex, chainName: "Arkiv Tiramisu", nativeCurrency: tiramisu.nativeCurrency, rpcUrls: [TIRAMISU_RPC], blockExplorerUrls: ["https://tiramisu.explorer.arkiv.network"] }],
      });
    }
    const connected: Connected = { address, mode: "injected", client: createWalletClient({ chain: tiramisu, transport: custom(provider), account: address }) };
    store.set("wallet", "injected");
    setWallet(connected);
    return connected;
  }, []);

  const ensureGas = useCallback(async (target?: Address) => {
    const address = target ?? wallet?.address;
    if (!address) throw new Error(store.get("lang") === "hi" ? "पहले वॉलेट कनेक्ट करें।" : "Connect a wallet first.");
    const balance = await reader.getBalance({ address });
    if (balance >= LOW_BALANCE) return formatEther(balance);
    const response = await fetch("api/sponsor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as { error?: string; txHash?: string }) : {};
    if (!response?.ok) {
      const hint = store.get("lang") === "hi"
        ? `${address} के लिए मुफ़्त टेस्ट GLM https://hub.arkiv.network/faucet से लें और फिर कोशिश करें।`
        : `Get free test GLM for ${address} at https://hub.arkiv.network/faucet and try again.`;
      throw new Error(`${body.error ?? "Gas sponsor unreachable."} ${hint}`);
    }
    if (body.txHash) await reader.waitForTransactionReceipt({ hash: body.txHash as `0x${string}` });
    return formatEther(await reader.getBalance({ address }));
  }, [reader, wallet]);

  const value: ArkivState = {
    rpcUrl,
    setRpcUrl: (url) => {
      store.set("rpc", url);
      setRpc(url ?? TIRAMISU_RPC);
      if (wallet?.mode === "burner") setWallet(burnerClient());
    },
    reader,
    wallet,
    connectBurner,
    connectInjected,
    disconnect: () => {
      store.set("wallet", null);
      setWallet(null);
    },
    ensureGas,
    oneOffWallets: () => readOneOffKeys().map((key) => keyClient(key, "burner")),
    createOneOff: () => {
      const key = generatePrivateKey();
      store.set("oneoff", JSON.stringify([...readOneOffKeys(), key]));
      return keyClient(key, "burner");
    },
    walletFor: (address) => {
      const target = address.toLowerCase();
      if (wallet?.address.toLowerCase() === target) return wallet;
      const burner = store.get("burner");
      if (burner && KEY_RE.test(burner) && privateKeyToAccount(burner as `0x${string}`).address.toLowerCase() === target) return keyClient(burner as `0x${string}`, "burner");
      const key = readOneOffKeys().find((k) => privateKeyToAccount(k).address.toLowerCase() === target);
      return key ? keyClient(key, "burner") : null;
    },
    revision,
    bump: () => {
      clearReads();
      setRevision((r) => r + 1);
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useArkiv(): ArkivState {
  const value = useContext(Context);
  if (!value) throw new Error("useArkiv outside provider");
  return value;
}
