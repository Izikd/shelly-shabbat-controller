#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Build the installable scripts from the readable sources:
//   dist/shabbat_controller.js       controller (src/main.js + src/table.js), minified
//   dist/shabbat_ui.js               settings page (src/ui.js), minified
//   dist/manifest.json               script library manifest (library/manifest.json, checked)
//
// The Shelly keeps a running script's source in RAM, so the controller is minified too, but
// conservatively: terser only renames local variables and drops whitespace/comments
// (compress off). Restructuring code - inlining, merging statements into long comma or ternary
// expressions, reordering - could break the engine's limits (small stack, no hoisting; see
// README). Top-level names stay as written; test/sim.js calls them by name.
//
// The settings page runs in the browser (via new Function), so it gets full minification.
//
// Version stamp, in the first line of every file, where the settings page and tools/deploy.py
// read it (so it costs the running controller no memory):
//   "... - version v1.0.0 - commit e59860a - built 2026-11-06T08:20Z ..."   a release build
//   "... - version dev - commit e59860a - built 2026-11-06T08:20Z ..."      any other build
// version: VERSION env var (the release workflow sets it to the tag), else the tag exactly on
// HEAD if there is one, else "dev". commit: short HEAD id, "-dirty" if tracked files have
// uncommitted changes, "unknown" outside git. No tags or releases are needed to build.
//
// Usage: npm run build   (after npm install)

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { deflateSync, constants as zc } from "node:zlib";
import { minify } from "terser";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

function git(cmd) {
  try {
    return execSync("git " + cmd, { cwd: ROOT, stdio: "pipe" })
      .toString()
      .trim();
  } catch (e) {
    return null; // not a git checkout, no tag on HEAD, ...
  }
}
function commit() {
  const c = git("rev-parse --short=7 HEAD");
  if (!c) return "unknown";
  return git("diff --quiet HEAD --") === null ? c + "-dirty" : c;
}
const VERSION = process.env.VERSION || git("describe --tags --exact-match HEAD") || "dev";
const COMMIT = commit();
for (const v of [VERSION, COMMIT]) if (!/^[\w.+-]+$/.test(v)) throw new Error("bad version: " + v);
// build time, ISO 8601 in UTC to the minute; SOURCE_DATE_EPOCH (the reproducible-builds
// convention) fixes it, otherwise now
const built = process.env.SOURCE_DATE_EPOCH
  ? new Date(+process.env.SOURCE_DATE_EPOCH * 1000)
  : new Date();
if (isNaN(built)) throw new Error("bad SOURCE_DATE_EPOCH: " + process.env.SOURCE_DATE_EPOCH);
const BUILT = built.toISOString().slice(0, 16) + "Z"; // 2026-11-06T08:20Z
const STAMP = `version ${VERSION} - commit ${COMMIT} - built ${BUILT}`;

// Both outputs must be pure ASCII: Script.GetCode is read in small byte ranges (large reads
// can reboot the device) and the firmware garbles a UTF-8 character split across two ranges.
// The page is escaped to ASCII (\uXXXX is fine in the browser); the controller cannot be
// (the Shelly engine rejects \u escapes), so it must not contain non-ASCII text at all.
const FORMAT = { comments: false, ascii_only: false };

async function controller(src) {
  const out = await minify(src, {
    compress: false,
    mangle: { toplevel: false },
    format: { ...FORMAT, max_line_len: 200 }
  });
  return `// Shabbat controller - ${STAMP} (tools/build.mjs)\n${out.code}\n`;
}

function squeezeCss(src) {
  // the page's CSS is a readable template literal: `var css = \` ... \`;`
  return src.replace(/(var css = `)([\s\S]*?)(`;)/, (_, a, css, b) => {
    const tight = css
      .replace(/\s*([{};,])\s*/g, "$1")
      .replace(/:\s+/g, ":")
      .replace(/;}/g, "}")
      .trim();
    return a + tight + b;
  });
}

async function ui(src) {
  if (!src.includes('"@@VERSION@@"')) throw new Error('src/ui.js: "@@VERSION@@" marker missing');
  src = src.replace('"@@VERSION@@"', JSON.stringify(STAMP));
  const page = await minify(squeezeCss(src), {
    compress: { ecma: 2020 },
    mangle: { toplevel: true }, // runs inside new Function(), nothing outside sees its names
    format: { ...FORMAT, ecma: 2020 } // UTF-8: it is compressed below, so it may be non-ASCII
  });
  // Compress the page (zlib) and store it base64 inside src/unpack.js, which the browser runs:
  // ~35 KB of ASCII-escaped code becomes ~15 KB of ASCII, so fewer Script.GetCode reads.
  const payload = deflateSync(Buffer.from(page.code, "utf8"), {
    level: 9,
    windowBits: 15, // 32 KB window: the size browsers' DecompressionStream("deflate") accepts
    strategy: zc.Z_DEFAULT_STRATEGY
  }).toString("base64");
  const unpack = read("src/unpack.js");
  if (!unpack.includes('"@@PAYLOAD@@"')) throw new Error('src/unpack.js: "@@PAYLOAD@@" missing');
  const out = await minify(
    unpack.replace('"@@PAYLOAD@@"', () => JSON.stringify(payload)),
    {
      compress: { ecma: 5 }, // the unpacker must also run on old browsers
      mangle: { toplevel: true },
      format: { ...FORMAT, ascii_only: true }
    }
  );
  console.log(
    `settings page: ${Buffer.byteLength(page.code)} bytes minified, ` +
      `${payload.length} as compressed base64`
  );
  return (
    `// shabbat_ui - ${STAMP} - DO NOT START this script. It only stores the ` +
    "settings page code (compressed), loaded by the browser from /script/<id>/ui\n" +
    out.code +
    "\n"
  );
}

const main = read("src/main.js");
const table = read("src/table.js").trim();
if (!main.includes("//@@TABLE@@")) throw new Error("src/main.js: //@@TABLE@@ marker missing");
const full = main.replace("//@@TABLE@@", () => table);

const outputs = {
  "shabbat_controller.js": await controller(full),
  "shabbat_ui.js": await ui(read("src/ui.js"))
};

for (const [name, code] of Object.entries(outputs)) {
  const m = code.match(/[^\x00-\x7f]/);
  if (m) {
    const at = code.indexOf(m[0]);
    throw new Error(`${name}: non-ASCII text ${JSON.stringify(code.slice(at - 30, at + 10))}`);
  }
}

rmSync(join(ROOT, "dist"), { recursive: true, force: true }); // no stale outputs to upload
mkdirSync(join(ROOT, "dist"), { recursive: true });
for (const [name, code] of Object.entries(outputs)) {
  const dst = join(ROOT, "dist", name);
  writeFileSync(dst, code);
  console.log(`${dst}: ${Buffer.byteLength(code)} bytes`);
}

// Script library manifest (Shelly web UI: Scripts -> Library -> Configure URL). Each fname is
// resolved next to the manifest, so the release publishes it together with the scripts.
const manifest = JSON.parse(read("library/manifest.json"));
for (const e of manifest) {
  if (!outputs[e.fname]) throw new Error(`library/manifest.json: unknown fname ${e.fname}`);
  if (!e.title || !e.description) throw new Error(`library/manifest.json: ${e.fname} incomplete`);
}
writeFileSync(join(ROOT, "dist", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`${join(ROOT, "dist", "manifest.json")}: ${manifest.length} scripts`);
console.log(STAMP);
