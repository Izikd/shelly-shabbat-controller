#!/usr/bin/env node
// Build the installable scripts from the readable sources:
//   dist/shabbat_controller.js       controller (src/main.js + src/table.js), minified
//   dist/shabbat_controller_diag.js  same with debug logging + staged boot memory logs
//   dist/shabbat_ui.js               settings page (src/ui.js), minified
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
//   "... - version v1.0.0 - commit e59860a - ..."   a release build
//   "... - version dev - commit e59860a - ..."      any other build
// version: VERSION env var (the release workflow sets it to the tag), else the tag exactly on
// HEAD if there is one, else "dev". commit: short HEAD id, "-dirty" if tracked files have
// uncommitted changes, "unknown" outside git. No tags or releases are needed to build.
//
// Usage: npm run build   (after npm install)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
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
const STAMP = `version ${VERSION} - commit ${COMMIT}`;

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
  return `// Shabbat controller - ${STAMP} - built by tools/build.mjs\n${out.code}\n`;
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
  const out = await minify(squeezeCss(src), {
    compress: { ecma: 2020 },
    mangle: { toplevel: true }, // runs inside new Function(), nothing outside sees its names
    format: { ...FORMAT, ecma: 2020, ascii_only: true }
  });
  return (
    `// shabbat_ui - ${STAMP} - DO NOT START this script. It only stores the ` +
    "settings page code, loaded by the browser from /script/<id>/ui\n" +
    out.code +
    "\n"
  );
}

const main = read("src/main.js");
const table = read("src/table.js").trim();
if (!main.includes("//@@TABLE@@")) throw new Error("src/main.js: //@@TABLE@@ marker missing");
const full = main.replace("//@@TABLE@@", () => table);

const diag = full
  .replace(/^(\s*)debug: false,/m, "$1debug: true,")
  .replace(/^(\s*)diag: false/m, "$1diag: true");
if (!/^\s*diag: true/m.test(diag) || !/^\s*debug: true,/m.test(diag)) {
  throw new Error("src/main.js: CFG.debug / CFG.diag flags not found for the diag build");
}

const outputs = {
  "shabbat_controller.js": await controller(full),
  "shabbat_controller_diag.js": await controller(diag),
  "shabbat_ui.js": await ui(read("src/ui.js"))
};

for (const [name, code] of Object.entries(outputs)) {
  const m = code.match(/[^\x00-\x7f]/);
  if (m) {
    const at = code.indexOf(m[0]);
    throw new Error(`${name}: non-ASCII text ${JSON.stringify(code.slice(at - 30, at + 10))}`);
  }
}

mkdirSync(join(ROOT, "dist"), { recursive: true });
for (const [name, code] of Object.entries(outputs)) {
  const dst = join(ROOT, "dist", name);
  writeFileSync(dst, code);
  console.log(`${dst}: ${Buffer.byteLength(code)} bytes`);
}
console.log(STAMP);
