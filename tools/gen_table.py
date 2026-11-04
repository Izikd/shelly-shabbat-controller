#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["hdate>=1.2"]
# ///
"""
Generate the Shabbat & Yom Tov window table for the Shelly script
(candle lighting -> havdalah, Israel, computed with hdate).

    uv run tools/gen_table.py                                    # Petah Tikva, 2025-2030
    uv run tools/gen_table.py --lat 31.778 --lon 35.235 --years 2026 2027 2028

uv installs hdate from the script header above into a cached environment.

Writes:
  src/table.js        the table for the script, one compact encoded string
                      (cheap in Shelly script memory) + DST periods
  test/windows.json   the same windows as plain [start, end, kind] for test/sim.js
                      (kind 1 = Shabbat only, 2 = Yom Tov only, 3 = both)

Run `npm run build` afterwards to rebuild dist/.

Encoding (8 chars per window, custom base64 alphabet):
  4 chars  start, minutes since TBL_BASE (2025-01-01 00:00 UTC)
  3 chars  duration in minutes
  1 char   index into TBL_T (title list)
"""

import argparse
import json
import os
import re
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-"
BASE = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp())


def enc(n: int, width: int) -> str:
    assert 0 <= n < 64 ** width, (n, width)
    s = ""
    for _ in range(width):
        s = ALPHA[n % 64] + s
        n //= 64
    return s


def clean_title(raw: str) -> str:
    """'Rosh Hashana I, Shaabat, Rosh Hashana II' -> 'Rosh Hashana + Shabbat'"""
    parts = []
    shabbat = False
    for p in raw.split(","):
        p = p.strip()
        if p in ("Shaabat", "Shabbat"):
            shabbat = True
            continue
        p = re.sub(r"^Rosh Hashana I+$", "Rosh Hashana", p)
        if p == "Shmini Atzeret":
            continue  # same day as Simchat Torah in Israel
        if p and p not in parts:
            parts.append(p)
    if shabbat:
        parts.append("Shabbat")
    return " + ".join(parts) or "Shabbat"


def kind(raw: str) -> int:
    """1 = Shabbat only, 2 = Yom Tov only, 3 = both."""
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    shabbat = "Shabbat" in parts
    return 1 if shabbat and len(parts) == 1 else (3 if shabbat else 2)


def dst_periods(tzname, y0, y1):
    """[(start_utc, end_utc)] of DST periods for years y0..y1 from the tz database."""
    from datetime import timedelta
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(tzname)
    t = datetime(y0, 1, 1, tzinfo=timezone.utc)
    end = datetime(y1 + 1, 1, 1, tzinfo=timezone.utc)
    std = t.astimezone(tz).utcoffset()
    out, cur = [], None
    while t < end:
        dst = t.astimezone(tz).dst() != timedelta(0)
        if dst and cur is None:
            cur = int(t.timestamp())
        elif not dst and cur is not None:
            out.append((cur, int(t.timestamp()))); cur = None
        t += timedelta(hours=1)
    return int(std.total_seconds()), out


def from_hdate(lat, lon, years):
    import hdate.zmanim
    from hdate import HDateInfo, Location, Zmanim, translator
    from hdate.hebrew_date import Weekday
    from hdate.holidays import HolidayTypes

    # hdate switches to a different sun model when the optional `astral` package is
    # installed, moving times by 2-8 minutes. Always use hdate's own model, which the
    # table has used since the start, so the output does not depend on what is installed.
    if hasattr(hdate.zmanim, "_USE_ASTRAL"):
        hdate.zmanim._USE_ASTRAL = False

    translator.set_language("en")
    loc = Location(name="site", latitude=lat, longitude=lon,
                   timezone="Asia/Jerusalem", diaspora=False)
    out = []
    for year in years:
        end_date = HDateInfo(date(year, 12, 31))
        erev = HDateInfo(date(year, 1, 1)).upcoming_erev_shabbat_or_erev_yom_tov
        while erev.date <= end_date.date:
            last = erev.last_day
            cl = Zmanim(date=erev.gdate, location=loc).candle_lighting
            hv = Zmanim(date=last.gdate, location=loc).havdalah
            assert cl and hv
            titles = []
            d = erev
            while d.date <= last.date:
                if d.hdate.dow() == Weekday.FRIDAY:
                    titles.append("Shabbat")
                for h in d.holidays:
                    if h.type == HolidayTypes.YOM_TOV:
                        titles.append(str(h))
                d = d.next_day
            out.append((int(cl.timestamp()), int(hv.timestamp()), ", ".join(titles)))
            erev = last.next_day.upcoming_erev_shabbat_or_erev_yom_tov
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, default=32.0877639)   # Petah Tikva
    ap.add_argument("--lon", type=float, default=34.8859985)
    ap.add_argument("--years", type=int, nargs="+", default=list(range(2025, 2031)))
    ap.add_argument("--output", default=os.path.join(ROOT, "src", "table.js"))
    ap.add_argument("--ref", default=os.path.join(ROOT, "test", "windows.json"),
                    help="plain window list for test/sim.js")
    ap.add_argument("--tz", default="Asia/Jerusalem")
    a = ap.parse_args()

    ranges = from_hdate(a.lat, a.lon, a.years)
    src = f"hdate lat={a.lat} lon={a.lon}"

    ranges = sorted(set(ranges))  # year-boundary scans can duplicate a window
    titles, data = [], ""
    for i, (s, e, t) in enumerate(ranges):
        assert s % 60 == 0 and e % 60 == 0 and e > s
        if i:
            assert s > ranges[i - 1][1], "overlapping windows"
        t = clean_title(t)
        if t not in titles:
            titles.append(t)
        data += enc((s - BASE) // 60, 4) + enc((e - s) // 60, 3) + ALPHA[titles.index(t)]

    first = datetime.fromtimestamp(ranges[0][0], timezone.utc).date()
    last = datetime.fromtimestamp(ranges[-1][1], timezone.utc).date()
    with open(a.output, "w", encoding="utf-8") as f:
        f.write(f"// Shabbat & Yom Tov table: {len(ranges)} windows, {first} .. {last} ({src})\n")
        f.write(f"let TBL_BASE = {BASE};\n")
        f.write("let TBL_T = [" + ",".join(f'"{t}"' for t in titles) + "];\n")
        f.write(f'let TBL = "{data}";\n')
        std, dst = dst_periods(a.tz, first.year, last.year + 1)
        f.write(f"// DST periods ({a.tz}), UTC seconds [start, end, ...]\n")
        f.write(f"let TBL_STD = {std};\n")
        f.write("let TBL_DST = [" + ",".join(f"{s0},{e0}" for s0, e0 in dst) + "];\n")
    with open(a.ref, "w", encoding="utf-8") as f:
        f.write("[\n" + ",\n".join(json.dumps([s, e, kind(t)]) for s, e, t in ranges) + "\n]\n")
    print(f"{len(ranges)} windows, {len(titles)} titles, {len(data)} chars -> {a.output}")


if __name__ == "__main__":
    main()
