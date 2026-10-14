/**
 * Fails if any secret value from .env.local appears in a file git tracks or is about to commit.
 * Entity keys and transaction hashes look exactly like private keys (32 bytes of hex), so a pattern
 * scan cannot tell them apart; comparing against the actual secrets can.
 *
 *   npm run check:secrets
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ENV_FILE } from "./env.ts";

const root = resolve(import.meta.dirname, "..");
if (!existsSync(ENV_FILE)) {
  console.log("no .env.local; nothing to compare");
  process.exit(0);
}
const secrets = readFileSync(ENV_FILE, "utf8")
  .split(/\r?\n/)
  .map((line) => /^([A-Z0-9_]+)=(.+)$/.exec(line.trim()))
  .filter((m): m is RegExpExecArray => Boolean(m && m[2] && m[2].length >= 16))
  .map((m) => ({ name: m[1]!, value: m[2]!.toLowerCase().replace(/^0x/, "") }));

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const hits: string[] = [];
for (const file of files) {
  let text: string;
  try {
    text = readFileSync(resolve(root, file), "utf8").toLowerCase();
  } catch {
    continue;
  }
  for (const secret of secrets) if (text.includes(secret.value)) hits.push(`${file}: contains ${secret.name}`);
}
if (hits.length) {
  console.error(`secret values found in tracked files:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`ok: ${secrets.length} secrets, ${files.length} files, no matches`);
