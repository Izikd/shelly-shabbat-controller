// SPDX-License-Identifier: MIT
// Re-stamp a built script with another version, as if it were a release build: the first
// line, and for shabbat_ui also the stamp inside its compressed page (the page compares its
// own version too). Used by test/mockdevice.js and test/ui_test.js for the update test.
"use strict";
const zlib = require("zlib");

function restamp(code, version) {
  const re = /version \S+ /;
  let out = code.replace(re, "version " + version + " ");
  // the page payload: the one long base64 string literal in the unpacker (tools/build.mjs)
  return out.replace(/"([A-Za-z0-9+/]{2000,}={0,2})"/, (all, b64) => {
    const page = zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8");
    if (!re.test(page)) throw new Error("stamp not found in the page");
    const again = zlib.deflateSync(Buffer.from(page.replace(re, "version " + version + " ")), {
      level: 9
    });
    return JSON.stringify(again.toString("base64"));
  });
}
module.exports = { restamp };
