// Browser test of the settings UI against test/mockdevice.js (Playwright + Chromium).
// Usage: node test/ui_test.js <outdir>
"use strict";
let srvRef = null,
  browserRef = null;
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const out = process.argv[2] || ".";
const PORT = 8099;
const NOW = 1793731800; // Tue 03/11/2026 20:50 Israel
const PUB_URL = require("fs")
  .readFileSync(path.join(__dirname, "../src/ui.js"), "utf8")
  .match(/PUB_URL = "([^"]+)"/)[1];
const SVC = "http://localhost:" + (PORT + 1); // the mock device runs the service there

(async () => {
  const srv = (srvRef = spawn(
    "node",
    [path.join(__dirname, "mockdevice.js"), String(PORT), String(NOW)],
    { stdio: ["ignore", "pipe", "inherit"] }
  ));
  await new Promise((r) => srv.stdout.once("data", r));
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
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
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

  const listCalls = [];
  page.on("request", (r) => r.url().includes("Script.List") && listCalls.push(r.url()));
  await page.goto(`http://localhost:${PORT}/script/1/ui`);
  await page.waitForSelector("text=הפעלה הבאה של הממסר");
  check(
    listCalls.length === 0,
    "loader used the page script id from the controller (no Script.List)"
  );
  const statusTxt = await page.textContent("main");
  check(
    /שבת/.test(statusTxt) && /ו׳ 06\/11 16:30/.test(statusTxt),
    "status shows next Shabbat Fri 06/11 16:30: " + statusTxt.slice(0, 200)
  );
  check(/ו׳ 06\/11 16:45/.test(statusTxt), "next ON Fri 16:45");
  await page.screenshot({ path: path.join(out, "1-status.png") });

  await page.click("role=tab[name='טיימרים']");
  await page.waitForSelector("text=אחרי הדלקת נרות");
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

  await page.click("role=tab[name='תחזית']");
  await page.waitForSelector(".slot");
  await page.waitForTimeout(600);
  const pv = await page.textContent("main");
  check(/12:30–/.test(pv), "preview reflects edited time 12:30");
  check(!/09:00–/.test(pv), "Yom Tov-only 09:00 timer absent on plain Shabbatot");
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
  await page.screenshot({ path: path.join(out, "5-saved.png") });

  // status: skip + test time
  await page.click("role=tab[name='מצב']");
  await page.click("button[aria-label='דלג על החלון הקרוב']");
  await page.waitForSelector("text=(מדולג)");
  const sk = await api("ShabbatGet");
  check(sk.cfg.skip === 1793975400, "skip = start of Fri 06/11 window (" + sk.cfg.skip + ")");
  await page.screenshot({ path: path.join(out, "6-status-skip.png") });
  await page.click("button[aria-label='דלג על החלון הקרוב']");
  await page.waitForSelector("text=(מדולג)", { state: "detached" });
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
  await page.click("text=נקה");
  await page.waitForSelector("text=ממסר: כבוי");

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
  await page.locator(".qr img").scrollIntoViewIfNeeded();
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
    /מעלית הרצל 5/.test(pubTxt) && /ו׳ 06\/11 16:30 ← ש׳ 07\/11 17:25/.test(pubTxt),
    "public page shows the next Shabbat: " + pubTxt.slice(0, 160)
  );
  check(/12:30–13:30/.test(pubTxt) && /16:45–17:15/.test(pubTxt), "public page ON times");
  await pubPage.screenshot({ path: path.join(out, "10-public.png"), fullPage: true });
  await pubPage.click("text=English");
  await pubPage.waitForSelector("text=Fri 06/11 16:30 → Sat 07/11 17:25");
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
  const nAll = await page.locator(".tr").count();
  check(nAll === 232, "upcoming windows listed: " + nAll);
  const firstRow = await page.textContent(".tr >> nth=0");
  check(/ו׳ 06\/11 16:30/.test(firstRow), "first upcoming row is Fri 06/11: " + firstRow);
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
    /Fri 06\/11 16:30/.test(enTxt) && /Heshvan/.test(enTxt),
    "English dates: " + enTxt.slice(0, 160)
  );
  check(/ → /.test(enTxt), "arrow points right in English");
  await en.screenshot({ path: path.join(out, "en-1-status.png") });
  await en.click("role=tab[name='Timers']");
  await en.waitForSelector("text=After candle lighting");
  await en.click("role=tab[name='Forecast']");
  await en.waitForSelector(".slot");
  await en.click("role=tab[name='Schedule']");
  await en.waitForSelector(".tr");
  await en.click("role=tab[name='Status']");
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
  await en.waitForSelector("text=הפעלה הבאה של הממסר");
  await en.reload();
  await en.waitForSelector("text=הפעלה הבאה של הממסר");
  check((await en.getAttribute("html", "dir")) === "rtl", "switch to Hebrew is remembered");
  await en.click("button.lang");
  await en.waitForSelector("text=Next relay ON");

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
      browserRef && browserRef.close();
    } catch (x) {}
  });
