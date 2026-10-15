// UI smoke test: drives the production build in headless Chrome over the DevTools protocol.
//
//   npm run build -w web && node scripts/ui-smoke.mjs
//
// Starts `vite preview` and Chrome itself (CHROME_PATH overrides the browser), checks the flows a
// judge would click, and exits non-zero on any failure or uncaught page error. None of the checks
// depend on Arkiv returning data, except the share link, which is skipped (not failed) when the
// public RPC has rate-limited the machine, so a rate-limited RPC cannot make CI flaky.
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
const skipped = [];
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
    if (message.id) {
      // Only call back what this script registered: CDP ids are numbers we issued, never names.
      const resolve = typeof message.id === "number" ? pending.get(message.id) : undefined;
      if (typeof resolve === "function") resolve(message);
    }
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
  check("earnings page renders", await js(`document.querySelector(".lead")?.textContent.includes("What delivery and ride work really pays")`));
  check("no horizontal overflow at 390px", await js(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
  await js(`document.querySelector("button.lang").click()`);
  await sleep(400);
  check("language toggles to Hindi", await js(`document.querySelector(".lead")?.textContent.includes("असल कमाई")`));
  await js(`document.querySelector("button.lang").click()`);

  await go("#/log?ui=en");
  // Shift form selects, in order: platform, work, city, vehicle, month, incentive.
  await js(`(() => { const s = document.querySelectorAll(".form-grid select")[0]; s.value = "uber"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await sleep(300);
  const work = await js(`[...document.querySelectorAll(".form-grid select")[1].options].map(o => o.value).join(",")`);
  check("platform change offers only its kinds of work", work === "cab,bike_taxi,auto", work);
  await js(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; const inputs = document.querySelectorAll(".form-grid input"); [["1187", 0], ["243", 1], ["9.5", 2]].forEach(([v, i]) => { set.call(inputs[i], v); inputs[i].dispatchEvent(new Event("input", { bubbles: true })); }); })()`);
  await sleep(300);
  const publicColumn = (await js(`document.querySelector(".privacy .columns > div")?.textContent`)) ?? "";
  check("privacy preview shows bands and rounded rate, never the exact rupees or hours", publicColumn.includes("8–10 h") && publicColumn.includes("₹100/hour") && publicColumn.includes("20%") && !publicColumn.includes("1187") && !publicColumn.includes("9.5"), publicColumn.slice(0, 160));
  await js(`[...document.querySelectorAll(".walletbar button")].find(b => b.textContent.includes("test wallet"))?.click()`);
  await sleep(500);
  check("test wallet connects", /^0x[0-9a-fA-F]{40}$/.test((await js(`document.querySelector(".walletbar .addr a")?.title`)) ?? ""));
  check("publish enabled for a valid form", await js(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Publish to Arkiv"))?.disabled === false`));
  await js(`[...document.querySelectorAll(".tabs button")].find(b => b.textContent.includes("Something happened"))?.click()`);
  await sleep(300);
  check("incident reports default to a one-time wallet", await js(`[...document.querySelectorAll("label.check")].find(l => l.textContent.includes("one-time wallet"))?.querySelector("input")?.checked === true`));

  await go("#/mine?ui=en");
  await js(`document.querySelector("details.card").open = true; [...document.querySelectorAll("details.card button")].find(b => b.textContent.includes("Reveal"))?.click()`);
  await sleep(300);
  check("key backup reveals the test wallet key", await js(`/^main 0x[0-9a-f]{64}/i.test(document.querySelector("details.card pre")?.textContent ?? "")`));

  await go("#/compare?ui=en&city=delhi_ncr&work=cab", 3000);
  check("compare explains the Sybil risk", await js(`!!document.querySelector(".card.notice")`));
  check("compare keeps the city from the shared link", await js(`document.querySelector(".filters select")?.value === "delhi_ncr"`));
  // The share link appears with results, so it needs Arkiv to answer. When the public RPC has
  // rate-limited this machine (friction F6), record a skip instead of a false failure.
  const rateLimited = await js(`/rate-limited|query budget/i.test(document.querySelector("main")?.innerText ?? "")`);
  if (rateLimited) skipped.push("compare share link (Arkiv RPC rate-limited this IP)");
  else check("compare share link is a wa.me link", await js(`(document.querySelector("a.whatsapp")?.href ?? "").startsWith("https://wa.me/?text=")`));

  await go("#/incidents?ui=en");
  check("incidents page renders", await js(`document.querySelector("h2")?.textContent.includes("Incidents")`));

  await go("#/proof?ui=hi");
  check("proof page renders in Hindi", await js(`document.querySelector("h2")?.textContent.includes("सबूत")`));
  ws.close();
} finally {
  cleanup();
}

// Details and errors come from the page under test; line breaks are stripped at each log call so
// page text cannot forge log entries.
for (const r of results) {
  const detail = r.detail ? ` (${String(r.detail).replace(/\n|\r/g, " ")})` : "";
  console.log(`${r.ok ? "PASS" : "FAIL"} ${String(r.name).replace(/\n|\r/g, " ")}${detail}`);
}
for (const s of skipped) console.log(`SKIP ${String(s).replace(/\n|\r/g, " ")}`);
if (errors.length) {
  console.log("page errors:");
  for (const error of errors) console.log(`  ${String(error).replace(/\n|\r/g, " ")}`);
}
const failed = results.filter((r) => !r.ok).length + errors.length;
console.log(failed ? `${failed} problem(s)` : `all ${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
