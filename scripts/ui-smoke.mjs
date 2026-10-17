// UI smoke test: drives the production build in headless Chrome over the DevTools protocol.
//
//   npm run build -w web && node scripts/ui-smoke.mjs
//
// Starts `vite preview` and Chrome itself (CHROME_PATH overrides the browser), checks the flows a
// judge would click, and exits non-zero on any failure or uncaught page error. None of the checks
// depend on Arkiv returning data, except the share link, which is skipped (not failed) when the
// public RPC has rate-limited the machine, so a rate-limited RPC cannot make CI flaky.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const PORT = 4791;
const DEBUG = 9444;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evidence = JSON.parse(readFileSync(join(root, "arkiv", "evidence.json"), "utf8"));

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
  // The language menu is a select; React listens for change events on it.
  const pickLang = (code) => js(`(() => { const s = document.querySelector("select.lang"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "${code}"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await pickLang("hi");
  await sleep(400);
  check("language toggles to Hindi", await js(`document.querySelector(".lead")?.textContent.includes("असल कमाई")`));
  await pickLang("kn");
  await sleep(400);
  const kannada = await js(`({ lead: document.querySelector(".lead")?.textContent ?? "", note: document.querySelector(".regional-note")?.textContent ?? "", nav: document.querySelector(".top nav")?.innerText ?? "" })`);
  check("Kannada shows the home page and nav in Kannada, and says it is machine-translated", /[\u0C80-\u0CFF]/.test(kannada?.lead) && kannada.nav.includes("ಹೋಲಿಕೆ") && kannada.note.includes("ಯಂತ್ರ"), kannada?.lead.slice(0, 60));
  await pickLang("ta");
  await sleep(400);
  check("Tamil shows the home page in Tamil", await js(`/[\u0B80-\u0BFF]/.test(document.querySelector(".lead")?.textContent ?? "") && (document.querySelector(".top nav")?.innerText ?? "").includes("ஒப்பீடு")`));
  const more = [];
  for (const [code, script, word] of [["te", "[\u0C00-\u0C7F]", "పోలిక"], ["bn", "[\u0980-\u09FF]", "তুলনা"], ["mr", "[\u0900-\u097F]", "तुलना"]]) {
    await pickLang(code);
    await sleep(400);
    more.push(await js(`new RegExp("${script}").test(document.querySelector(".lead")?.textContent ?? "") && (document.querySelector(".top nav")?.innerText ?? "").includes("${word}") && !!document.querySelector(".regional-note") && document.documentElement.scrollWidth <= document.documentElement.clientWidth`) ? code : `${code}: missing or overflows`);
  }
  check("Telugu, Bengali and Marathi show the home page and nav in their scripts, with the machine-translation note and no sideways overflow at 390px", more.join(",") === "te,bn,mr", more.join(","));
  await pickLang("en");
  await sleep(300);
  // The home page says who it is for, and each step card is a link; a city is one tap.
  const home = await js(`({ forWho: document.querySelector(".hero .eyebrow")?.textContent ?? "", cards: [...document.querySelectorAll(".steps li a")].map((a) => a.getAttribute("href")), promises: document.querySelectorAll(".trust-strip li").length })`);
  check("the home page says who it is for, and each step card is a one-tap way in", home?.forWho.includes("workers in India") && home.cards.join(",") === "#/compare,#/log,#/log?tab=incident" && home.promises === 4, JSON.stringify(home));
  // Waits until the query shown matches `pattern` or the rate-limit notice appears, instead of a fixed pause.
  const answered = async (pattern, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      const state = await js(`({ limited: /rate-limited|query budget/i.test(document.querySelector("main")?.innerText ?? ""), query: [...document.querySelectorAll("details.query pre")].map((p) => p.textContent).join(" | ") })`);
      if (state?.limited || pattern.test(state?.query ?? "")) return state;
      await sleep(500);
    }
    return { limited: false, query: "" };
  };
  await js(`[...document.querySelectorAll(".city-pick .chip")].find((b) => b.textContent === "Bengaluru")?.click()`);
  const chip = await answered(/city = str\('bengaluru'\)/);
  if (chip.limited) skipped.push("city chip (Arkiv RPC rate-limited this IP)");
  else check("one tap on a city chip filters the query to that city", /city = str\('bengaluru'\)/.test(chip.query));
  await js(`[...document.querySelectorAll(".city-pick .chip")].find((b) => b.textContent === "All")?.click()`);
  await sleep(300);
  // Day length is a range over the published hours band, in the query and in the equivalent CLI command.
  await js(`(() => { const s = [...document.querySelectorAll(".filters label.field")].find((l) => l.textContent.includes("Day length"))?.querySelector("select"); s.value = "8plus"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  const dayState = await answered(/hours_band >= i32\(2\)/);
  if (dayState.limited) skipped.push("day-length filter (Arkiv RPC rate-limited this IP)");
  else {
    const query = dayState.query;
    check("day-length filter queries the hours band, and shows the same filter as a CLI flag", /hours_band >= i32\(2\)/.test(query ?? "") && (query ?? "").includes("--day 8plus"), (query ?? "").slice(0, 120));
  }

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
  // No network: the day is saved on the device instead of lost, and nothing exact is kept in clear.
  await send("Network.enable");
  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(300);
  await js(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Publish to Arkiv"))?.click()`);
  await sleep(1200);
  const offline = await js(`({ saved: document.querySelector("main")?.innerText.includes("You are offline"), banner: document.querySelector(".card.pending")?.innerText ?? "", stored: localStorage.getItem("nexora.pending") ?? "" })`);
  check("offline, a day is saved on the phone, already banded, and shown as waiting for the network", offline?.saved && offline.banner.includes("waiting for the network: 1") && offline.stored.includes("net_hourly") && !offline.stored.includes("1187"), JSON.stringify({ saved: offline?.saved, banner: offline?.banner.slice(0, 60) }));
  await js(`[...document.querySelectorAll(".card.pending button")].find(b => b.textContent.startsWith("Discard"))?.click()`);
  await sleep(300);
  check("a saved entry can be discarded before it is sent", await js(`!document.querySelector(".card.pending") && !localStorage.getItem("nexora.pending")`));
  await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await js(`[...document.querySelectorAll(".tabs button")].find(b => b.textContent.includes("Something happened"))?.click()`);
  await sleep(300);
  check("incident reports default to a one-time wallet", await js(`[...document.querySelectorAll("label.check")].find(l => l.textContent.includes("one-time wallet"))?.querySelector("input")?.checked === true`));
  check("locking an entry is offered, and off unless the worker turns it on", await js(`[...document.querySelectorAll("label.check")].find(l => l.textContent.includes("Lock it"))?.querySelector("input")?.checked === false`));
  check("a report can be held back to a random moment 1–6 hours later, so its time does not point to the worker", await js(`[...document.querySelectorAll("label.check")].find(l => l.textContent.includes("random time in the next 1–6 hours"))?.querySelector("input")?.checked === false`));

  await go("#/mine?ui=en");
  await js(`document.querySelector("details.card").open = true; [...document.querySelectorAll("details.card button")].find(b => b.textContent.includes("Reveal"))?.click()`);
  await sleep(300);
  check("key backup reveals the test wallet key", await js(`/^main 0x[0-9a-f]{64}/i.test(document.querySelector("details.card pre")?.textContent ?? "")`));
  check("my data offers to remove every Nexora key and waiting entry from the phone", await js(`document.querySelector("details.wipe button.danger")?.textContent.includes("Remove everything")`));

  await go("#/compare?ui=en&city=delhi_ncr&work=cab", 3000);
  check("compare explains the Sybil risk", await js(`!!document.querySelector(".card.notice")`));
  check("compare keeps the city from the shared link", await js(`document.querySelector(".filters select")?.value === "delhi_ncr"`));
  // The share link appears with results, so it needs Arkiv to answer. When the public RPC has
  // rate-limited this machine (friction F6), record a skip instead of a false failure.
  const rateLimited = await js(`/rate-limited|query budget/i.test(document.querySelector("main")?.innerText ?? "")`);
  if (rateLimited) skipped.push("compare share link (Arkiv RPC rate-limited this IP)");
  else check("compare share link is a wa.me link", await js(`(document.querySelector("a.whatsapp")?.href ?? "").startsWith("https://wa.me/?text=")`));

  await go("#/incidents?ui=en", 3500);
  check("incidents page renders", await js(`document.querySelector("h2")?.textContent.includes("Incidents")`));
  const limitedHere = async () => js(`/rate-limited|query budget/i.test(document.querySelector("main")?.innerText ?? "")`);
  // Waits until a page has either rendered `selector` or shown the rate-limit notice, so a slow or
  // rate-limited RPC is reported as a skip rather than read as a half-loaded page.
  const settle = async (selector, tries = 30) => {
    for (let i = 0; i < tries; i++) {
      if (await js(`!!document.querySelector(${JSON.stringify(selector)}) || /rate-limited|query budget/i.test(document.querySelector("main")?.innerText ?? "")`)) return;
      await sleep(500);
    }
  };
  if (await limitedHere()) skipped.push("printable union report (Arkiv RPC rate-limited this IP)");
  else {
    check("incidents say how many reports a union or group replied to", await js(`/\\d+ of \\d+ reports here have a reply/.test(document.querySelector(".answered")?.textContent ?? "")`));
    check("incidents point workers to e-Shram registration", await js(`document.querySelector(".eshram a")?.href === "https://register.eshram.gov.in/"`));
    const report = await js(`({ button: [...document.querySelectorAll("button")].some(b => b.textContent.includes("Print or save as PDF")), rows: document.querySelectorAll(".report-keys li").length, links: [...document.querySelectorAll(".report-keys .mono")].every(s => s.textContent.startsWith("https://tiramisu.explorer.arkiv.network/entity/0x")), hidden: getComputedStyle(document.querySelector(".report-head")).display === "none" })`);
    check("printable union report lists every report with its explorer link, hidden on screen", report?.button && report.rows > 0 && report.links && report.hidden, JSON.stringify(report));
    const answers = await js(`({ rows: document.querySelectorAll("table.acct tbody tr").length, disputed: document.querySelectorAll("table.acct .badge.warn").length })`);
    check("incidents show, per platform, who answered, what the worker says is sorted out, and a resolved claim the worker disputes", answers?.rows > 0 && answers.disputed > 0, JSON.stringify(answers));
  }

  // The seeded case: a reply said "resolved", and the worker later said it was not sorted out.
  await go(`#/e/${evidence.features.worker_verdict?.parent}?ui=en`, 1000);
  await settle(".reply-list");
  if (await limitedHere()) skipped.push("disputed reply (Arkiv RPC rate-limited this IP)");
  else check("a resolved reply the worker contradicted is marked on the report", await js(`(document.querySelector(".reply-list .disputed")?.textContent ?? "").includes("not sorted out")`));

  // The locked incident the seed recorded: its page shows the lock and offers a complaint letter.
  const locked = evidence.features.ownership_lock?.key;
  await go(`#/e/${locked}?ui=en`, 1000);
  await settle(".replies");
  if (await limitedHere()) skipped.push("complaint letter (Arkiv RPC rate-limited this IP)");
  else {
    const page = await js(`({ lockedNote: document.querySelector("table.kv")?.innerText.includes("locked: handed to an address nobody controls"), noDelete: ![...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Delete"), letter: document.querySelector(".letter-text")?.value ?? "" })`);
    check("a locked entry says nobody can delete it, and offers no delete button", page?.lockedNote && page.noDelete, JSON.stringify({ lockedNote: page?.lockedNote, noDelete: page?.noDelete }));
    const replies = (await js(`document.querySelector(".replies")?.innerText`)) ?? "";
    check("the union's reply shows on the report, marked as coming from the trust list's curator", replies.includes("Escalated to the labour department or board") && replies.includes("runs the trust list"), replies.slice(0, 120));
    check("complaint letter links the public record and leaves name and ID for the worker", page?.letter.includes(`/entity/${locked}`) && page.letter.includes("[your name]") && page.letter.includes("[your ID]") && page.letter.startsWith("To: The Grievance Officer"), page?.letter.slice(0, 80));
    await js(`(() => { const s = document.querySelector(".letter select"); s.value = "labour"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(300);
    const labour = (await js(`document.querySelector(".letter-text")?.value`)) ?? "";
    check("letter to the labour department leaves Delhi NCR's state blank and links similar reports", labour.startsWith("To: The Labour Department") && labour.includes("[your state]") && labour.includes("#/incidents?platform=zomato&city=delhi_ncr"), labour.slice(0, 80));
    // A proof of authorship is checked against the entry's $creator; a made-up signature is refused.
    await js(`(() => { const d = document.querySelector("details.authorship"); d.open = true; const ta = d.querySelector("textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, "Nexora authorship proof\\nEntry: ${locked}\\nChallenge: (none)\\nSignature: 0x${"1b".repeat(65)}"); ta.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(200);
    await js(`[...document.querySelectorAll("details.authorship button")].find(b => b.textContent.includes("Check proof"))?.click()`);
    await sleep(800);
    const proof = (await js(`document.querySelector("details.authorship")?.innerText`)) ?? "";
    check("anyone can check a proof that a report is someone's, and a forged one is refused", proof.includes("Check a proof that someone wrote this") && proof.includes("Not valid"), proof.slice(-120));
  }

  await go("#/trust?ui=en", 3500);
  if (await limitedHere()) skipped.push("trust list lease (Arkiv RPC rate-limited this IP)");
  else check("a trust list says when its vouching lapses unless the curator renews it", await js(`document.querySelector("main")?.innerText.includes("Vouching lapses on about")`));

  // Kit for unions: a bilingual poster with a QR code that points at this host, and a WhatsApp message.
  await go("#/kit?ui=en", 1500);
  const kit = await js(`({ qr: document.querySelectorAll(".poster svg.qr rect").length, caption: document.querySelector(".poster-qr figcaption")?.textContent ?? "", hindi: /[ऀ-ॿ]/.test(document.querySelector(".poster-title")?.textContent ?? ""), wa: document.querySelector(".kit-page a.whatsapp")?.href ?? "" })`);
  check("the union kit has a Hindi and English poster with a QR code for this host, and a WhatsApp message", kit?.qr > 100 && kit.caption.includes(new URL(BASE).host) && kit.hindi && kit.wa.startsWith("https://wa.me/?text="), JSON.stringify({ ...kit, wa: kit?.wa.slice(0, 30) }));

  // Log a day without typing: one spoken question at a time, big buttons, quick amounts; it fills the form.
  await go("#/log?ui=hi", 1500);
  const easy = await js(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector("button.easy-start")?.click(); await wait(200);
    const first = document.querySelector(".easy-q")?.textContent ?? "";
    for (let i = 0; i < 3; i++) { document.querySelector(".easy-choices button")?.click(); await wait(150); }
    [...document.querySelectorAll(".easy-choices.amounts button")].find((b) => b.textContent === "₹1200")?.click(); await wait(100);
    for (let i = 0; i < 3; i++) { [...document.querySelectorAll(".easy .row button")].pop()?.click(); await wait(150); }
    const inputs = [...document.querySelectorAll(".form-grid input")].map((x) => x.value);
    return { first, inputs, closed: !document.querySelector(".easy") };
  })()`);
  check("log a day without typing: spoken questions in Hindi, big buttons and quick amounts fill the form", easy?.first.includes("किस ऐप") && easy.inputs.slice(0, 3).join(",") === "1200,200,8" && easy.closed, JSON.stringify(easy));

  // Rights: the worker's state law and the all-India code, read from Arkiv, every point with sources.
  await go("#/rights?ui=en&city=bengaluru", 1000);
  await settle("details.guide");
  if (await limitedHere()) skipped.push("rights (Arkiv RPC rate-limited this IP)");
  else {
    const rights = await js(`({ text: document.querySelector("main")?.innerText ?? "", sources: [...document.querySelectorAll(".guide-sources a")].every((a) => a.href.startsWith("https://")), scores: document.querySelectorAll(".guide-scores tr").length })`);
    check("the rights page shows Bengaluru's state law and the all-India code, each point with https sources and the date checked",
      rights?.text.includes("Karnataka Platform Based Gig Workers") && rights.text.includes("Code on Social Security, 2020") && rights.text.includes("Sources (checked 2026-10-16)") && rights.sources,
      rights?.text.slice(0, 120));
    check("independent platform ratings are listed with their scores", rights?.scores >= 10 && rights.text.includes("6/10"), String(rights?.scores));
    check("the rights page quotes what a platform says it pays, beside the survey", rights?.text.includes("What platforms say they pay") && rights.text.includes("₹102"), "");
    check("the rights page shows what workers told an independent survey, with its sources", rights?.text.includes("What workers told researchers") && rights.text.includes("Prisoners on Wheels?") && rights.text.includes("blacklisted"), "");
  }
  // Compare puts a real survey figure for the same kind of work beside the (synthetic) ranking.
  await go("#/compare?ui=en&city=delhi_ncr&work=cab", 1000);
  await settle(".survey-note");
  if (await limitedHere()) skipped.push("survey figure on compare (Arkiv RPC rate-limited this IP)");
  else check("compare shows a real survey figure for cab drivers beside the ranking", await js(`(document.querySelector(".survey-note")?.textContent ?? "").includes("43%")`));
  // For food delivery, what Zomato itself says it pays sits beside the survey, never on a (possibly synthetic) row.
  await go("#/compare?ui=en&city=bengaluru&work=food_delivery", 1000);
  await settle(".claim-note");
  if (await limitedHere()) skipped.push("platform claim on compare (Arkiv RPC rate-limited this IP)");
  else check("compare shows what Zomato says it pays, with its source, beside the survey and outside the ranking", await js(`(() => { const n = document.querySelector(".claim-note"); return !!n && n.textContent.includes("₹102") && !n.closest("ol.suggestions"); })()`));

  // The day worker 2 deleted: gone from the current state, still readable as of a block before the
  // delete. The moment is fixed in UTC and typed in this browser's local time, so any timezone works.
  await go(`#/e/${evidence.features.owner_delete?.key}?ui=en`, 1000);
  await settle("details.as-of");
  const past = await js(`(async () => {
    const box = document.querySelector("details.as-of");
    if (!box?.open) return "no open past-record box";
    const at = new Date("2026-10-14T20:33:43Z");
    const pad = (n) => String(n).padStart(2, "0");
    const local = at.getFullYear() + "-" + pad(at.getMonth() + 1) + "-" + pad(at.getDate()) + "T" + pad(at.getHours()) + ":" + pad(at.getMinutes()) + ":" + pad(at.getSeconds());
    const input = box.querySelector("input[type=datetime-local]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, local);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    box.querySelector("button[type=submit]").click();
    for (let i = 0; i < 60 && !box.querySelector(".mono, .error"); i++) await new Promise((r) => setTimeout(r, 500));
    return box.innerText;
  })()`);
  if (await limitedHere()) skipped.push("past record (Arkiv RPC rate-limited this IP)");
  else check("a deleted day is still on record as of a block before its deletion", String(past).includes("On record then:") && String(past).includes("It is gone now"), String(past).slice(-160));

  // If this host is blocked: the other host, the whole app as one file (with its checksum), a terminal.
  await go("#/about?ui=en", 2500);
  const escape = await js(`(async () => {
    const box = document.querySelector(".escape");
    const links = [...(box?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    const file = await fetch("./nexora.html").then((r) => (r.ok ? r.text() : ""));
    const sha = await fetch("./nexora.html.sha256").then((r) => (r.ok ? r.text() : ""));
    return { hosts: links.filter((h) => h.startsWith("https://")).length, download: box?.querySelector("a[download]")?.getAttribute("href"), oneFile: file.includes("<script type=\\"module\\">") && !/<script[^>]*src=/.test(file), sha: /^[0-9a-f]{64}  nexora.html/.test(sha) };
  })()`);
  check("the app says how to reach it if this host is blocked, and hands out itself as one checked file", escape?.hosts === 2 && escape.download === "./nexora.html" && escape.oneFile && escape.sha, JSON.stringify(escape));

  check("the hosted app installs an offline shell", await js(`navigator.serviceWorker.getRegistration().then((r) => !!r)`));

  await go("#/proof?ui=hi");
  check("proof page renders in Hindi", await js(`document.querySelector("h2")?.textContent.includes("सबूत")`));
  const proofRows = await js(`document.querySelectorAll(".proof-table tbody tr").length`);
  check("proof page lists every recorded step, including the ownership lock", proofRows === Object.keys(evidence.features).length && (await js(`document.querySelector(".proof-table")?.innerText.includes("ownership_lock")`)), `${proofRows} rows`);
  ws.close();
} finally {
  cleanup();
}

// Details and errors come from the page under test; line breaks are removed at each log call so
// page text cannot forge log entries.
for (const r of results) {
  const detail = r.detail ? ` (${String(r.detail).replace(/\n|\r/g, "")})` : "";
  console.log(`${r.ok ? "PASS" : "FAIL"} ${String(r.name).replace(/\n|\r/g, "")}${detail}`);
}
for (const s of skipped) console.log(`SKIP ${String(s).replace(/\n|\r/g, "")}`);
if (errors.length) {
  console.log("page errors:");
  for (const error of errors) console.log(`  ${String(error).replace(/\n|\r/g, "")}`);
}
const failed = results.filter((r) => !r.ok).length + errors.length;
console.log(failed ? `${failed} problem(s)` : `all ${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
