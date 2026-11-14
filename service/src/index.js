// SPDX-License-Identifier: MIT
// Schedule service: public read-only pages with the upcoming Shabbat & Yom Tov times of a
// Shabbat controller (src/main.js). Runs as a Cloudflare Worker with a D1 database.
//
//   POST   /api/register      {name}        -> 201 {id, key, url}   (from the settings page)
//   PUT    /api/s/<id>        schedule      -> 204                  (from the device)
//   PUT    /api/s/<id>/name   {name}        -> 204                  (from the settings page)
//   DELETE /api/s/<id>                      -> 204                  (from the settings page)
//   GET    /s/<id>            the public page (Hebrew / English, ?lang=he|en)
//   GET    /s/<id>.json       the same data as JSON
//
// Writes need "Authorization: Bearer <key>"; the key is returned once by /api/register and
// kept only on the device (the database stores its SHA-256). Nobody needs an account: the
// limits below keep the service from being used for anything but schedules.
//
// Schedule (sent by the device, see pubBody in src/main.js), times in UTC seconds:
//   {v: 1, now, auto: 0|1, w: [{t: "Shabbat", k: 1|2|3, s, e, x: 0|1, on: [[s, e], ...]}]}
//   t title from the window table, k 1 Shabbat / 2 Yom Tov / 3 both, s-e the window
//   (candle lighting to havdalah), x 1 = skipped once, on = relay ON intervals.
// v 2 (devices with repeating timers) adds to each window
//   rp: [[s, e, every, dur], ...]   a timer that turns on for dur minutes every `every`
//   minutes, from s (its first pulse) to e (the end of its last pulse); v 1 is still accepted.
import { renderPage, renderHome, renderMissing } from "./page.js";

export const LIMITS = {
  regPerIpDay: 20, // new pages per client address per day
  regPerDay: 3000, // new pages per day, everyone together
  putGap: 20, // seconds between writes to one page
  putPerDay: 200, // writes to one page per day
  body: 4096, // bytes
  nameLen: 60, // characters
  keepDays: 120, // pages not updated for this long are deleted
  unusedDays: 7 // pages never updated are deleted after this
};

const ID_CHARS = "abcdefghijkmnpqrstuvwxyz23456789"; // no l, o, 0, 1
const ID_RE = /^[a-km-np-z2-9]{10}$/;
const KEY_RE = /^[A-Za-z0-9_-]{24,64}$/;
const TITLE_RE = /^[A-Za-z][A-Za-z0-9 +]{0,47}$/;
const T_MIN = 1577836800; // 2020-01-01
const T_MAX = 4102444800; // 2100-01-01

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400"
};
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

function reply(status, body, type, extra) {
  const headers = Object.assign({}, SECURITY, extra || {});
  if (type) headers["Content-Type"] = type;
  return new Response(body, { status, headers });
}
function api(status, obj) {
  if (status === 204) return reply(204, null, null, CORS);
  return reply(status, JSON.stringify(obj), "application/json", CORS);
}
function fail(status, msg) {
  return api(status, { error: msg });
}

function randomString(n, chars) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let s = "";
  for (let i = 0; i < n; i++) s += chars[b[i] % chars.length];
  return s;
}
const KEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------- validation ----------
function isInt(v, lo, hi) {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}
export function cleanName(v) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  // no control characters or bidi overrides; collapse whitespace
  const s = v
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...s].length <= LIMITS.nameLen ? s : null;
}
// Returns the normalized schedule, or an error string.
export function validSchedule(d) {
  if (!d || typeof d !== "object" || (d.v !== 1 && d.v !== 2)) return "v";
  if (!isInt(d.now, T_MIN, T_MAX)) return "now";
  if (d.auto !== 0 && d.auto !== 1) return "auto";
  if (!Array.isArray(d.w) || d.w.length > 8) return "w";
  const w = [];
  for (const x of d.w) {
    if (!x || typeof x !== "object") return "w[]";
    if (typeof x.t !== "string" || !TITLE_RE.test(x.t)) return "t";
    if (x.k !== 1 && x.k !== 2 && x.k !== 3) return "k";
    if (!isInt(x.s, T_MIN, T_MAX) || !isInt(x.e, x.s + 1, x.s + 4 * 86400)) return "s/e";
    if (x.x !== 0 && x.x !== 1) return "x";
    // 12 timers on each of the 4 calendar days a three-day Yom Tov touches
    if (!Array.isArray(x.on) || x.on.length > 48) return "on";
    const on = [];
    for (const o of x.on) {
      if (!Array.isArray(o) || o.length !== 2) return "on[]";
      if (!isInt(o[0], x.s, x.e) || !isInt(o[1], o[0] + 1, x.e)) return "on[] range";
      on.push([o[0], o[1]]);
    }
    const y = { t: x.t, k: x.k, s: x.s, e: x.e, x: x.x, on };
    if (d.v === 2) {
      if (!Array.isArray(x.rp) || x.rp.length > 48) return "rp";
      y.rp = [];
      for (const o of x.rp) {
        if (!Array.isArray(o) || o.length !== 4) return "rp[]";
        if (!isInt(o[0], x.s, x.e) || !isInt(o[1], o[0] + 1, x.e)) return "rp[] range";
        if (!isInt(o[2], 5, 720) || !isInt(o[3], 1, o[2] - 1)) return "rp[] every";
        y.rp.push([o[0], o[1], o[2], o[3]]);
      }
    }
    w.push(y);
  }
  // the device's time zone (optional: devices from before locations send none, Israel)
  if (d.tz !== undefined) {
    if (typeof d.tz !== "string" || !/^[A-Za-z][A-Za-z0-9_+\-\/]{0,63}$/.test(d.tz)) return "tz";
    try {
      new Intl.DateTimeFormat("en", { timeZone: d.tz });
    } catch (e) {
      return "tz";
    }
    return { v: d.v, now: d.now, auto: d.auto, tz: d.tz, w };
  }
  return { v: d.v, now: d.now, auto: d.auto, w };
}

