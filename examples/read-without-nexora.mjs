// Read Nexora's public experiments using ONLY the official Arkiv SDK — none of Nexora's code.
// Everything needed is in arkiv/schema.md; this file is the proof that the data contract is enough.
//
//   node examples/read-without-nexora.mjs [category]        e.g. sarees_textiles
//
// Works from any project with `npm i @arkiv-network/sdk viem`. Set ARKIV_RPC_URL to use a keyed RPC.
import { createPublicClient } from "@arkiv-network/sdk";
import { i32, str } from "@arkiv-network/sdk/attr";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { and, eq, gte } from "@arkiv-network/sdk/query";
import { http } from "viem";

const category = process.argv[2] ?? "tea_coffee";
const client = createPublicClient({
  chain: tiramisu,
  // Fail fast instead of honouring a long Retry-After on the anonymous budget (see friction F9).
  transport: http(process.env.ARKIV_RPC_URL ?? tiramisu.rpcUrls.default.http[0], { retryCount: 0 }),
});

// schema.md: app/kind/v identify the contract; roi_pct >= 0 keeps profitable runs.
const predicate = and([
  eq("app", str("nexora")),
  eq("kind", str("experiment")),
  eq("v", i32(1)),
  eq("category", str(category)),
  gte("roi_pct", i32(0)),
]);

let page;
try {
  page = await client.select("*").where(predicate).limit(200).fetch();
} catch (error) {
  const limited = String(error?.details ?? error).includes("ANON_COST_LIMITED");
  console.error(limited ? "Arkiv's anonymous query budget is used up for this IP; retry later or set ARKIV_RPC_URL to a keyed RPC." : `query failed: ${error?.shortMessage ?? error}`);
  // exitCode, not process.exit(): exiting with sockets still closing trips a libuv assertion on Windows.
  process.exitCode = 1;
}
if (page) report(page);

function report(page) {
  console.log(`${predicate} → ${page.entities.length} entities at block ${page.blockNumber}\n`);

  // Group by platform/format and count DISTINCT creators — never trust one wallet's volume.
  const groups = new Map();
  for (const entity of page.entities) {
    const a = entity.attributes ?? {};
    const id = `${a.platform?.value}/${a.format?.value}`;
    const g = groups.get(id) ?? { rois: [], creators: new Set() };
    g.rois.push(a.roi_pct?.value);
    g.creators.add(entity.creator);
    groups.set(id, g);
  }
  const rows = [...groups].map(([id, g]) => {
    const sorted = g.rois.filter((n) => typeof n === "number").sort((x, y) => x - y);
    return { combo: id, runs: sorted.length, sellers: g.creators.size, medianRoi: sorted[Math.floor(sorted.length / 2)] };
  });
  console.table(rows.sort((x, y) => y.sellers - x.sellers || y.medianRoi - x.medianRoi));
}
