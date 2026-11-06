// Browser test of the settings UI against test/mockdevice.js (Playwright + Chromium).
// Usage: node test/ui_test.js <outdir>
"use strict";
let srvRef = null,
  srv2Ref = null;
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { restamp } = require("./stamp");
const out = process.argv[2] || ".";
const PORT = 8099;
const PORT2 = 8098; // a second mock device, for the update test
const LIB = "https://raw.githubusercontent.com/Izikd/shelly-shabbat-controller/";
const NOW = 1793731800; // Tue 03/11/2026 20:50 Israel

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
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    timezoneId: "Europe/London",
    locale: "he-IL" // Hebrew browser -> Hebrew page on first visit
  });
  page.setDefaultTimeout(8000);
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
  check(ghRequests === 0, "no request to GitHub before the button is pressed: " + ghRequests);
  await up.click("text=Check for updates");
  await up.waitForSelector("text=Development build");
  check(await up.isVisible("text=Install v0.2.0"), "dev build: install button offered");

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
  await up.goto(`http://localhost:${PORT2}/script/1/ui`);
  await up.waitForSelector("text=Next relay ON");
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
  await up.waitForSelector("text=Next relay ON", { timeout: 15000 }); // reloaded
  check(/version v0\.2\.0 /.test(await ctrlFirst()), "controller is v0.2.0");
  check(
    (await api2("Script.GetCode", { id: 2, offset: 0, len: 120 })).data.indexOf(
      "// shabbat_ui - version v0.2.0 "
    ) === 0,
    "settings page is v0.2.0"
  );
  const after = await api2("Script.ShabbatGet", { id: 1 });
  check(
    JSON.stringify(after.cfg.timers) === JSON.stringify(before.cfg.timers),
    "timers kept across the update"
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
  await up.click("button[aria-label='Beta versions']"); // back to stable only
  await up.waitForSelector("button[aria-label='Beta versions'][aria-pressed='false']");
  srv2.kill();

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
    } catch (x) {}
  });
