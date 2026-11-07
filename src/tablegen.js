// SPDX-License-Identifier: MIT
// Shabbat & Yom Tov window table, computed in the browser with hebcal (@hebcal/core, loaded by
// the settings page from a CDN only when the user sets a location; never shipped with this
// project). tools/build.mjs puts this file inside the settings page; tools/gen_ref.mjs and the
// tests load it in Node. Plain functions, no hebcal import: the caller passes the hebcal
// namespace (the browser bundle's global `hebcal`, or `import * as hc from "@hebcal/core"`).
//
// The table is stored on the device as the code of a never-started script named
// "shabbat_dates" (KVS values are too small), one tagged comment line per field, ASCII only,
// so that starting it by mistake does nothing:
//   // shabbat_dates v1 - DO NOT START ...      header
//   //N Petah Tiqwa                             place name (ASCII)
//   //L {"n":..,"cc":..,"la":..,"lo":..,"tz":..,"il":1,"at":..,"hc":..}  for the page
//   //Z Asia/Jerusalem                          time zone of the times below
//   //T Shabbat|Pesach|...                      window titles
//   //S 7200,1924992000                         standard UTC offset (s), end of the DST data
//   //D 1743120000,1761433200,...               DST periods [start, end, ...] (UTC s)
//   //W AA6kAXaA...                             windows, 8 characters each (below)
// A window: start in minutes since SD_BASE (4 base-64 digits), length in minutes (3 digits),
// title index (1 digit). The controller (src/main.js) reads N, Z, T, S, D and W.
var SD_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-";
var SD_BASE = 1735689600; // 2025-01-01 UTC, TBL_BASE in src/main.js
var SD_HEAD = "// shabbat_dates v1";

function sdEnc(n, width) {
  if (n < 0 || n >= Math.pow(64, width)) throw new Error("table value out of range: " + n);
  var s = "";
  for (var i = 0; i < width; i++) {
    s = SD_ALPHA.charAt(n % 64) + s;
    n = Math.floor(n / 64);
  }
  return s;
}

// hebcal holiday name -> table title (the page translates these, see I18N.hol in src/ui.js)
function sdHoliday(desc) {
  if (/^Pesach VII/.test(desc)) return "Pesach VII"; // VII and VIII
  var m = /^(Pesach|Shavuot|Rosh Hashana|Yom Kippur|Sukkot)/.exec(desc);
  if (m) return m[1];
  if (/^(Shmini Atzeret|Simchat Torah)/.test(desc)) return "Simchat Torah";
  return desc;
}

// Windows from candle lighting to havdalah: [[start, end, title], ...] (UTC s), with hebcal's
// defaults for the place (candle-lighting minutes by city, havdalah at 8.5 degrees).
// loc: a hebcal Location (it says Israel or abroad); from/to: Date.
function sdWindows(hc, loc, from, to) {
  var ev = hc.HebrewCalendar.calendar({
    start: from,
    end: to,
    candlelighting: true,
    location: loc,
    il: loc.getIsrael()
  });
  var out = [],
    open = null;
  for (var i = 0; i < ev.length; i++) {
    var e = ev[i],
      d = e.getDesc(),
      t = e.eventTime ? Math.floor(e.eventTime.getTime() / 60000) * 60 : 0;
    if (d === "Candle lighting" && t) {
      // a second candle lighting (Yom Tov after Shabbat, second day) continues the window
      if (!open) open = { s: t, d0: e.getDate().abs(), hol: [] };
    } else if (d === "Havdalah" && t) {
      if (!open) continue; // the range started inside a window
      var shabbat = false;
      for (var a = open.d0 + 1; a <= e.getDate().abs(); a++) {
        if (new hc.HDate(a).getDay() === 6) shabbat = true;
      }
      var parts = open.hol.slice();
      if (shabbat || !parts.length) parts.push("Shabbat");
      out.push([open.s, t, parts.join(" + ")]);
      open = null;
    } else if (open && !e.eventTime && e.getFlags() & hc.flags.CHAG) {
      var h = sdHoliday(d);
      if (open.hol.indexOf(h) < 0) open.hol.push(h);
    }
  }
  return out;
}

// UTC offset (s) of time zone tz at UTC second t, from the browser's time zone data
function sdOffset(fmt, t) {
  var p = {};
  fmt.formatToParts(new Date(t * 1000)).forEach(function (x) {
    p[x.type] = x.value;
  });
  var l = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) / 1000;
  return l - t;
}

