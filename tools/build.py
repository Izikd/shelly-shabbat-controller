#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Combine src/main.js + src/table.js into single installable files:
     dist/shabbat_elevator.js       normal build
     dist/shabbat_elevator_diag.js  staged boot + memory logs + debug logging
The Shelly JS engine keeps script source in RAM, so the body is compacted
(indentation, comments, blank lines removed)."""
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
main = open(os.path.join(root, "src/main.js"), encoding="utf-8").read()
table = open(os.path.join(root, "src/table.js"), encoding="utf-8").read().strip()
assert "//@@TABLE@@" in main


def strip_line(line):
    """Remove indentation and a trailing // comment (quote-aware)."""
    out, q, i = [], None, 0
    while i < len(line):
        ch = line[i]
        if q:
            out.append(ch)
            if ch == "\\" and i + 1 < len(line):
                out.append(line[i + 1]); i += 1
            elif ch == q:
                q = None
        elif ch in "\"'":
            q = ch; out.append(ch)
        elif line.startswith("//", i):
            break
        else:
            out.append(ch)
        i += 1
    return "".join(out).strip()


PUNCT = set("{}()[];,:=+-*/<>!&|?%.")


def squeeze(line):
    """Drop spaces next to punctuation outside string literals (keeps '+ +' / '- -')."""
    out, q, i = [], None, 0
    while i < len(line):
        ch = line[i]
        if q:
            out.append(ch)
            if ch == "\\" and i + 1 < len(line):
                out.append(line[i + 1]); i += 1
            elif ch == q:
                q = None
        elif ch in "\"'":
            q = ch; out.append(ch)
        elif ch == " ":
            prev = out[-1] if out else ""
            nxt = line[i + 1] if i + 1 < len(line) else ""
            if (prev in PUNCT or nxt in PUNCT or nxt == " ") and not (prev == nxt and prev in "+-"):
                pass
            else:
                out.append(ch)
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def compact(src):
    lines = [squeeze(strip_line(l)) for l in src.split("\n")]
    return "// Shabbat Elevator - built by tools/build.py\n" + "\n".join(l for l in lines if l) + "\n"


full = main.replace("//@@TABLE@@", table)
variants = {
    "shabbat_elevator.js": full,
    "shabbat_elevator_diag.js": full.replace("  debug: false,", "  debug: true,").replace("  diag: false ", "  diag: true "),
}
assert "diag: true" in variants["shabbat_elevator_diag.js"]
os.makedirs(os.path.join(root, "dist"), exist_ok=True)
variants["shabbat_ui.js"] = open(os.path.join(root, "src/ui.js"), encoding="utf-8").read()
for name, src in variants.items():
    out = compact(src)
    if name == "shabbat_ui.js":
        out = out.replace("// Shabbat Elevator - built by tools/build.py", "// shabbat_ui - DO NOT START this script. It only stores the settings page code, loaded by the browser from /script/<id>/ui", 1)
    dst = os.path.join(root, "dist", name)
    open(dst, "w", encoding="utf-8").write(out)
    print(f"{dst}: {len(out.encode())} bytes")