async function readJson(req) {
  const len = +(req.headers.get("Content-Length") || 0);
  if (len > LIMITS.body) return { err: "too large" };
  const text = await req.text();
  // bytes, not characters: a name in Hebrew is two bytes a letter
  if (new TextEncoder().encode(text).length > LIMITS.body) return { err: "too large" };
  try {
    return { v: JSON.parse(text) };
  } catch (e) {
    return { err: "bad json" };
  }
}

// ---------- handlers ----------
async function register(req, env, now) {
  const body = await readJson(req);
  if (body.err) return fail(400, body.err);
  const name = cleanName(body.v && body.v.name);
  if (name === null) return fail(400, "bad name");
  const day = Math.floor(now / 86400);
  const ip = (await sha256("reg:" + (req.headers.get("CF-Connecting-IP") || "-"))).slice(0, 16);
  // counted first, in one statement, so that requests arriving together cannot all pass a
  // check made before any of them is counted. Over the limit the count stops (no row comes
  // back), so one client cannot use up the limit of everyone together.
  const mine = await env.DB.prepare(
    "INSERT INTO regs (ip, day, n) VALUES (?, ?, 1) " +
      "ON CONFLICT (ip, day) DO UPDATE SET n = n + 1 WHERE n < ? RETURNING n"
  )
    .bind(ip, day, LIMITS.regPerIpDay)
    .first();
  if (!mine) return fail(429, "too many new pages today");
  const all = await env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM regs WHERE day = ?")
    .bind(day)
    .first();
  if (all && all.n > LIMITS.regPerDay) return fail(429, "service busy, try tomorrow");
  const id = randomString(10, ID_CHARS);
  const key = randomString(24, KEY_CHARS);
  await env.DB.prepare("INSERT INTO pages (id, key_hash, name, created) VALUES (?, ?, ?, ?)")
    .bind(id, await sha256(key), name, now)
    .run();
  return api(201, { id, key, url: new URL(req.url).origin + "/s/" + id });
}

// The page row if the request carries its key; otherwise a Response to return.
async function authorized(req, env, id) {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer (\S+)$/);
  if (!m || !KEY_RE.test(m[1])) return fail(401, "missing key");
  const row = await env.DB.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first();
  if (!row) return fail(404, "no such page");
  if ((await sha256(m[1])) !== row.key_hash) return fail(403, "wrong key");
  return row;
}

// Shared write limits; returns a Response when over a limit.
function overLimit(row, now) {
  const day = Math.floor(now / 86400);
  if (row.updated && now - row.updated < LIMITS.putGap) return fail(429, "too soon");
  if (row.put_day === day && row.put_n >= LIMITS.putPerDay) return fail(429, "too many today");
  return null;
}
function counted(row, now) {
  const day = Math.floor(now / 86400);
  return [day, row.put_day === day ? row.put_n + 1 : 1];
}

