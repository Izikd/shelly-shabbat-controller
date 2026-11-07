// SPDX-License-Identifier: MIT
// Tests of the schedule service (service/src) on Node, with an in-memory D1 (test/fake_d1.mjs).
// Usage: node test/service_test.mjs
import { route, cleanup, validSchedule, LIMITS } from "../service/src/index.js";
import { fakeD1 } from "./fake_d1.mjs";

let fails = 0;
function check(c, m) {
  if (!c) {
    fails++;
    console.log("FAIL:", m);
  }
}

const ORIGIN = "https://svc.test";
const env = { DB: fakeD1() };
let now = 1793731800; // Tue 03/11/2026 20:50 Israel
async function call(method, path, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if (opts.key) headers.Authorization = "Bearer " + opts.key;
  let body = opts.body;
  if (body !== undefined && typeof body !== "string") body = JSON.stringify(body);
  const r = await route(new Request(ORIGIN + path, { method, headers, body }), env, now);
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {}
  return { status: r.status, headers: r.headers, text, json };
}

// Fri 06/11 16:30 -> Sat 07/11 17:25 and the next Shabbat (real windows from the table)
const W1 = { t: "Shabbat", k: 1, s: 1793975400, e: 1794065100, x: 0 };
const sched = {
  v: 1,
  now,
  auto: 1,
  w: [
    Object.assign({}, W1, {
      on: [
        [1793976300, 1793978100], // Fri 16:45-17:15
        [1794045600, 1794049200] // Sat 12:00-13:00
      ]
    }),
    { t: "Shabbat", k: 1, s: 1794579900, e: 1794669600, x: 1, on: [] }
  ]
};

// ---------- register ----------
let r = await call("POST", "/api/register", {
  body: { name: "  מעלית  הרצל 5 " },
  headers: { "CF-Connecting-IP": "203.0.113.5" }
});
check(r.status === 201 && /^[a-km-np-z2-9]{10}$/.test(r.json.id), "register: " + r.text);
check(r.json.key.length === 24 && r.json.url === ORIGIN + "/s/" + r.json.id, "key and url");
check(r.headers.get("Access-Control-Allow-Origin") === "*", "CORS on API");
const { id, key } = r.json;
const row = await env.DB.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first();
check(row.name === "מעלית הרצל 5" && row.key_hash.length === 64 && !row.data, "row: name, hash");
check(!JSON.stringify(row).includes(key), "key itself not stored");
r = await call("OPTIONS", "/api/s/" + id);
check(
  r.status === 204 && /Authorization/.test(r.headers.get("Access-Control-Allow-Headers")),
  "preflight"
);
r = await call("POST", "/api/register", { body: { name: "x".repeat(61) } });
check(r.status === 400, "name too long rejected");
r = await call("POST", "/api/register", { body: "{" });
check(r.status === 400, "bad json rejected");

// page before the first upload
r = await call("GET", "/s/" + id, { headers: { "Accept-Language": "he-IL,he;q=0.9" } });
check(r.status === 200 && /עוד לא שלח/.test(r.text), "page before first upload");

// ---------- upload ----------
r = await call("PUT", "/api/s/" + id, { body: sched });
check(r.status === 401, "upload without key: " + r.status);
r = await call("PUT", "/api/s/" + id, { body: sched, key: "A".repeat(24) });
check(r.status === 403, "upload with wrong key: " + r.status);
r = await call("PUT", "/api/s/" + "abcdefghij", { body: sched, key });
check(r.status === 404, "upload to unknown page: " + r.status);
r = await call("PUT", "/api/s/" + id, { body: sched, key });
check(r.status === 204 && r.text === "", "upload: " + r.status + " " + r.text);
r = await call("PUT", "/api/s/" + id, { body: sched, key });
check(r.status === 429, "second upload within " + LIMITS.putGap + " s: " + r.status);

// validation
const bad = [
  null,
  { ...sched, v: 2 },
  { ...sched, auto: true },
  { ...sched, w: Array(9).fill(sched.w[1]) },
  { ...sched, w: [{ ...W1, t: "<script>", on: [] }] },
  { ...sched, w: [{ ...W1, k: 4, on: [] }] },
  { ...sched, w: [{ ...W1, e: W1.s + 5 * 86400, on: [] }] },
  { ...sched, w: [{ ...W1, on: [[W1.s - 60, W1.s + 60]] }] },
  { ...sched, w: [{ ...W1, on: [[W1.s + 60, W1.s + 60]] }] },
  { ...sched, w: [{ ...W1, on: [[W1.s, W1.e, "1"]] }] }
];
for (const b of bad)
  check(typeof validSchedule(b) === "string", "rejects " + JSON.stringify(b).slice(0, 70));
const extra = validSchedule({ ...sched, junk: "x".repeat(100), w: [{ ...sched.w[0], junk: 1 }] });
check(!JSON.stringify(extra).includes("junk"), "extra fields dropped");
now += 30;
r = await call("PUT", "/api/s/" + id, { body: "x".repeat(LIMITS.body + 1), key });
check(r.status === 400, "too large: " + r.status);
r = await call("PUT", "/api/s/" + id, { body: { ...sched, v: 2 }, key });
check(r.status === 400 && /bad schedule/.test(r.text), "invalid schedule rejected");

