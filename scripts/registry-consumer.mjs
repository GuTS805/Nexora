// What a stranger gets from npm: installs nexora-ledger from the public registry into an empty
// folder, with no npm config, a fresh cache and no credentials, then uses it as an outside project
// would. Nothing from this repository is on the module path; only the example file is copied in.
//
//   node scripts/registry-consumer.mjs
//
// Tests the version in ledger/package.json if it is on npm, else the registry's `latest` (a version
// bump lands in git before it is published). The offline checks must pass. The one live read is
// skipped, not failed, when the public RPC has rate-limited this machine (friction F6).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const local = JSON.parse(readFileSync(join(root, "ledger", "package.json"), "utf8")).version;
const meta = await (await fetch("https://registry.npmjs.org/nexora-ledger")).json();
const target = meta.versions?.[local] ? local : meta["dist-tags"]?.latest;
if (!target) throw new Error("nexora-ledger is not on npm");
// The version comes from the network, so it is checked to be a plain version before it is used at all.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(target)) throw new Error(`unexpected version from npm: ${JSON.stringify(target)}`);
if (target !== local) console.log(`note: ${local} is not on npm yet; testing latest (${target})`);

const dir = mkdtempSync(join(tmpdir(), "nexora-registry-"));
// No shell anywhere: every command is a program and a list of arguments, so nothing in them is parsed.
// npm runs as Node plus its own CLI script, which works the same on Windows and Linux.
const npmCli = [process.env.npm_execpath, join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")]
  .find((path) => path && /npm-cli\.js$/.test(path) && existsSync(path));
if (!npmCli) throw new Error("npm-cli.js not found next to this Node");
const run = (args) => execFileSync(process.execPath, args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_PATH: "" } });
const npm = (...args) => run([npmCli, ...args]);
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
try {
  writeFileSync(join(dir, "package.json"), '{ "type": "module", "private": true }\n');
  writeFileSync(join(dir, ".npmrc-empty"), "");
  npm("install", "--no-audit", "--no-fund", "--ignore-scripts", "--userconfig", ".npmrc-empty", "--cache", join(dir, ".cache"), `nexora-ledger@${target}`);
  const installed = JSON.parse(readFileSync(join(dir, "node_modules", "nexora-ledger", "package.json"), "utf8")).version;
  check(`installs nexora-ledger@${target} from the public registry`, installed === target, installed);

  // Every entry point, used offline the way another team would: write, validate, seal, lock, find a block.
  writeFileSync(join(dir, "use.mjs"), `
    import * as lib from "nexora-ledger";
    import { JSON_SCHEMAS, auditEntities, validateEntity } from "nexora-ledger/contract";
    import shift from "nexora-ledger/schema/shift.schema.json" with { type: "json" };
    import incident from "nexora-ledger/schema/incident.schema.json" with { type: "json" };
    import reply from "nexora-ledger/schema/reply.schema.json" with { type: "json" };
    import trustList from "nexora-ledger/schema/trust-list.schema.json" with { type: "json" };
    const out = {};
    const fns = ["shiftCreate", "incidentCreate", "replyCreate", "trustListCreate", "decodeShift", "decodeIncident", "decodeReply", "decodeTrustList",
      "fetchShifts", "fetchIncidents", "fetchReplies", "fetchTrustLists", "comparePlatforms", "seal", "unseal", "readClient", "arkivHttp",
      "withReadFallback", "explainError", "isRateLimited", "createLocked", "isLocked", "trustRenewal", "blockAtDate", "entityAtBlock", "memberChanges"];
    out.missing = fns.filter((name) => typeof lib[name] !== "function");
    out.schemas = [shift, incident, reply, trustList].every((s) => typeof s.$id === "string") && Object.keys(JSON_SCHEMAS).length >= 4;
    const params = lib.shiftCreate({ platform: "swiggy", work: "food_delivery", city: "pune", vehicle: "ev_scooter", period: 202610, grossInr: 1180, costsInr: 240, hours: 9, incentive: "met", expiresInDays: 30 });
    out.valid = validateEntity("shift", params);
    out.noRupees = !JSON.stringify(params, (_, v) => (typeof v === "bigint" ? String(v) : v)).includes("1180");
    out.audit = typeof auditEntities([]).passed === "boolean";
    const box = await lib.seal({ grossInr: 1180, note: "x" }, "a long passphrase");
    out.seal = (await lib.unseal(box, "a long passphrase")).grossInr === 1180;
    const key = "0x" + "11".repeat(32);
    const locked = await lib.createLocked(
      { predictEntityKeys: async () => [{ key, salt: 7n }] },
      { executeBatch: async (b) => ({ txHash: "0x" + "22".repeat(32), createdEntities: [key], ownershipChanges: b.ownershipChanges.map((c) => c.entityKey), sent: b }) },
      "0x" + "33".repeat(20), params);
    out.lock = locked.entityKey === key;
    const ts = (n) => 1_700_000_000n + n * 2n;
    out.block = await lib.blockAtDate({ getBlock: async (a) => ({ number: a?.blockNumber ?? 1000n, timestamp: ts(a?.blockNumber ?? 1000n) }) }, new Date(Number(ts(400n)) * 1000));
    // Authorship proofs (0.5.0 and later): signed with one key, accepted only for that key.
    if (typeof lib.verifyAuthorship === "function") {
      const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
      const author = privateKeyToAccount(generatePrivateKey());
      const entry = "0x" + "ab".repeat(32);
      const signature = await author.signMessage({ message: lib.authorshipMessage(entry, "desk 1") });
      const proof = lib.parseProof(lib.formatProof({ entityKey: entry, challenge: "desk 1", signature }));
      out.proof = (await lib.verifyAuthorship(proof, { entityKey: entry, creator: author.address, challenge: "desk 1" }))
        && !(await lib.verifyAuthorship(proof, { entityKey: entry, creator: "0x" + "44".repeat(20) }));
    }
    // Conformance vectors (0.6.0 and later): shipped, and every verdict holds.
    try {
      const { default: data } = await import("nexora-ledger/vectors.json", { with: { type: "json" } });
      const { validateWire } = await import("nexora-ledger/contract");
      out.vectors = data.vectors.length >= 20 && data.vectors.every((v) => (validateWire(v.kind, v.entity).length === 0) === v.valid);
    } catch {
      out.vectors = null;
    }
    console.log(JSON.stringify(out, (_, v) => (typeof v === "bigint" ? String(v) : v)));
  `);
  const used = JSON.parse(run(["use.mjs"]).trim().split("\n").pop());
  check("every documented function is exported", used.missing.length === 0, used.missing.join(", "));
  check("the JSON Schemas import as JSON modules", used.schemas);
  check("a written entity passes the strict schema and carries no exact rupees", used.valid.length === 0 && used.noRupees, used.valid.join("; "));
  check("sealing round-trips, and the audit runs", used.seal && used.audit);
  check("createLocked names the predicted key in the same batch", used.lock);
  check("blockAtDate finds the block for a moment", used.block === "400", used.block);
  if (used.proof === undefined) console.log(`SKIP authorship proofs (not in ${target})`);
  else check("an authorship proof verifies for its signer only", used.proof);
  if (used.vectors === null) console.log(`SKIP conformance vectors (not in ${target})`);
  else check("the conformance vectors ship, and every verdict holds", used.vectors);

  const cli = npm("exec", "--no", "--", "nexora");
  check("the nexora CLI runs from the package", cli.includes("audit") && cli.includes("at <key>"), cli.trim());

  // One live read, on data another team published: the general helpers are not tied to Nexora.
  copyFileSync(join(root, "examples", "any-arkiv-app.mjs"), join(dir, "any-arkiv-app.mjs"));
  let live = "";
  try {
    live = run(["any-arkiv-app.mjs"]);
  } catch (error) {
    live = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  if (/query budget|429/.test(live)) console.log("SKIP live read of another app's entity (Arkiv RPC rate-limited this IP)");
  else check("reads another app's entity as of two moments (examples/any-arkiv-app.mjs)", live.includes("not on chain then") && live.includes("on record, app kharab"), live.trim().split("\n").join(" | "));
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may still hold files */
  }
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok || !r.detail ? "" : ` (${r.detail})`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} problem(s)` : `all ${results.length} checks passed`);
if (failed) process.exitCode = 1;