async function putSchedule(req, env, id, now) {
  const row = await authorized(req, env, id);
  if (row instanceof Response) return row;
  const over = overLimit(row, now);
  if (over) return over;
  const body = await readJson(req);
  if (body.err) return fail(400, body.err);
  const d = validSchedule(body.v);
  if (typeof d === "string") return fail(400, "bad schedule: " + d);
  const [day, n] = counted(row, now);
  await env.DB.prepare(
    "UPDATE pages SET data = ?, updated = ?, put_day = ?, put_n = ? WHERE id = ?"
  )
    .bind(JSON.stringify(d), now, day, n, id)
    .run();
  return api(204);
}

async function putName(req, env, id, now) {
  const row = await authorized(req, env, id);
  if (row instanceof Response) return row;
  if (row.put_day === Math.floor(now / 86400) && row.put_n >= LIMITS.putPerDay)
    return fail(429, "too many today");
  const body = await readJson(req);
  if (body.err) return fail(400, body.err);
  const name = cleanName(body.v && body.v.name);
  if (name === null) return fail(400, "bad name");
  const [day, n] = counted(row, now);
  await env.DB.prepare("UPDATE pages SET name = ?, put_day = ?, put_n = ? WHERE id = ?")
    .bind(name, day, n, id)
    .run();
  return api(204);
}

async function remove(req, env, id) {
  const row = await authorized(req, env, id);
  if (row instanceof Response) return row;
  await env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(id).run();
  return api(204);
}

function pickLang(req, url) {
  const q = url.searchParams.get("lang");
  if (q === "he" || q === "en") return q;
  return /^\s*(he|iw)\b/i.test(req.headers.get("Accept-Language") || "") ? "he" : "en";
}

async function getPage(req, env, url, id, kind, now) {
  const row = ID_RE.test(id)
    ? await env.DB.prepare("SELECT name, updated, data FROM pages WHERE id = ?").bind(id).first()
    : null;
  const lang = pickLang(req, url);
  if (kind === "json") {
    if (!row) return fail(404, "no such page");
    return reply(
      200,
      JSON.stringify({
        name: row.name,
        updated: row.updated,
        schedule: row.data ? JSON.parse(row.data) : null
      }),
      "application/json",
      Object.assign({ "Cache-Control": "public, max-age=60" }, CORS)
    );
  }
  if (!row)
    return reply(404, renderMissing(lang), "text/html; charset=utf-8", {
      "Cache-Control": "no-store"
    });
  const link = url.origin + "/s/" + id;
  const html = renderPage({
    lang,
    now,
    name: row.name,
    updated: row.updated,
    data: row.data ? JSON.parse(row.data) : null,
    link
  });
  return reply(200, html, "text/html; charset=utf-8", {
    "Cache-Control": "public, max-age=60",
    Vary: "Accept-Language",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"
  });
}

export async function route(req, env, now) {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;
  if (p.startsWith("/api/")) {
    if (m === "OPTIONS") return api(204);
    if (p === "/api/register" && m === "POST") return register(req, env, now);
    const s = p.match(/^\/api\/s\/([^/]+)(\/name)?$/);
    if (s && ID_RE.test(s[1])) {
      if (!s[2] && m === "PUT") return putSchedule(req, env, s[1], now);
      if (!s[2] && m === "DELETE") return remove(req, env, s[1]);
      if (s[2] && m === "PUT") return putName(req, env, s[1], now);
    }
    return fail(404, "not found");
  }
  if (m !== "GET" && m !== "HEAD") return reply(405, "method not allowed", "text/plain");
  if (p === "/")
    return reply(200, renderHome(pickLang(req, url)), "text/html; charset=utf-8", {
      "Cache-Control": "public, max-age=3600",
      Vary: "Accept-Language"
    });
  const g = p.match(/^\/s\/([a-z0-9]+)(\.json|\/)?$/);
  if (g) return getPage(req, env, url, g[1], g[2] === ".json" ? "json" : "html", now);
  return reply(404, renderMissing(pickLang(req, url)), "text/html; charset=utf-8");
}

// Daily: delete abandoned pages and old rate-limit counters.
export async function cleanup(env, now) {
  const day = Math.floor(now / 86400);
  await env.DB.prepare(
    "DELETE FROM pages WHERE (updated > 0 AND updated < ?) OR (updated = 0 AND created < ?)"
  )
    .bind(now - LIMITS.keepDays * 86400, now - LIMITS.unusedDays * 86400)
    .run();
  await env.DB.prepare("DELETE FROM regs WHERE day < ?")
    .bind(day - 1)
    .run();
}

export default {
  async fetch(req, env) {
    try {
      return await route(req, env, Math.floor(Date.now() / 1000));
    } catch (e) {
      console.log("error", e && e.stack);
      return fail(500, "internal error");
    }
  },
  async scheduled(event, env) {
    await cleanup(env, Math.floor(Date.now() / 1000));
  }
};