// ---------- public page ----------
r = await call("GET", "/s/" + id, { headers: { "Accept-Language": "he-IL,he;q=0.9" } });
const he = r.text;
check(r.status === 200 && /lang="he" dir="rtl"/.test(he), "Hebrew page");
check(
  /<title>מעלית הרצל 5<\/title>/.test(he) && /og:title" content="מעלית הרצל 5"/.test(he),
  "title"
);
check(/שבת · כ״ז בחשוון/.test(he), "Hebrew date: " + (he.match(/<b>[^<]*<\/b>/) || [""])[0]);
check(/ו׳ 06\/11 16:30 ← ש׳ 07\/11 17:25/.test(he), "window times");
check(/16:45–17:15/.test(he) && /12:00–13:00/.test(he) && /60 דק׳/.test(he), "ON slots");
check(/בוטל/.test(he), "skipped window shown");
check(/script-src|<script/.test(he) === false, "no script on the page");
check(/default-src 'none'/.test(r.headers.get("Content-Security-Policy")), "CSP");
r = await call("GET", "/s/" + id + "?lang=en", { headers: { "Accept-Language": "he" } });
const en = r.text;
check(
  /lang="en" dir="ltr"/.test(en) && /Fri 06\/11 16:30 → Sat 07\/11 17:25/.test(en),
  "English page"
);
check(/27 Heshvan/.test(en) && /Cancelled/.test(en), "English Hebrew date + skipped");
r = await call("GET", "/s/" + id, { headers: { "Accept-Language": "en-US" } });
check(/lang="en"/.test(r.text), "English browser -> English");

// during the window: current window marked, past slot hidden, slot on now
now = 1794046000; // Sat 07/11 12:06:40
r = await call("GET", "/s/" + id + "?lang=en");
check(/card cur/.test(r.text) && /on now/.test(r.text) && !/16:45–17:15/.test(r.text), "now");
// after the device stopped reporting
now = 1793731800 + 3 * 86400;
r = await call("GET", "/s/" + id + "?lang=en");
check(/has not reported since/.test(r.text), "stale warning");
now = 1793731800 + 60;

// automation off
r = await call("PUT", "/api/s/" + id, { body: { ...sched, auto: 0 }, key });
check(r.status === 204, "upload auto off");
r = await call("GET", "/s/" + id + "?lang=en");
check(/Automation is off/.test(r.text), "automation off warning");

// json, qr, missing, home
r = await call("GET", "/s/" + id + ".json");
check(r.status === 200 && r.json.name === "מעלית הרצל 5" && r.json.schedule.w.length === 2, "json");
r = await call("GET", "/s/" + id + "/qr.svg");
check(
  r.status === 200 && /^<svg/.test(r.text) && r.headers.get("Content-Type") === "image/svg+xml",
  "qr"
);
r = await call("GET", "/s/zzzzzzzzzz");
check(r.status === 404 && /not found|לא נמצא/.test(r.text), "missing page 404");
r = await call("GET", "/");
check(r.status === 200 && /Shabbat schedules/.test(r.text), "home");

// ---------- rename (escaped), delete ----------
now += 60;
r = await call("PUT", "/api/s/" + id + "/name", { body: { name: '<b>"x"</b>' }, key });
check(r.status === 204, "rename");
r = await call("GET", "/s/" + id + "?lang=en");
check(/&lt;b&gt;&quot;x&quot;&lt;\/b&gt;/.test(r.text) && !/<b>"x"/.test(r.text), "name escaped");
r = await call("DELETE", "/api/s/" + id, { key: "B".repeat(24) });
check(r.status === 403, "delete with wrong key");
r = await call("DELETE", "/api/s/" + id, { key });
check(r.status === 204, "delete");
r = await call("GET", "/s/" + id);
check(r.status === 404, "deleted page gone");

// ---------- registration limits ----------
let last;
for (let i = 0; i < LIMITS.regPerIpDay + 1; i++)
  last = await call("POST", "/api/register", {
    body: {},
    headers: { "CF-Connecting-IP": "198.51.100.7" }
  });
check(last.status === 429, "per-address registration limit: " + last.status);
r = await call("POST", "/api/register", {
  body: {},
  headers: { "CF-Connecting-IP": "198.51.100.8" }
});
check(r.status === 201, "other address still allowed");

// ---------- cleanup ----------
const a = (
  await call("POST", "/api/register", { body: {}, headers: { "CF-Connecting-IP": "192.0.2.1" } })
).json;
const b = (
  await call("POST", "/api/register", { body: {}, headers: { "CF-Connecting-IP": "192.0.2.1" } })
).json;
now += 60;
check(
  (await call("PUT", "/api/s/" + b.id, { body: sched, key: b.key })).status === 204,
  "upload b"
);
await cleanup(env, now + 8 * 86400); // a never uploaded -> gone; b recent -> kept
check((await call("GET", "/s/" + a.id)).status === 404, "unused page removed after a week");
check((await call("GET", "/s/" + b.id)).status === 200, "active page kept");
await cleanup(env, now + (LIMITS.keepDays + 1) * 86400);
check((await call("GET", "/s/" + b.id)).status === 404, "abandoned page removed");
const regs = await env.DB.prepare("SELECT COUNT(*) AS n FROM regs").first();
check(regs.n === 0, "old registration counters removed");

console.log(fails ? fails + " SERVICE FAILURE(S)" : "SERVICE TESTS PASSED");
process.exit(fails ? 1 : 0);
