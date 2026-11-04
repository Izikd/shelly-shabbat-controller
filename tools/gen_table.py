#!/usr/bin/env python3
"""
Generate the Isur Melacha (no-melacha) window table for the Shelly script.

Output is a small JS snippet (src/table.js) holding the windows as one compact
encoded string - cheap in Shelly script memory.

Two input modes:

  1. Compute with hdate (needs: pip install hdate):
       python3 gen_table.py --lat 32.0878 --lon 34.8860 --years 2025 2026 ... 2035

  2. Convert an existing ESPHome header (isur_melacha_ranges.h):
       python3 gen_table.py --from-header isur_melacha_ranges.h

Encoding (8 chars per window, custom base64 alphabet):
  4 chars  start, minutes since TBL_BASE (2025-01-01 00:00 UTC)
  3 chars  duration in minutes
  1 char   index into TBL_T (title list)
"""

import argparse
import re
import sys
from datetime import date, datetime, timezone

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


def from_header(path):
    s = open(path, encoding="utf-8").read()
    return [(int(a), int(b), t) for a, b, t in re.findall(r'\{(\d+), (\d+), "([^"]*)"\}', s)]


def from_hdate(lat, lon, years):
    from hdate import HDateInfo, Location, Zmanim, translator
    from hdate.hebrew_date import Weekday
    from hdate.holidays import HolidayTypes

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
    ap.add_argument("--from-header")
    ap.add_argument("--lat", type=float, default=32.0877639)   # Petah Tikva
    ap.add_argument("--lon", type=float, default=34.8859985)
    ap.add_argument("--years", type=int, nargs="+")
    ap.add_argument("--output", default="src/table.js")
    ap.add_argument("--tz", default="Asia/Jerusalem")
    a = ap.parse_args()

    if a.from_header:
        ranges = from_header(a.from_header)
        src = f"converted from {a.from_header.split('/')[-1]}"
    else:
        if not a.years:
            sys.exit("--years required in hdate mode")
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
        f.write(f"// Isur Melacha table: {len(ranges)} windows, {first} .. {last} ({src})\n")
        f.write(f"let TBL_BASE = {BASE};\n")
        f.write("let TBL_T = [" + ",".join(f'"{t}"' for t in titles) + "];\n")
        f.write(f'let TBL = "{data}";\n')
        std, dst = dst_periods(a.tz, first.year, last.year + 1)
        f.write(f"// DST periods ({a.tz}), UTC seconds [start, end, ...]\n")
        f.write(f"let TBL_STD = {std};\n")
        f.write("let TBL_DST = [" + ",".join(f"{s0},{e0}" for s0, e0 in dst) + "];\n")
    print(f"{len(ranges)} windows, {len(titles)} titles, {len(data)} chars -> {a.output}")


if __name__ == "__main__":
    main()
