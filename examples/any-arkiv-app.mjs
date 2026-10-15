// nexora-ledger's general Arkiv helpers, used on data that has nothing to do with Nexora.
//
//   npm i nexora-ledger
//   node any-arkiv-app.mjs [entityKey] [moment ...]
//
// With no arguments it reads an entity another team published for its own app (kharab-batch, a
// medicine-recall index, `app = "kharab"`) a minute before and a minute after it was created.
// Pass any Arkiv entity key and any dates or ISO times instead. Read-only: no wallet, no key.
// Set ARKIV_RPC_URL to use a keyed RPC.
import { blockAtDate, entityAtBlock, explainError, getEntityOrNull, isLocked, readClient } from "nexora-ledger";

const [key = "0x87b3ca310af2954ed6902b69a94877d06fd25912d7b98c4601929730dd83a85d", ...moments] = process.argv.slice(2);
const when = moments.length ? moments : ["2026-10-15T19:46:00Z", "2026-10-15T19:48:00Z"];

// A read client whose transport fails fast on the public RPC's 429 instead of hanging (friction F6).
const client = readClient();
try {
  for (const moment of when) {
    const date = new Date(moment);
    if (Number.isNaN(date.getTime())) throw new Error(`${moment} is not a date`);
    // The block at that moment, found from block timestamps: block times are not constant.
    const block = await blockAtDate(client, date);
    if (block === null) {
      console.log(`${date.toISOString()}: before the chain began`);
      continue;
    }
    const then = await entityAtBlock(client, key, block);
    if (!then) {
      console.log(`${date.toISOString()} (block ${block}): not on chain then`);
      continue;
    }
    const app = then.attributes?.app?.value ?? "(no app attribute)";
    console.log(`${date.toISOString()} (block ${block}): on record, app ${app}, created by ${then.creator}, owner ${then.owner}${isLocked(then.owner ?? "") ? " (locked: nobody can delete it)" : ""}`);
  }
  const now = await getEntityOrNull(client, key);
  if (!now) console.log("now: gone from the current state (deleted or expired); history above still reads it");
  else console.log(`now: still on chain, expires at block ${now.expiresAt}`);
} catch (error) {
  console.error(`error: ${explainError(error)}`);
  process.exitCode = 1;
}
