// UI smoke test: drives the production build in headless Chrome over the DevTools protocol.
//
//   npm run build -w web && node scripts/ui-smoke.mjs
//
// Starts `vite preview` and Chrome itself (CHROME_PATH overrides the browser), checks the flows a
// judge would click, and exits non-zero on any failure or uncaught page error. None of the checks
// depend on Arkiv returning data, so a rate-limited public RPC cannot make CI flaky.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const PORT = 4791;
const DEBUG = 9444;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const chrome = chromeCandidates.find((path) => existsSync(path));
if (!chrome) throw new Error("Chrome not found; set CHROME_PATH");

const children = [];
const profile = mkdtempSync(join(tmpdir(), "nexora-ui-"));
function cleanup() {
  for (const child of children) child.kill();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Chrome may still hold files on Windows */
  }
}

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${url}`);
}

children.push(spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: join(root, "web"), stdio: "ignore" }));
children.push(spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" }));

const results = [];
const errors = [];
try {
  await waitFor(`${BASE}/`);
  await waitFor(`http://127.0.0.1:${DEBUG}/json/version`);
  const target = await (await fetch(`http://127.0.0.1:${DEBUG}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) pending.get(message.id)?.(message);
    else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((r) => {
    const n = ++id;
    pending.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const js = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.result?.value;
  const go = async (hash, wait = 2500) => {
    await send("Page.navigate", { url: `${BASE}/${hash}` });
    await sleep(wait);
  };
  const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  await go("#/?ui=en", 3000);
  check("explore renders", await js(`document.querySelector(".lead")?.textContent.includes("What actually worked")`));
  check("no horizontal overflow at 390px", await js(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
  await js(`document.querySelector("button.lang").click()`);
  await sleep(400);
  check("language toggles to Hindi", await js(`document.querySelector(".lead")?.textContent.includes("असल में")`));
  await js(`document.querySelector("button.lang").click()`);

  await go("#/log?ui=en");
  await js(`(() => { const s = document.querySelectorAll(".form-grid select")[1]; s.value = "whatsapp"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await sleep(300);
  const formats = await js(`[...document.querySelectorAll(".form-grid select")[2].options].map(o => o.value).join(",")`);
  check("platform change offers only its formats", formats === "status,broadcast", formats);
  await js(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; const inputs = document.querySelectorAll(".form-grid input"); set.call(inputs[0], "3500"); inputs[0].dispatchEvent(new Event("input", { bubbles: true })); set.call(inputs[1], "9100"); inputs[1].dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(300);
  const preview = (await js(`document.querySelector(".privacy")?.textContent`)) ?? "";
  check("privacy preview shows band and rounded ROI, not exact rupees in public column", preview.includes("₹2k–5k") && preview.includes("+160%"));
  await js(`[...document.querySelectorAll(".walletbar button")].find(b => b.textContent.includes("test wallet"))?.click()`);
  await sleep(500);
  check("test wallet connects", /^0x[0-9a-fA-F]{40}$/.test((await js(`document.querySelector(".walletbar .addr a")?.title`)) ?? ""));
  check("publish enabled for a valid form", await js(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Publish to Arkiv"))?.disabled === false`));

  await go("#/mine?ui=en");
  await js(`document.querySelector("details.card").open = true; [...document.querySelectorAll("details.card button")].find(b => b.textContent.includes("Reveal"))?.click()`);
  await sleep(300);
  check("key backup reveals the test wallet key", await js(`/^main 0x[0-9a-f]{64}/i.test(document.querySelector("details.card pre")?.textContent ?? "")`));

  await go("#/advisor?ui=en&category=coaching_tuition", 3000);
  check("advisor explains the Sybil risk", await js(`!!document.querySelector(".card.notice")`));
  check("advisor share link is a wa.me link", await js(`(document.querySelector("a.whatsapp")?.href ?? "").startsWith("https://wa.me/?text=")`));

  await go("#/proof?ui=hi");
  check("proof page renders in Hindi", await js(`document.querySelector("h2")?.textContent.includes("सबूत")`));
  ws.close();
} finally {
  cleanup();
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
const failed = results.filter((r) => !r.ok).length + errors.length;
console.log(failed ? `${failed} problem(s)` : `all ${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
