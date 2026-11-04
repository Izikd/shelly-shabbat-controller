// Browser test of the settings UI against test/mockdevice.js (Playwright + Chromium).
// Usage: node test/ui_test.js <outdir>
"use strict";
let srvRef = null;
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const out = process.argv[2] || ".";
const PORT = 8099;
const NOW = 1793731800; // Tue 03/11/2026 20:50 Israel

(async () => {
  const srv = srvRef = spawn("node", [path.join(__dirname, "mockdevice.js"), String(PORT), String(NOW)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((r) => srv.stdout.once("data", r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: "Europe/London" });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  let fails = 0;
  const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };
  const api = (method, params) => page.evaluate(async ([m, p]) => (await fetch("/rpc/Script." + m, { method: "POST", body: JSON.stringify(Object.assign({ id: 1 }, p)) })).json(), [method, params || {}]);

  await page.goto(`http://localhost:${PORT}/script/1/ui`);
  await page.waitForSelector("text=הפעלה הבאה של הממסר");
  const statusTxt = await page.textContent("main");
  check(/שבת/.test(statusTxt) && /ו׳ 06\/11 16:30/.test(statusTxt), "status shows next Shabbat Fri 06/11 16:30: " + statusTxt.slice(0, 200));
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
  check(g.cfg.timers.length === 4 && g.cfg.timers[1][0] === 1 && g.cfg.timers[1][1] === 750 && g.cfg.timers[1][4] === 2, "saved to device: " + JSON.stringify(g.cfg.timers));
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
  check(st.st.test === 1794048300 && st.st.relay === true, "test time Sat 07/11 12:45 Israel -> relay ON (test=" + st.st.test + ")");
  await page.screenshot({ path: path.join(out, "7-status-test.png") });
  await page.click("text=נקה");
  await page.waitForSelector("text=ממסר: כבוי");

  // manual switch -> banner -> resume; log; diagnostics; Hebrew dates
  await page.evaluate(() => fetch("/rpc/Switch.Set?id=0&on=true"));
  await page.evaluate(() => fetch("/rpc/Script.ShabbatSet", { method: "POST", body: JSON.stringify({ id: 1 }) }));
  await page.click("role=tab[name='טיימרים']"); await page.click("role=tab[name='מצב']");
  await page.waitForSelector("text=הממסר הופעל/כובה ידנית", { timeout: 20000 });
  await page.screenshot({ path: path.join(out, "7b-manual.png") });
  await page.click("text=חזור לאוטומטי עכשיו");
  await page.waitForSelector("text=הממסר הופעל/כובה ידנית", { state: "detached" });
  const logTxt = await page.textContent("main");
  check(/יומן הממסר/.test(logTxt) && /ידני/.test(logTxt) && /אוטומטי/.test(logTxt), "log shows manual + automatic events");
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
  check(nHol > 20 && nHol < 60 && /ראש השנה/.test(holTxt) && /פסח/.test(holTxt), "holidays only: " + nHol);
  await page.screenshot({ path: path.join(out, "9-table-holidays.png") });
  await page.click("button[aria-label='הצג גם חלונות שעברו']");
  check(await page.locator(".tr").count() > nHol, "past windows shown");

  check(errors.length === 0, "page errors: " + errors.join(" | "));
  console.log(fails ? fails + " UI FAILURE(S)" : "UI TESTS PASSED");
  await browser.close();
  srv.kill();
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { try { srvRef && srvRef.kill(); } catch (x) {} });