import { TIRAMISU_RPC } from "@nexora/ledger";
import { useState } from "react";
import { useArkiv } from "../arkiv.tsx";

export function About() {
  const { rpcUrl, setRpcUrl, reader } = useArkiv();
  const [draft, setDraft] = useState(rpcUrl);
  const [check, setCheck] = useState<string | null>(null);

  return (
    <section className="prose">
      <h2>How it works</h2>
      <p>
        A tea seller in Indore and a saree seller in Surat each spend a few thousand rupees testing ads on Instagram, WhatsApp or Meesho.
        What they learn stays locked in their own heads or in a platform dashboard that can change its numbers, its rules or its prices
        at any time. Nexora is a shared notebook of those experiments that no company owns.
      </p>
      <ol>
        <li><b>Log a result.</b> Category, platform, format, language, region tier, festival — all from fixed lists. Spend becomes a band and ROI is rounded to 10%; exact rupees are either discarded or encrypted in your browser.</li>
        <li><b>It is written to Arkiv</b> from <em>your</em> wallet (a throwaway test wallet is created for you), read-only, with an expiry you choose.</li>
        <li><b>Anyone can query it.</b> This site, the command-line tool, or any Arkiv client — with the exact query shown under every list.</li>
        <li><b>Ask what to try.</b> Suggestions only count combinations that at least two independent sellers confirmed, and every suggestion links to its evidence.</li>
        <li><b>Choose whom to trust.</b> Filter by trust lists curated by communities you know. Filtering uses Arkiv’s <code>$creator</code>, which nobody can fake.</li>
      </ol>

      <h3>What is on Arkiv, and what deliberately is not</h3>
      <ul>
        <li>On Arkiv: experiment attributes (queryable), creative choices (payload), optional encrypted exact figures, trust lists.</li>
        <li>Never on Arkiv: names, phone numbers, shop names, product names, images, ad copy, customer data, passphrases.</li>
        <li>No Nexora database exists. The only server code is an optional gas sponsor that sends a few test GLM to new wallets.</li>
      </ul>

      <h3>If this website disappears</h3>
      <p>The data does not. Clone the MIT-licensed repository and run <code>npx tsx ledger/cli.ts query --demo</code>, or build this site and open it from any static host, IPFS gateway or your laptop — it talks to Arkiv directly.</p>

      <h3 id="network">Network</h3>
      <p className="small">This browser reads from <code className="mono">{rpcUrl}</code>. If that endpoint is blocked or down, point it at any other Arkiv Tiramisu node.</p>
      <div className="row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="secondary" onClick={() => setRpcUrl(draft === TIRAMISU_RPC ? null : draft)}>Use this RPC</button>
        <button className="link" onClick={() => { setDraft(TIRAMISU_RPC); setRpcUrl(null); }}>reset</button>
        <button className="link" onClick={() => reader.getBlockNumber().then((b) => setCheck(`OK, block ${b}`), (e: Error) => setCheck(`Failed: ${e.message}`))}>test</button>
      </div>
      {check && <p className="small">{check}</p>}
    </section>
  );
}
