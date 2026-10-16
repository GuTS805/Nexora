// Writes THIRD_PARTY_NOTICES.md: every package that ships in the web app or with nexora-ledger,
// with its version and licence, read from node_modules. Run after changing dependencies:
//   node scripts/notices.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Resolves a dependency the way Node does: the nearest node_modules up from the requiring package. */
function locate(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

const found = new Map();
function walk(name, fromDir) {
  const path = locate(name, fromDir);
  if (!path) return;
  const pkg = read(path);
  const id = `${pkg.name}@${pkg.version}`;
  if (found.has(id)) return;
  let licence = typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? (pkg.licenses ?? []).map((l) => l.type).join(" OR ");
  // Some packages state the licence only in a LICENSE file.
  if (!licence) {
    const file = ["LICENSE", "LICENSE.md", "LICENSE.txt"].map((f) => join(dirname(path), f)).find(existsSync);
    const first = file ? readFileSync(file, "utf8").trim().split(/\r?\n/)[0] : "";
    licence = /^MIT License/i.test(first) ? "MIT (LICENSE file)" : first ? `see LICENSE file` : "UNKNOWN";
  }
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "";
  found.set(id, { name: pkg.name, version: pkg.version, licence: licence || "UNKNOWN", repo: repo.replace(/^git\+/, "").replace(/\.git$/, "") });
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) walk(dep, dirname(path));
}

for (const workspace of ["web", "ledger"]) {
  const pkg = read(join(root, workspace, "package.json"));
  for (const dep of Object.keys(pkg.dependencies ?? {})) if (dep !== "nexora-ledger") walk(dep, join(root, workspace));
}

const rows = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
const byLicence = rows.reduce((acc, r) => ({ ...acc, [r.licence]: (acc[r.licence] ?? 0) + 1 }), {});
const text = `# Third-party notices

Nexora is MIT licensed ([LICENSE](LICENSE)). The web app and the \`nexora-ledger\` npm package include or depend on the open-source packages below, each under its own licence. Generated from \`node_modules\` by [\`scripts/notices.mjs\`](scripts/notices.mjs); development-only tools (test runners, bundlers, type checkers) are not shipped and not listed.

Licences: ${Object.entries(byLicence).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} (${n})`).join(", ")}.

| Package | Version | Licence | Source |
| --- | --- | --- | --- |
${rows.map((r) => `| ${r.name} | ${r.version} | ${r.licence} | ${r.repo ? r.repo.replace(/^git:\/\//, "https://") : ""} |`).join("\n")}
`;
writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), text);
console.log(`THIRD_PARTY_NOTICES.md: ${rows.length} packages; ${Object.entries(byLicence).map(([l, n]) => `${l} ${n}`).join(", ")}`);
