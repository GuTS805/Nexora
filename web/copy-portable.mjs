// Puts the one-file app next to the hosted one, so every host also hands out the whole app as a
// file anyone can keep and pass on: dist/nexora.html plus its SHA-256, to check a copy is unmodified.
// Run after `vite build` and `vite build --mode portable` (see "build" in package.json).
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const from = resolve(import.meta.dirname, "dist-portable", "nexora.html");
const to = resolve(import.meta.dirname, "dist", "nexora.html");
copyFileSync(from, to);
const sha = createHash("sha256").update(readFileSync(to)).digest("hex");
writeFileSync(`${to}.sha256`, `${sha}  nexora.html\n`);
console.log(`dist/nexora.html ${sha}`);