// Standard offset and DST periods of tz from `from` to `to` (UTC s): {std, dst: [s, e, ...]}.
// The controller supports zones whose summer time is standard + 1 hour (nearly all).
function sdZone(tz, from, to) {
  var fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric"
  });
  var STEP = 6 * 3600,
    offs = [],
    t,
    o;
  for (t = from; t <= to; t += STEP) {
    o = sdOffset(fmt, t);
    if (offs.indexOf(o) < 0) offs.push(o);
  }
  var std = Math.min.apply(null, offs);
  for (var i = 0; i < offs.length; i++) {
    if (offs[i] !== std && offs[i] !== std + 3600) throw new Error("unsupported time zone " + tz);
  }
  // the exact second the offset changes, between a (offset oa) and b
  function edge(a, b, oa) {
    while (b - a > 1) {
      var m = Math.floor((a + b) / 2);
      if (sdOffset(fmt, m) === oa) a = m;
      else b = m;
    }
    return b;
  }
  var dst = [],
    prev = sdOffset(fmt, from);
  if (prev !== std) dst.push(from);
  for (t = from + STEP; t <= to + STEP; t += STEP) {
    var tt = Math.min(t, to);
    o = sdOffset(fmt, tt);
    if (o !== prev) dst.push(edge(tt - STEP, tt, prev));
    prev = o;
    if (tt === to) break;
  }
  if (dst.length % 2) dst.push(to);
  return { std: std, dst: dst };
}

function sdAscii(s) {
  return String(s).replace(/[^\x20-\x7e]/g, "?");
}

// The shabbat_dates script code. place: {n: name, cc: country code, la, lo, tz, il: bool};
// hcVer: hebcal version (shown on the page); at: when computed (UTC s)
function sdBuild(hc, place, from, to, hcVer, at) {
  var loc = new hc.Location(place.la, place.lo, !!place.il, place.tz, place.n, place.cc);
  var w = sdWindows(hc, loc, from, to);
  if (!w.length) throw new Error("no windows");
  var zEnd = Math.floor(to.getTime() / 1000) + 40 * 86400;
  var z = sdZone(place.tz, Math.floor(from.getTime() / 1000) - 86400, zEnd);
  var titles = [],
    data = "";
  for (var i = 0; i < w.length; i++) {
    if (titles.indexOf(w[i][2]) < 0) titles.push(w[i][2]);
    data +=
      sdEnc((w[i][0] - SD_BASE) / 60, 4) +
      sdEnc((w[i][1] - w[i][0]) / 60, 3) +
      sdEnc(titles.indexOf(w[i][2]), 1);
  }
  var meta = {
    n: place.n,
    cc: place.cc || "",
    la: place.la,
    lo: place.lo,
    tz: place.tz,
    il: place.il ? 1 : 0,
    at: at,
    hc: hcVer
  };
  return (
    SD_HEAD +
    " - DO NOT START this script. Shabbat & Yom Tov times for shabbat_controller, " +
    "written by its settings page (hebcal)\n" +
    "//N " +
    sdAscii(place.n) +
    "\n//L " +
    sdAscii(JSON.stringify(meta)) +
    "\n//Z " +
    sdAscii(place.tz) +
    "\n//T " +
    titles.join("|") +
    "\n//S " +
    z.std +
    "," +
    zEnd +
    "\n//D " +
    z.dst.join(",") +
    "\n//W " +
    data +
    "\n"
  );
}

// shabbat_dates code -> {meta, tz, w: [{s, e, t, k}]} (k: 1 Shabbat, 2 Yom Tov, 3 both)
function sdParse(code) {
  if (code.indexOf(SD_HEAD) !== 0) throw new Error("not a shabbat_dates script");
  var f = {};
  code.split("\n").forEach(function (l) {
    if (l.charAt(0) === "/" && l.charAt(3) === " ") f[l.charAt(2)] = l.slice(4);
  });
  var titles = (f.T || "").split("|"),
    data = f.W || "",
    w = [];
  function dec(p, n) {
    var v = 0;
    for (var i = 0; i < n; i++) v = v * 64 + SD_ALPHA.indexOf(data.charAt(p + i));
    return v;
  }
  for (var p = 0; p + 8 <= data.length; p += 8) {
    var s = SD_BASE + dec(p, 4) * 60,
      t = titles[dec(p + 7, 1)];
    w.push({
      s: s,
      e: s + dec(p + 4, 3) * 60,
      t: t,
      k: t === "Shabbat" ? 1 : /Shabbat/.test(t) ? 3 : 2
    });
  }
  return { meta: f.L ? JSON.parse(f.L) : {}, tz: f.Z, w: w };
}

if (typeof module === "object" && module.exports)
  module.exports = { sdBuild: sdBuild, sdParse: sdParse, sdWindows: sdWindows, sdZone: sdZone };
