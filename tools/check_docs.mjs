#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Keeps the notes honest: run by `npm test` and CI.
//   1. every file under docs/ is listed in docs/README.md (the index)
//   2. every relative Markdown link in AGENTS.md, README.md and docs/ points to a file that exists
//   3. every repository path written in backticks there (`src/...`, `test/...`, `tools/...`,
//      `docs/...`, `.github/...`) exists, so notes go stale loudly when files move
// It cannot tell whether a note is still true; AGENTS.md ("Done means") covers that.
//
// Usage: npm run check:docs

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => relative(ROOT, p) || ".";

function mdFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? mdFiles(p) : n.endsWith(".md") ? [p] : [];
  });
}

const docs = mdFiles(join(ROOT, "docs"));
const files = [join(ROOT, "AGENTS.md"), join(ROOT, "README.md"), ...docs];
const problems = [];

// 1. index
const indexPath = join(ROOT, "docs", "README.md");
const index = readFileSync(indexPath, "utf8");
const indexed = new Set(
  [...index.matchAll(/\]\(([^)#\s]+)/g)].map((m) => resolve(dirname(indexPath), m[1]))
);
for (const f of docs) {
  if (f !== indexPath && !indexed.has(f)) problems.push(`${rel(f)}: not listed in docs/README.md`);
}

// 2. links, 3. backticked repository paths
const PATH = /^(?:\.github|src|test|tools|docs)\/[\w./-]*$/;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue; // anchor only, http:, mailto:, ...
    if (!existsSync(resolve(dirname(f), target)))
      problems.push(`${rel(f)}: link to missing ${target}`);
  }
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const p = m[1].trim();
    if (!PATH.test(p)) continue;
    if (!existsSync(join(ROOT, p))) problems.push(`${rel(f)}: path \`${p}\` does not exist`);
  }
}

if (problems.length) {
  console.log(problems.join("\n"));
  console.log(`DOCS CHECK FAILED (${problems.length})`);
  process.exitCode = 1;
} else {
  console.log(`DOCS CHECK PASSED (${files.length} files, ${docs.length - 1} indexed notes)`);
}
