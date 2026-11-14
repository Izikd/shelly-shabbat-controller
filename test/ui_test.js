// SPDX-License-Identifier: MIT
// Browser test of the settings UI against test/mockdevice.js (Playwright + Chromium).
// Usage: node test/ui_test.js <outdir>
"use strict";
let srvRef = null,
  srv2Ref = null,
  srv3Ref = null,
  browserRef = null;
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { restamp } = require("./stamp");
const out = process.argv[2] || ".";
const PORT = 8099;
const PORT2 = 8096; // a second mock device, for the update test (its service: 8097)
const LIB = "https://raw.githubusercontent.com/Izikd/shelly-shabbat-controller/";
const NOW = 1793731800; // Tue 03/11/2026 20:50 Israel
const PUB_URL = require("fs")
  .readFileSync(path.join(__dirname, "../src/ui.js"), "utf8")
  .match(/PUB_URL = "([^"]+)"/)[1];
const SVC = "http://localhost:" + (PORT + 1); // the mock device runs the service there

// resolves once the mock prints that it listens (the controller logs to stdout before that)
const listening = (proc) =>
  new Promise((ok) => {
    let buf = "";
    proc.stdout.on("data", (d) => {
      buf += d;
      if (buf.includes("mock Shelly on")) ok();
    });
  });

