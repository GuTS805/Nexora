// Capture the README's current UI views from the production build.
// Build first with VITE_README_CAPTURE=1 so guide content comes from arkiv/guides.json
// and the kit QR targets the live app, even when the public RPC is unavailable.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const profile = mkdtempSync(join(tmpdir(), "nexora-readme-"));
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
if (!existsSync(chrome)) throw new Error("Chrome not found; set CHROME_PATH");
const port = 4792;
const debug = 9445;
const base = `http://localhost:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = [
  spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "preview", "--port", String(port), "--strictPort"], { cwd: join(root, "web"), stdio: "ignore" }),
  spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${debug}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" }),
];
async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try { const result = await fetch(url); if (result.ok) return result; } catch { /* starting */ }
    await sleep(500);
  }
  throw new Error(`Timed out: ${url}`);
}
try {
  await waitFor(base);
  await waitFor(`http://127.0.0.1:${debug}/json/version`);
  const target = await (await fetch(`http://127.0.0.1:${debug}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const next = ++id;
    pending.set(next, resolve);
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  const js = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
    return response.result.result?.value;
  };
  const go = async (hash) => {
    await send("Page.navigate", { url: `${base}/${hash}` });
    await sleep(3500);
  };
  const capture = async (name) => {
    const response = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(root, "docs", "assets", name), Buffer.from(response.result.data, "base64"));
    console.log(`Captured ${name}`);
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await go("#/compare?ui=en");
  if (!(await js(`document.querySelector('.survey-note')?.innerText.includes('Delivery workers: 34%')`))) throw new Error("Compare survey note missing");
  await capture("compare-survey.png");

  await go("#/?ui=en");
  if ((await js(`document.querySelector('select.lang')?.options.length`)) !== 7) throw new Error("Expected seven languages");
  // Expanded native select displays the real options in a form Chrome can screenshot.
  await js(`(() => { const menu = document.querySelector('select.lang'); menu.size = menu.options.length; Object.assign(menu.style, { position: 'absolute', right: '45px', top: '70px', zIndex: '10', minWidth: '150px', height: 'auto', background: '#fff' }); })()`);
  await capture("languages.png");
  await js(`(() => { const menu = document.querySelector('select.lang'); menu.removeAttribute('size'); menu.removeAttribute('style'); })()`);

  await go("#/rights?ui=en&city=bengaluru");
  if (!(await js(`document.querySelector('.guide')?.innerText.includes('Karnataka Platform Based Gig Workers')`))) throw new Error("Rights guide missing");
  await capture("rights.png");

  await go("#/kit?ui=en");
  if (!(await js(`document.querySelector('.poster-qr figcaption')?.innerText.includes('nexora-pi-snowy.vercel.app')`))) throw new Error("Kit QR does not target the live app");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await capture("kit.png");
  ws.close();
} finally {
  for (const child of children) child.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome exiting */ }
}
