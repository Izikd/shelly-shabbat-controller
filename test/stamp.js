// SPDX-License-Identifier: MIT
// Re-stamp a built script with another version, as if it were a release build: the first
// line, and for shabbat_ui also the stamp inside its compressed page (the page compares its
// own version too). Used by test/mockdevice.js and test/ui_test.js for the update test.
"use strict";
const zlib = require("zlib");

// Z85 as tools/build.mjs writes the payload: the number of zero bytes added at the end, then
// 5 characters per 4 bytes
const Z85 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";
function z85(buf) {
  const pad = (4 - (buf.length % 4)) % 4;
  const b = Buffer.concat([buf, Buffer.alloc(pad)]);
  let out = String(pad);
  for (let i = 0; i < b.length; i += 4) {
    let v = b.readUInt32BE(i),
      five = "";
    for (let k = 0; k < 5; k++, v = Math.floor(v / 85)) five = Z85[v % 85] + five;
    out += five;
  }
  return out;
}
function unz85(s) {
  const b = Buffer.alloc(((s.length - 1) / 5) * 4);
  for (let i = 0, j = 1; i < b.length; i += 4) {
    let v = 0;
    for (let k = 0; k < 5; k++) v = v * 85 + Z85.indexOf(s[j++]);
    b.writeUInt32BE(v, i);
  }
  return b.subarray(0, b.length - +s[0]);
}

function restamp(code, version) {
  const re = /version \S+ /;
  let out = code.replace(re, "version " + version + " ");
  // the page payload: the one long string literal in the unpacker (tools/build.mjs)
  return out.replace(/"([0-3][^"\\]{2000,})"/, (all, text) => {
    const page = zlib.inflateSync(unz85(text)).toString("utf8");
    if (!re.test(page)) throw new Error("stamp not found in the page");
    const again = zlib.deflateSync(Buffer.from(page.replace(re, "version " + version + " ")), {
      level: 9
    });
    return JSON.stringify(z85(again));
  });
}
module.exports = { restamp, z85, unz85, Z85 };