(async () => {
  const srv = (srvRef = spawn(
    "node",
    // stamped "dev": the update test expects a development build here, whatever the checkout
    [path.join(__dirname, "mockdevice.js"), String(PORT), String(NOW), "dev"],
    { stdio: ["ignore", "pipe", "inherit"] }
  ));
  await listening(srv);
  const browser = (browserRef = await chromium.launch());
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    timezoneId: "Europe/London",
    locale: "he-IL" // Hebrew browser -> Hebrew page on first visit
  });
  page.setDefaultTimeout(8000);
  // the real service address -> the local copy of the service
  const toSvc = (p) =>
    p.route(PUB_URL + "/**", async (route) => {
      const u = route.request().url().replace(PUB_URL, SVC);
      route.fulfill({ response: await route.fetch({ url: u }) });
    });
  await toSvc(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let refusing = false; // while the test makes the mock refuse requests on purpose
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (refusing && /^Failed to load resource/.test(m.text())) return;
    errors.push(m.text());
  });
  let fails = 0;
  const check = (c, m) => {
    if (!c) {
      fails++;
      console.log("FAIL:", m);
    }
  };
  const api = (method, params) =>
    page.evaluate(
      async ([m, p]) =>
        (
          await fetch("/rpc/Script." + m, {
            method: "POST",
            body: JSON.stringify(Object.assign({ id: 1 }, p))
          })
        ).json(),
      [method, params || {}]
    );

  const listCalls = [],
    previewCalls = [],
    setCalls = [];
  page.on("request", (r) => r.url().includes("Script.List") && listCalls.push(r.url()));
  page.on(
    "request",
    (r) => r.url().includes("ShabbatPreview") && previewCalls.push(JSON.parse(r.postData()))
  );
  page.on("request", (r) => /KVS\.|ShabbatPub/.test(r.url()) && setCalls.push(r.url()));
  await page.goto(`http://localhost:${PORT}/script/1/ui`);
  await page.waitForSelector("text=הפעלה הבאה של הממסר");
  await page.waitForTimeout(500);
  check(
    previewCalls.length === 0,
    "no preview request on load (Status tab): " + previewCalls.length
  );
  check(setCalls.length === 0, "no Settings requests on load (beta, publishing): " + setCalls);
  check(
    listCalls.length === 0,
    "loader used the page script id from the controller (no Script.List)"
  );
  // the device has only a few free connections (the mock: 3); the page stays within them
  const mock = (p) => fetch(`http://localhost:${PORT}/mock/` + p).then((r) => r.json());
  let ms = await mock("stats");
  check(
    ms.refused === 0 && ms.maxInFlight <= 2,
    "page load within 2 connections: " + JSON.stringify(ms)
  );
  // the old loader's burst of 7 requests is refused in part (the bug this guards against)
  refusing = true;
  const burst = await page.evaluate(() =>
    Promise.all(
      [0, 1, 2, 3, 4, 5, 6].map((i) =>
        fetch("/rpc/Script.GetCode?id=2&len=4096&offset=" + i * 4096).then(
          (r) => r.status,
          () => "failed"
        )
      )
    )
  );
  check(
    burst.some((x) => x !== 200),
    "mock refuses a 7-request burst: " + burst.join(",")
  );
  // refused requests (a dropped connection, a proxy's 502 page) are retried: the page loads
  await mock("refuse?n=3");
  await page.reload();
  await page.waitForSelector("text=הפעלה הבאה של הממסר");
  ms = await mock("stats");
  check(ms.refused >= 3 + 1, "refused requests during the reload: " + JSON.stringify(ms));
  refusing = false;
  const statusTxt = await page.textContent("main");
  check(
    /שבת/.test(statusTxt) && /ו׳ 06\/11 16:26/.test(statusTxt),
    "status shows next Shabbat Fri 06/11 16:26: " + statusTxt.slice(0, 200)
  );
  check(/ו׳ 06\/11 16:41/.test(statusTxt), "next ON Fri 16:41");
  check(!/Petah Tiqwa/.test(statusTxt), "a set location is on Settings, not Status");
  await page.screenshot({ path: path.join(out, "1-status.png") });

  await page.click("role=tab[name='טיימרים']");
  await page.waitForSelector("text=אחרי הדלקת נרות").catch((e) => {
    console.log("page errors:", errors);
    throw e;
  });
  await page.screenshot({ path: path.join(out, "2-timers.png") });

  // edit the clock timer: last day only, 12:30, +10 min
  await page.click("button.tname:has-text('בשעה 12:00')");
  await page.fill("input[type=time]", "12:30");
  await page.dispatchEvent("input[type=time]", "change");
  await page.click(".pill:has-text('יום אחרון')");
  await page.screenshot({ path: path.join(out, "3-edit.png") });
  check(await page.isVisible("text=יש שינויים שלא נשמרו"), "dirty bar shown");

  // add a Yom Tov-only timer
  await page.click("text=+ הוסף טיימר");
  await page.click(".t.edit .pill:has-text('יו״ט בלבד')");

  // the forecast below the timers follows the edits
  await page.waitForSelector(".slot");
  await page.waitForTimeout(600);
  const pv = await page.textContent("main");
  check(/12:30–/.test(pv), "preview reflects edited time 12:30");
  check(!/09:00–/.test(pv), "Yom Tov-only 09:00 timer absent on plain Shabbatot");

  // make the candle-lighting timer repeat: 30 min every 35 min, for 4 hours
  await page.click("button.tname:has-text('אחרי הדלקת נרות')");
  await page.click(".t.edit .pill:has-text('חוזר')");
  await page.waitForSelector("text=30 דק׳ כל 35 דק׳");
  const rsum = await page.textContent(".t.edit .tname");
  check(/כל 35 דק׳ למשך 4 שע׳/.test(rsum), "repeat in the timer's summary: " + rsum);
  await page.screenshot({ path: path.join(out, "4b-repeat.png"), fullPage: true });
  // the forecast is asked 3 windows at a time (6 at once ran the device out of memory)
  check(
    previewCalls.every((p) => p.n === 3) && previewCalls.some((p) => p.from > 0),
    "forecast in requests of 3: " + JSON.stringify(previewCalls.map((p) => [p.n, p.from]))
  );
  const pvCards = await page.$$eval(
    ".card.col",
    (c) => c.filter((x) => /\d\d:\d\d–/.test(x.textContent)).length
  );
  check(pvCards === 6, "forecast shows 6 windows: " + pvCards);
  await page.screenshot({ path: path.join(out, "4-preview.png"), fullPage: true });

  // save
  await page.click("text=שמור במכשיר");
  await page.waitForSelector("text=נשמר במכשיר");
  const g = await api("ShabbatGet");
  check(
    g.cfg.timers.length === 4 &&
      g.cfg.timers[1][0] === 1 &&
      g.cfg.timers[1][1] === 750 &&
      g.cfg.timers[1][4] === 2,
    "saved to device: " + JSON.stringify(g.cfg.timers)
  );
  check(g.cfg.timers[3][3] === 2, "new timer is Yom Tov only");
  check(
    g.cfg.timers[0][5] === 0 && JSON.stringify(g.cfg.reps) === "[[35,240,1],0,0,0]",
    "repeat saved, the timer itself disabled: " + JSON.stringify(g.cfg.reps)
  );
  // the save also sets up the watchdog: a firmware schedule that starts the controller hourly
  const jobsOf = (port) => fetch(`http://localhost:${port}/mock/jobs`).then((r) => r.json());
  let jobs;
  for (let i = 0; i < 20 && !(jobs && jobs.jobs.length); i++) {
    await page.waitForTimeout(100);
    jobs = await jobsOf(PORT);
  }
  check(
    jobs.jobs.length === 1 &&
      jobs.jobs[0].enable &&
      jobs.jobs[0].timespec === "0 17 * * * *" &&
      JSON.stringify(jobs.jobs[0].calls) === '[{"method":"Script.Start","params":{"id":1}}]',
    "watchdog schedule: " + JSON.stringify(jobs)
  );
  await page.screenshot({ path: path.join(out, "5-saved.png") });

  // status: skip + test time
  await page.click("role=tab[name='מצב']");
  await page.click("button[aria-label='דלג על החלון הקרוב']");
  await page.waitForSelector("text=(מדולג)");
  const sk = await api("ShabbatGet");
  check(sk.cfg.skip === 1793975160, "skip = start of Fri 06/11 window (" + sk.cfg.skip + ")");
  await page.screenshot({ path: path.join(out, "6-status-skip.png") });
  await page.click("button[aria-label='דלג על החלון הקרוב']");
  await page.waitForSelector("text=(מדולג)", { state: "detached" });
  await page.click("role=tab[name='הגדרות']");
  check(page.url().endsWith("#settings"), "the tab is kept in the address: " + page.url());
  const setTxt = await page.textContent("main");
  check(
    /Petah Tiqwa/.test(setTxt) && /Asia\/Jerusalem · זמנים עד/.test(setTxt),
    "location shown on Settings: " + setTxt.slice(0, 120)
  );
  await page.waitForTimeout(300);
  check(setCalls.length > 0, "Settings asks for the beta choice and publishing when opened");
  await page.fill("#tt", "2026-11-07T12:45");
  await page.dispatchEvent("#tt", "change");
  await page.waitForSelector("text=מצב בדיקה פעיל");
  await page.waitForSelector("text=ממסר: פועל");
  const st = await api("ShabbatGet");
  check(
    st.st.test === 1794048300 && st.st.relay === true,
    "test time Sat 07/11 12:45 Israel -> relay ON (test=" + st.st.test + ")"
  );
  await page.screenshot({ path: path.join(out, "7-status-test.png") });
  await page.click("role=tab[name='מצב']");
  check(await page.isVisible("text=מצב בדיקה פעיל"), "test time also shown on Status");
  await page.click("role=tab[name='הגדרות']");
  await page.click("text=נקה");
  await page.waitForSelector("text=ממסר: כבוי");
  await page.click("role=tab[name='מצב']");

  // manual switch -> banner -> resume; log; diagnostics; Hebrew dates
  await page.evaluate(() => fetch("/rpc/Switch.Set?id=0&on=true"));
  await page.evaluate(() =>
    fetch("/rpc/Script.ShabbatSet", { method: "POST", body: JSON.stringify({ id: 1 }) })
  );
  await page.click("role=tab[name='טיימרים']");
  await page.click("role=tab[name='מצב']");
  await page.waitForSelector("text=הממסר הופעל/כובה ידנית", { timeout: 20000 });
  await page.screenshot({ path: path.join(out, "7b-manual.png") });
  await page.click("text=חזור לאוטומטי עכשיו");
  await page.waitForSelector("text=הממסר הופעל/כובה ידנית", { state: "detached" });
  const logTxt = await page.textContent("main");
  check(
    /יומן הממסר/.test(logTxt) && /ידני/.test(logTxt) && /אוטומטי/.test(logTxt),
    "log shows manual + automatic events"
  );
  check(/ט״ז בחשוון/.test(logTxt) || /בחשוון/.test(logTxt), "Hebrew date on next window");
  await page.click("role=tab[name='הגדרות']");
  await page.click("text=מידע טכני");
  await page.waitForSelector("text=2.0.3");
  await page.screenshot({ path: path.join(out, "7c-log-diag.png"), fullPage: true });

  // public schedule page: create, the device sends, view, rename, stop
  await page.fill("#pn", "מעלית הרצל 5");
  await page.click("text=צור דף");
  await page.waitForSelector("text=הקישור לשיתוף");
  const link = await page.inputValue("#plink");
  check(new RegExp("^" + PUB_URL + "/s/[a-z2-9]{10}$").test(link), "page link: " + link);
  await page.waitForSelector("text=נשלח לאחרונה", { timeout: 10000 });
  await page.locator("#plink").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "7d-publish.png") });
  const pubSt = await api("ShabbatPub");
  check(
    (pubSt.on && pubSt.ok === NOW) || pubSt.ok > NOW - 60,
    "device sent the schedule: " + JSON.stringify(pubSt)
  );
  const pubPage = await browser.newPage({ locale: "he-IL", deviceScaleFactor: 2 });
  await toSvc(pubPage);
  await pubPage.goto(link);
  const pubTxt = await pubPage.textContent("body");
  check(
    /מעלית הרצל 5/.test(pubTxt) && /ו׳ 06\/11 16:26 ← ש׳ 07\/11 17:23/.test(pubTxt),
    "public page shows the next Shabbat: " + pubTxt.slice(0, 160)
  );
  // the candle-lighting timer repeats (v 2): one line, 16:41 to the end of its last pulse
  check(/12:30–13:30/.test(pubTxt) && /16:41–20:41/.test(pubTxt), "public page ON times");
  check(/30 דק׳ כל 35 דק׳/.test(pubTxt), "public page shows the repeat: " + pubTxt.slice(0, 400));
  await pubPage.screenshot({ path: path.join(out, "10-public.png"), fullPage: true });
  await pubPage.click("text=English");
  await pubPage.waitForSelector("text=Fri 06/11 16:26 → Sat 07/11 17:23");
  await pubPage.screenshot({ path: path.join(out, "10-public-en.png"), fullPage: true });
  await pubPage.close();
  await page.fill("#pn", "Herzl 5");
  await page.click("text=שמור שם");
  await page.waitForSelector("text=נשמר במכשיר");
  // straight to the local service (a 404 in the page would count as a page error)
  const svcGet = (p) =>
    fetch(p.replace(PUB_URL, SVC)).then((r) => (r.status === 200 ? r.json() : r.status));
  check((await svcGet(link + ".json")).name === "Herzl 5", "renamed on the service");
  page.once("dialog", (d) => d.accept());
  await page.click("text=הפסק פרסום");
  await page.waitForSelector("text=צור דף");
  check((await svcGet(link + ".json")) === 404, "page deleted on the service");
  check(!(await api("ShabbatPub")).on, "device stopped publishing");

  // full schedule tab
  await page.click("role=tab[name='לוח זמנים']");
  await page.waitForSelector(".tr");
  const nYear = await page.locator(".tr").count();
  check(nYear > 50 && nYear < 70, "the coming year listed: " + nYear);
  check(
    (await page.evaluate(() => window.scrollY)) === 0,
    "a tab opens at its top: " + (await page.evaluate(() => window.scrollY))
  );
  await page.click("text=הצג את כל השנים");
  const nAll = await page.locator(".tr").count();
  check(nAll === 232, "upcoming windows listed: " + nAll);
  const firstRow = await page.textContent(".tr >> nth=0");
  check(/ו׳ 06\/11 16:26/.test(firstRow), "first upcoming row is Fri 06/11: " + firstRow);
  await page.screenshot({ path: path.join(out, "8-table.png") });
  await page.click(".pill:has-text('חגים בלבד')");
  const nHol = await page.locator(".tr").count();
  const holTxt = await page.textContent("main");
  check(
    nHol > 20 && nHol < 60 && /ראש השנה/.test(holTxt) && /פסח/.test(holTxt),
    "holidays only: " + nHol
  );
  await page.screenshot({ path: path.join(out, "9-table-holidays.png") });
  await page.click("button[aria-label='הצג גם חלונות שעברו']");
  check((await page.locator(".tr").count()) > nHol, "past windows shown");

  check(
    (await page.getAttribute("html", "dir")) === "rtl" &&
      (await page.getAttribute("html", "lang")) === "he",
    "Hebrew page is rtl"
  );

  // English: an English browser gets English on first visit, the choice is remembered
  const en = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    timezoneId: "Europe/London",
    locale: "en-US"
  });
  en.setDefaultTimeout(8000);
  en.on("pageerror", (e) => errors.push("en: " + e.message));
  await en.goto(`http://localhost:${PORT}/script/1/ui`);
  await en.waitForSelector("text=Next relay ON");
  check(
    (await en.getAttribute("html", "dir")) === "ltr" &&
      (await en.getAttribute("html", "lang")) === "en" &&
      (await en.title()) === "Shabbat Clock",
    "English page is ltr with English title"
  );
  const enTxt = await en.textContent("main");
  check(
    /Fri 06\/11 16:26/.test(enTxt) && /Heshvan/.test(enTxt),
    "English dates: " + enTxt.slice(0, 160)
  );
  check(/ → /.test(enTxt), "arrow points right in English");
  await en.screenshot({ path: path.join(out, "en-1-status.png") });
  await en.click("role=tab[name='Timers']");
  await en.waitForSelector("text=After candle lighting");
  await en.waitForSelector(".slot");
  await en.click("role=tab[name='Schedule']");
  await en.waitForSelector(".tr");
  await en.click("role=tab[name='Settings']");
  await en.click("text=Technical info");
  await en.waitForSelector("text=Firmware");
  const diagTxt = (await en.textContent("main")).replace(/[\u2066\u2069]/g, ""); // bidi isolates
  check(
    /Version([0-9a-f]{7}(-dirty)?|v\d[\w.+-]* · [0-9a-f]{7}(-dirty)?)Built/.test(diagTxt) &&
      !/controller \S+ · page/.test(diagTxt),
    "version shown once (controller = page): " + (diagTxt.match(/Version.{0,40}/) || [""])[0]
  );
  check(
    /Built\d{4}-\d\d-\d\d \d\d:\d\dDevice/.test(diagTxt),
    "build time shown once: " + (diagTxt.match(/Built.{0,40}/) || [""])[0]
  );
  check(
    /94\.7 KB of 260 KB \(36%\)/.test(diagTxt) &&
      /92\.0 KB of 512 KB \(18%\)/.test(diagTxt) &&
      /15\.5 KB used \(65%\) · peak 21\.3 KB \(90%\) · free 8\.2 KB/.test(diagTxt),
    "memory percentages: " + (diagTxt.match(/Free device memory.{0,120}/) || [""])[0]
  );
  // no Hebrew anywhere except the language button (the Hebrew-calendar date is in English)
  const enAll = (await en.textContent("body")).replace("עברית", "");
  check(
    !/[\u0590-\u05FF]/.test(enAll),
    "no Hebrew on the English page: " + (enAll.match(/.{0,20}[\u0590-\u05FF]+.{0,20}/) || [""])[0]
  );
  await en.screenshot({ path: path.join(out, "en-2-status-diag.png"), fullPage: true });
  await en.click("button.lang");
  await en.waitForSelector("text=בדוק עדכונים");
  await en.reload();
  await en.waitForSelector("text=בדוק עדכונים"); // still on Settings (#settings)
  check((await en.getAttribute("html", "dir")) === "rtl", "switch to Hebrew is remembered");
  await en.click("button.lang");
  await en.waitForSelector("text=Check for updates");

  // the 15 s status poll: not from a hidden page (it catches up when shown), and a reply
  // that matches the last one (apart from the clock) leaves the page as it is
  const pl = await browser.newPage({ locale: "en-US", timezoneId: "Europe/London" });
  pl.setDefaultTimeout(8000);
  pl.on("pageerror", (e) => errors.push("poll: " + e.message));
  await pl.addInitScript(() => {
    const si = window.setInterval;
    window.setInterval = (f, ms) => (ms === 15000 ? ((window.__poll = f), 0) : si(f, ms));
    Object.defineProperty(document, "hidden", { get: () => !!window.__hidden });
  });
  let gets = 0;
  pl.on("request", (r) => r.url().includes("ShabbatGet") && gets++);
  const getDone = () => pl.waitForResponse((r) => r.url().includes("ShabbatGet"));
  await pl.goto(`http://localhost:${PORT}/script/1/ui`);
  await pl.waitForSelector("text=Next relay ON");
  await pl.waitForLoadState("networkidle"); // the start-up requests have re-rendered the page
  await pl.evaluate(() => (document.querySelector(".app").__mark = 1));
  let n0 = gets;
  let done = getDone();
  await pl.evaluate(() => window.__poll());
  await done;
  await pl.waitForTimeout(100);
  check(gets === n0 + 1, "visible page polls");
  check(
    await pl.evaluate(() => document.querySelector(".app").__mark === 1),
    "same status: page not rebuilt"
  );
  await pl.evaluate(() => {
    window.__hidden = true;
    window.__poll();
  });
  await pl.waitForTimeout(300);
  check(gets === n0 + 1, "hidden page does not poll");
  await api("ShabbatSet", { skip: true });
  done = getDone();
  await pl.evaluate(() => {
    window.__hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await done;
  await pl.waitForTimeout(100);
  check(gets === n0 + 2, "page polls when shown again");
  check(
    await pl.evaluate(() => document.querySelector(".app").__mark !== 1),
    "changed status: page rebuilt"
  );
  await api("ShabbatSet", { skip: false });
  await pl.close();

  // older browser: no DecompressionStream -> the page's own decoder (src/unpack.js)
  const old = await browser.newPage({ locale: "en-US", timezoneId: "Europe/London" });
  old.on("pageerror", (e) => errors.push("old: " + e.message));
  await old.addInitScript(() => {
    delete window.DecompressionStream;
  });
  await old.goto(`http://localhost:${PORT}/script/1/ui`);
  await old.waitForSelector("text=Next relay ON");
  check(
    await old.evaluate(() => typeof DecompressionStream === "undefined"),
    "fallback decoder path used"
  );
  await old.click("role=tab[name='Timers']");
  await old.waitForSelector("text=After candle lighting");

  // ---------- software update (Check for updates -> install) ----------
  // The `library` branch on raw.githubusercontent.com is served by the test; a second mock
  // device pretends to run release v0.1.0.
  const lib = {}; // "<branch>/<file>" -> code
  const dist = (n) => fs.readFileSync(path.join(__dirname, "..", "dist", n), "utf8");
  const setLib = (ctrl, ui, branch) => {
    lib[(branch || "library") + "/shabbat_controller.js"] = ctrl;
    lib[(branch || "library") + "/shabbat_ui.js"] = ui;
  };
  setLib(
    restamp(dist("shabbat_controller.js"), "v0.2.0"),
    restamp(dist("shabbat_ui.js"), "v0.2.0")
  );
  const ctx = await browser.newContext({ locale: "en-US", timezoneId: "Europe/London" });
  let ghRequests = 0;
  ctx.on("request", (r) => {
    if (/github/.test(r.url())) ghRequests++;
  });
  await ctx.route("https://raw.githubusercontent.com/**", (route) => {
    const url = route.request().url();
    const name = url.slice(LIB.length);
    if (!url.startsWith(LIB) || !lib[name]) return route.fulfill({ status: 404, body: "404" });
    route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      headers: { "access-control-allow-origin": "*" },
      body: lib[name]
    });
  });
  const up = await ctx.newPage();
  up.setDefaultTimeout(8000);
  up.on("pageerror", (e) => errors.push("upd: " + e.message));

  // a development build (the first mock): offered, but called a development build
  await up.goto(`http://localhost:${PORT}/script/1/ui`);
  await up.waitForSelector("text=Next relay ON");
  await up.click("role=tab[name='Settings']");
  check(ghRequests === 0, "no request to GitHub before the button is pressed: " + ghRequests);
  await up.click("text=Check for updates");
  await up.waitForSelector("text=Development build");
  check(await up.isVisible("text=Install v0.2.0"), "dev build: install button offered");
  await up.click("text=Technical info");
  await up.waitForSelector("text=Firmware");
  check((await up.locator(".dv a").count()) === 0, "development build version is not a link");

  const srv2 = (srv2Ref = spawn(
    "node",
    [path.join(__dirname, "mockdevice.js"), String(PORT2), String(NOW), "v0.1.0"],
    { stdio: ["ignore", "pipe", "inherit"] }
  ));
  await listening(srv2);
  const api2 = (method, params) =>
    up.evaluate(
      async ([m, p]) =>
        (await fetch("/rpc/" + m, { method: "POST", body: JSON.stringify(p || {}) })).json(),
      [method, params]
    );
  const ctrlFirst = async () =>
    (await api2("Script.GetCode", { id: 1, offset: 0, len: 120 })).data.split("\n")[0];
  await up.goto(`http://localhost:${PORT2}/script/1/ui#settings`);
  await up.waitForSelector("text=Check for updates");
  const before = await api2("Script.ShabbatSet", { id: 1, timers: [[1, 600, 45, 0, 0, 1]] });

  // the CDN can briefly hold files of two versions: refuse
  setLib(lib["library/shabbat_controller.js"], restamp(dist("shabbat_ui.js"), "v0.1.9"));
  await up.click("text=Check for updates");
  await up.waitForSelector("text=try again in a few minutes");
  check(!(await up.isVisible("text=Install v0.2.0")), "no install offered on mismatched files");

  // a controller that does not start: the old code is put back and started
  setLib(
    "// Shabbat controller - version v0.2.0 - commit 0000000 - built 2026-11-06T00:00Z\n}{\n",
    restamp(dist("shabbat_ui.js"), "v0.2.0")
  );
  await up.click("text=Check for updates");
  await up.waitForSelector("text=Version v0.2.0 is available");
  check(/installed: v0\.1\.0 · /.test(await up.textContent("main")), "installed version shown");
  await up.screenshot({ path: path.join(out, "upd-1-available.png"), fullPage: true });
  up.once("dialog", (d) => d.accept());
  await up.click("text=Install v0.2.0");
  await up.waitForSelector("text=previous version was restored", { timeout: 30000 });
  check(/version v0\.1\.0 /.test(await ctrlFirst()), "controller code restored to v0.1.0");
  check((await api2("Script.GetStatus", { id: 1 })).running, "restored controller running");

  // a good release: installed, verified, restarted, page reloaded
  setLib(
    restamp(dist("shabbat_controller.js"), "v0.2.0"),
    restamp(dist("shabbat_ui.js"), "v0.2.0")
  );
  await up.click("text=Check for updates");
  await up.waitForSelector("text=Version v0.2.0 is available");
  let confirmText = "";
  up.once("dialog", (d) => {
    confirmText = d.message();
    d.accept();
  });
  await up.click("text=Install v0.2.0");
  check(/restarts for a few seconds/.test(confirmText), "confirmation asked: " + confirmText);
  await up.waitForSelector("text=Update installed", { timeout: 30000 });
  await up.waitForEvent("load", { timeout: 15000 }); // the page reloads itself, on Settings
  await up.waitForSelector("text=Check for updates", { timeout: 15000 });
  check(/version v0\.2\.0 /.test(await ctrlFirst()), "controller is v0.2.0");
  check(
    (await api2("Script.GetCode", { id: 2, offset: 0, len: 120 })).data.indexOf(
      "// shabbat_ui - version v0.2.0 "
    ) === 0,
    "settings page is v0.2.0"
  );
  // the watchdog was off while the controller was replaced, and is on again
  const j2 = await (await fetch(`http://localhost:${PORT2}/mock/jobs`)).json();
  check(
    j2.jobs.length === 1 && j2.jobs[0].enable && /off,on$/.test((j2.log || []).join(",")),
    "watchdog off during the update, on after: " + JSON.stringify(j2)
  );
  const after = await api2("Script.ShabbatGet", { id: 1 });
  check(
    JSON.stringify(after.cfg.timers) === JSON.stringify(before.cfg.timers),
    "timers kept across the update"
  );
  // a release's version under Technical info links to its release page
  await up.click("text=Technical info");
  await up.waitForSelector("text=Firmware");
  const relHref = await up.getAttribute(".dv a.lnk", "href");
  check(
    relHref === "https://github.com/Izikd/shelly-shabbat-controller/releases/tag/v0.2.0",
    "version links to its release: " + relHref
  );
  await up.click("text=Check for updates");
  await up.waitForSelector("text=The latest version is installed (v0.2.0");
  await up.screenshot({ path: path.join(out, "upd-2-current.png"), fullPage: true });

  // beta channel: a pre-release on library-beta is offered only with the switch on; the
  // choice is kept on the device; with beta on, a newer stable release still wins
  setLib(
    restamp(dist("shabbat_controller.js"), "v0.3.0-beta.1"),
    restamp(dist("shabbat_ui.js"), "v0.3.0-beta.1"),
    "library-beta"
  );
  await up.click("text=Check for updates");
  await up.waitForSelector("text=The latest version is installed (v0.2.0");
  check(!(await up.isVisible("text=Install v0.3.0-beta.1")), "beta not offered with beta off");
  await up.click("button[aria-label='Beta versions']");
  await up.waitForSelector("button[aria-label='Beta versions'][aria-pressed='true']");
  await up.waitForTimeout(300);
  check(
    (await api2("KVS.Get", { key: "shabbat_upd_beta" })).value === "1",
    "beta choice saved on the device"
  );
  await up.reload();
  await up.waitForSelector("button[aria-label='Beta versions'][aria-pressed='true']");
  await up.click("text=Check for updates");
  await up.waitForSelector("text=Version v0.3.0-beta.1 is available");
  await up.screenshot({ path: path.join(out, "upd-3-beta.png"), fullPage: true });
  setLib(
    restamp(dist("shabbat_controller.js"), "v0.3.0"),
    restamp(dist("shabbat_ui.js"), "v0.3.0")
  );
  await up.click("text=Check for updates");
  await up.waitForSelector("text=Version v0.3.0 is available");

  // leaving beta: install the beta, switch beta off -> no downgrade offered as an update, the
  // card says a beta is installed; "Install stable" goes back explicitly, after a warning
  setLib(
    restamp(dist("shabbat_controller.js"), "v0.2.0"),
    restamp(dist("shabbat_ui.js"), "v0.2.0")
  );
  await up.click("text=Check for updates");
  await up.waitForSelector("text=Version v0.3.0-beta.1 is available");
  up.once("dialog", (d) => d.accept());
  await up.click("text=Install v0.3.0-beta.1");
  await up.waitForSelector("text=Update installed", { timeout: 30000 });
  await up.waitForEvent("load", { timeout: 15000 });
  await up.waitForSelector("button[aria-label='Beta versions'][aria-pressed='true']");
  await up.click("button[aria-label='Beta versions']"); // back to stable only
  await up.waitForSelector("button[aria-label='Beta versions'][aria-pressed='false']");
  await up.click("text=Check for updates");
  await up.waitForSelector("text=Beta v0.3.0-beta.1 · ");
  check(!(await up.isVisible("text=Install v0.2.0")), "leaving beta offers no automatic downgrade");
  await up.screenshot({ path: path.join(out, "upd-4-left-beta.png"), fullPage: true });
  let downgradeText = "";
  up.once("dialog", (d) => {
    downgradeText = d.message();
    d.accept();
  });
  await up.click("text=Install stable v0.2.0");
  check(
    /older than the installed version/.test(downgradeText),
    "downgrade warns: " + downgradeText
  );
  await up.waitForSelector("text=Update installed", { timeout: 30000 });
  await up.waitForEvent("load", { timeout: 15000 });
  await up.waitForSelector("text=Check for updates");
  check(/version v0\.2\.0 /.test(await ctrlFirst()), "back on stable v0.2.0");
  srv2.kill();

  // ---------- location: hebcal from the CDN, computed in the browser, written to the device ----------
  // A third mock device starts without shabbat_dates. The CDNs are served from node_modules
  // (the same npm files jsDelivr and unpkg serve); the integrity hashes in src/ui.js must
  // match them.
  const uiSrc = fs.readFileSync(path.join(__dirname, "../src/ui.js"), "utf8");
  const libs = [...uiSrc.matchAll(/\[\s*"(@hebcal\/[a-z]+)@([\d.]+)",\s*"(sha384-[^"]+)"\s*\]/g)];
  check(libs.length === 2, "two hebcal libraries pinned in src/ui.js");
  const npmFile = {};
  for (const [, name, ver, sri] of libs) {
    const dir = path.join(__dirname, "../node_modules", name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    check(pkg.version === ver, `${name}: page pins ${ver}, devDependency is ${pkg.version}`);
    const body = fs.readFileSync(path.join(dir, "dist/bundle.min.js"));
    const hash = "sha384-" + require("crypto").createHash("sha384").update(body).digest("base64");
    check(hash === sri, `${name}: integrity hash matches the npm file`);
    npmFile[`${name}@${ver}/dist/bundle.min.js`] = body;
  }
  const PORT3 = 8094;
  const srv3 = (srv3Ref = spawn(
    "node",
    [path.join(__dirname, "mockdevice.js"), String(PORT3), String(NOW), "dev"],
    {
      stdio: ["ignore", "pipe", "inherit"],
      // a new device: no location, no timers
      env: Object.assign({}, process.env, { MOCK_DATES: "none", MOCK_TIMERS: "none" })
    }
  ));
  await listening(srv3);
  const lctx = await browser.newContext({ locale: "en-US", timezoneId: "Europe/London" });
  const cdn = { jsdelivr: 0, unpkg: 0, mode: "ok" }; // mode: ok | nojsdelivr | tampered
  const serveCdn = (host, prefix) =>
    lctx.route(`https://${host}/**`, (route) => {
      cdn[host.split(".").slice(-2)[0]]++;
      const name = route.request().url().slice(prefix.length);
      if (cdn.mode === "nojsdelivr" && host === "cdn.jsdelivr.net") return route.abort();
      if (!npmFile[name]) return route.fulfill({ status: 404, body: "404" });
      let body = npmFile[name];
      if (cdn.mode === "tampered") body = Buffer.concat([body, Buffer.from(";")]);
      route.fulfill({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        headers: { "access-control-allow-origin": "*" },
        body
      });
    });
  await serveCdn("cdn.jsdelivr.net", "https://cdn.jsdelivr.net/npm/");
  await serveCdn("unpkg.com", "https://unpkg.com/");
  const lp = await lctx.newPage();
  lp.setDefaultTimeout(15000);
  lp.on("pageerror", (e) => errors.push("loc: " + e.message));
  const api3 = (m, p) =>
    lp.evaluate(
      async ([m, p]) =>
        (await fetch("/rpc/" + m, { method: "POST", body: JSON.stringify(p || {}) })).json(),
      [m, p]
    );
  await lp.goto(`http://localhost:${PORT3}/script/1/ui`);
  await lp.waitForSelector("text=No location set");
  let g3 = await api3("Script.ShabbatGet", { id: 1 });
  check(!g3.st.loc && g3.st.next === null && g3.st.relay === false, "no location: no windows");
  check(cdn.jsdelivr + cdn.unpkg === 0, "no CDN request before Set location");
  // a new device has no timers (there are no default ones); the list is empty, ready to add
  check(g3.cfg.timers.length === 0, "new device: no timers");
  await lp.click("role=tab[name='Timers']");
  await lp.waitForSelector("text=+ Add timer");
  check((await lp.locator("text=Maximum of 12").count()) === 0, "empty timer list, can add");
  await lp.click("role=tab[name='Status']");
  await lp.waitForSelector("text=No location set");
  await lp.screenshot({ path: path.join(out, "loc-1-none.png"), fullPage: true });
  // a file that does not match its integrity hash is refused, on both CDNs
  cdn.mode = "tampered";
  await lp.click("text=Set location");
  await lp.waitForSelector("text=Cannot load hebcal");
  check(
    cdn.jsdelivr === 1 && cdn.unpkg === 1,
    "tampered file refused, unpkg tried: " + JSON.stringify(cdn)
  );
  await lp.click("text=Cancel");
  // jsDelivr unreachable: unpkg
  cdn.mode = "nojsdelivr";
  await lp.click("text=Set location");
  await lp.waitForSelector("#lq");
  check(cdn.unpkg === 3, "loaded from unpkg after jsDelivr failed: " + JSON.stringify(cdn));
  await lp.fill("#lq", "jerusa");
  await lp.click(".pill:has-text('Jerusalem · Israel')");
  check((await lp.inputValue("#ltz")) === "Asia/Jerusalem", "city fills the time zone");
  await lp.screenshot({ path: path.join(out, "loc-2-edit.png"), fullPage: true });
  await lp.click("text=Save location");
  await lp.waitForSelector("text=Location saved");
  g3 = await api3("Script.ShabbatGet", { id: 1 });
  check(
    g3.st.loc === "Jerusalem" && g3.st.tz === "Asia/Jerusalem" && g3.did === 3,
    "Jerusalem saved"
  );
  // hebcal's Jerusalem custom: candles 40 minutes before sunset (Petah Tikva: 18)
  const ptNext = require("./windows.json").pt.w.find((w) => w[1] > NOW);
  const early = (ptNext[0] - g3.st.next.s) / 60;
  check(
    early >= 18 && early <= 26,
    "Jerusalem candle lighting ~22 min before Petah Tikva's: " + early
  );
  check(g3.st.end - NOW > 4.8 * 365 * 86400, "5 years of windows");
  const sd = await api3("Script.GetCode", { id: 3, offset: 0, len: 4096 });
  check(
    sd.left === 0 && /^\/\/ shabbat_dates v1 /.test(sd.data),
    "one 4 KB read: " + sd.data.length
  );
  check((await api3("Script.GetStatus", { id: 3 })).running === false, "shabbat_dates not running");
  await lp.screenshot({ path: path.join(out, "loc-3-saved.png"), fullPage: true });
  // abroad, by coordinates: New York
  await lp.waitForSelector("text=Location saved", { state: "detached" });
  check(!(await lp.isVisible("text=Change location")), "a set location is not on Status");
  await lp.click("role=tab[name='Settings']");
  await lp.click("text=Change location");
  await lp.waitForSelector("#lq");
  check((await lp.inputValue("#lla")) === "31.76904", "editor starts from the saved place");
  await lp.fill("#lla", "abc");
  await lp.click("text=Save location");
  await lp.waitForSelector("text=Invalid coordinates");
  await lp.fill("#lla", "40.71");
  await lp.fill("#llo", "-74.01");
  await lp.fill("#ltz", "America/New_York");
  await lp.click("button[aria-label='Israel (one-day Yom Tov)']");
  await lp.click("text=Save location");
  await lp.waitForSelector("text=Location saved");
  g3 = await api3("Script.ShabbatGet", { id: 1 });
  check(g3.st.loc === "40.71, -74.01" && g3.st.tz === "America/New_York", "coordinates saved");
  check(
    /America\/New_York · times until/.test(await lp.textContent("main")),
    "New York shown on Settings"
  );
  await lp.click("role=tab[name='Status']");
  const stTxt = await lp.textContent("main");
  // shown in New York time: Fri 06/11/2026 candle lighting is in the afternoon there
  check(/Fri 06\/11 16:\d\d/.test(stTxt), "next window in New York time: " + stTxt.slice(0, 200));
  await lp.click("role=tab[name='Schedule']");
  await lp.click(".pill:has-text('Holidays only')");
  const nyHol = await lp.textContent("main");
  check(/Pesach \+ Shabbat|Pesach ·/.test(nyHol) && /Simchat Torah/.test(nyHol), "abroad holidays");
  await lp.screenshot({ path: path.join(out, "loc-4-newyork.png"), fullPage: true });
  srv3.kill();

  check(errors.length === 0, "page errors: " + errors.join(" | "));
  console.log(fails ? fails + " UI FAILURE(S)" : "UI TESTS PASSED");
  await browser.close();
  srv.kill();
  process.exitCode = fails ? 1 : 0;
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      srvRef && srvRef.kill();
      srv2Ref && srv2Ref.kill();
      srv3Ref && srv3Ref.kill();
      browserRef && browserRef.close();
    } catch (x) {}
  });
