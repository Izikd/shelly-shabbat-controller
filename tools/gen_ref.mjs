#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Reference tables for the tests, computed with hebcal (devDependencies @hebcal/core and
// @hebcal/cities, pinned) through src/tablegen.js - the same code the settings page runs:
//   test/dates/<name>.txt   shabbat_dates script code, as the page would write it
//   test/windows.json       {<name>: {tz, w: [[start, end, kind], ...]}} for test/sim.js
// 2025-2030 for three places: Israel, abroad (two-day Yom Tov), southern hemisphere DST.
// npm run check:ref regenerates them and fails if they changed (CI).
import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as hc from "@hebcal/core";
import "@hebcal/cities";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { sdBuild, sdParse } = require("../src/tablegen.js");
const HC = hc.version;

const PLACES = { pt: "Petah Tiqwa", ny: "New York", syd: "Sydney" };
const FROM = new Date(Date.UTC(2025, 0, 1)),
  TO = new Date(Date.UTC(2031, 0, 1));
mkdirSync(join(ROOT, "test/dates"), { recursive: true });
const ref = {};
for (const [key, name] of Object.entries(PLACES)) {
  const l = hc.Location.lookup(name);
  if (!l) throw new Error("hebcal has no city " + name);
  const place = {
    n: l.getName(),
    cc: l.getCountryCode(),
    la: l.getLatitude(),
    lo: l.getLongitude(),
    tz: l.getTzid(),
    il: l.getIsrael()
  };
  const code = sdBuild(hc, place, FROM, TO, HC, 1735689600);
  writeFileSync(join(ROOT, "test/dates", key + ".txt"), code);
  const p = sdParse(code);
  ref[key] = { tz: p.tz, w: p.w.map((w) => [w.s, w.e, w.k]) };
  console.log(`${key}: ${place.n} (${place.tz}), ${p.w.length} windows, ${code.length} bytes`);
}
writeFileSync(
  join(ROOT, "test/windows.json"),
  "{\n" +
    Object.entries(ref)
      .map(
        ([k, v]) =>
          `"${k}": {"tz": "${v.tz}", "w": [\n` +
          v.w.map((w) => JSON.stringify(w)).join(",\n") +
          "\n]}"
      )
      .join(",\n") +
    "\n}\n"
);

// The far north (src/tablegen.js): no havdalah by degrees in summer -> by minutes after
// sunset; no sunset either -> refused. No window may last weeks.
const north = (n, la, lo, tz) =>
  sdParse(sdBuild(hc, { n, cc: "", la, lo, tz, il: false }, FROM, TO, HC, 1735689600));
const longest = (p) => Math.max(...p.w.map((w) => w.e - w.s)) / 3600;
const sto = north("Stockholm", 59.33, 18.06, "Europe/Stockholm");
if (sto.meta.hm !== 72 || longest(sto) > 80 || sto.w.length < 300)
  throw new Error("Stockholm: " + JSON.stringify([sto.meta.hm, longest(sto), sto.w.length]));
const gla = north("Glasgow", 55.86, -4.25, "Europe/London");
if (gla.meta.hm !== undefined || longest(gla) > 80) throw new Error("Glasgow: by degrees");
let refused = false;
try {
  north("Tromso", 69.65, 18.96, "Europe/Oslo");
} catch (e) {
  refused = /no Shabbat times/.test(e.message);
}
if (!refused) throw new Error("Tromso: expected to be refused");
console.log("far north: Stockholm by minutes, Glasgow by degrees, Tromso refused");
