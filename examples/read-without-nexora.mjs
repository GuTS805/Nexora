// Read Nexora's public earnings data using ONLY the official Arkiv SDK — none of Nexora's code.
// Everything needed is in arkiv/schema.md; this file is the proof that the data contract is enough
// for a union, a researcher or a journalist to build their own report.
//
//   node examples/read-without-nexora.mjs [city]        e.g. delhi_ncr
//
// Works from any project with `npm i @arkiv-network/sdk viem`. Set ARKIV_RPC_URL to use a keyed RPC.
import { createPublicClient } from "@arkiv-network/sdk";
import { i32, str } from "@arkiv-network/sdk/attr";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { and, eq } from "@arkiv-network/sdk/query";
import { http } from "viem";

const city = process.argv[2] ?? "bengaluru";
const client = createPublicClient({
  chain: tiramisu,
  // Fail fast instead of honouring a long Retry-After on the anonymous budget (see friction F6).
  transport: http(process.env.ARKIV_RPC_URL ?? tiramisu.rpcUrls.default.http[0], { retryCount: 0 }),
});

// schema.md: app/kind/v identify the contract; city narrows to one labour market.
const predicate = and([
  eq("app", str("nexora")),
  eq("kind", str("shift")),
  eq("v", i32(1)),
  eq("city", str(city)),
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

  // Group by platform/work and count DISTINCT creators — never trust one wallet's volume.
  const groups = new Map();
  for (const entity of page.entities) {
    const a = entity.attributes ?? {};
    const id = `${a.platform?.value}/${a.work?.value}`;
    const g = groups.get(id) ?? { hourly: [], creators: new Set() };
    g.hourly.push(a.net_hourly?.value);
    g.creators.add(entity.creator);
    groups.set(id, g);
  }
  const rows = [...groups].map(([id, g]) => {
    const sorted = g.hourly.filter((n) => typeof n === "number").sort((x, y) => x - y);
    return { platform_work: id, days: sorted.length, workers: g.creators.size, medianTakeHomePerHour: sorted[Math.floor(sorted.length / 2)] };
  });
  console.table(rows.sort((x, y) => y.workers - x.workers || y.medianTakeHomePerHour - x.medianTakeHomePerHour));
}
