// SPDX-License-Identifier: MIT
// HTML of the public pages (no script: plain server-rendered HTML, in the device's time zone:
// the schedule's tz, Israel for devices that do not send one).

const TZ = "Asia/Jerusalem";
// formatters of the page being rendered (renderPage sets them for the schedule's time zone)
let DF, HDF;
function useTz(tz) {
  DF = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  HDF = {
    he: new Intl.DateTimeFormat("he-u-ca-hebrew", { timeZone: tz, day: "numeric", month: "long" }),
    en: new Intl.DateTimeFormat("en-u-ca-hebrew", { timeZone: tz, day: "numeric", month: "long" })
  };
}
useTz(TZ);
const STALE = 2 * 86400 + 4 * 3600; // the device sends daily; warn after two days without

const T = {
  he: {
    dir: "rtl",
    other: "en",
    otherLabel: "English",
    defTitle: "לוח זמנים לשבת",
    sub: "זמני ההפעלה בשבתות ובחגים הקרובים · שעון ישראל",
    updated: "עודכן {0}",
    never: "המכשיר עוד לא שלח את לוח הזמנים.",
    stale: "המכשיר לא עדכן מאז {0}. ייתכן שהזמנים אינם מעודכנים.",
    autoOff: "האוטומציה כבויה במכשיר – הוא לא יופעל אוטומטית עד שתופעל מחדש.",
    none: "אין חלונות קרובים להצגה.",
    window: "{0} ← {1}",
    skipped: "בוטל – לא יופעל בחלון זה",
    noOn: "אין הפעלות בחלון זה",
    nowWin: "עכשיו",
    onNow: "פועל עכשיו",
    min: "{0} דק׳",
    every: "{0} כל {1}",
    hm: "{0} שע׳ {1} דק׳",
    foot: "שעון שבת ל-Shelly · הדף מתעדכן אוטומטית מהמכשיר",
    missingT: "הדף לא נמצא",
    missing: "אין לוח זמנים בכתובת הזו. ייתכן שהפרסום הופסק או שהקישור שגוי.",
    homeT: "לוחות זמנים לשבת",
    home: "כאן מתפרסמים לוחות זמנים של שעוני שבת ל-Shelly. כל לוח נמצא בקישור משלו, שבעל המכשיר משתף.",
    wd: { Sun: "א׳", Mon: "ב׳", Tue: "ג׳", Wed: "ד׳", Thu: "ה׳", Fri: "ו׳", Sat: "ש׳" },
    hol: {
      Shabbat: "שבת",
      Pesach: "פסח",
      "Pesach VII": "שביעי של פסח",
      Shavuot: "שבועות",
      "Rosh Hashana": "ראש השנה",
      "Yom Kippur": "יום כיפור",
      Sukkot: "סוכות",
      "Simchat Torah": "שמחת תורה"
    },
    kind: { 1: "שבת", 2: "יום טוב", 3: "שבת + יו״ט" }
  },
  en: {
    dir: "ltr",
    other: "he",
    otherLabel: "עברית",
    defTitle: "Shabbat schedule",
    sub: "On times for the coming Shabbatot and holidays · Israel time",
    updated: "Updated {0}",
    never: "The device has not sent its schedule yet.",
    stale: "The device has not reported since {0}. The times may be out of date.",
    autoOff:
      "Automation is off on the device – it will not switch on automatically until it is turned back on.",
    none: "No upcoming windows to show.",
    window: "{0} → {1}",
    skipped: "Cancelled – will not run in this window",
    noOn: "Nothing scheduled in this window",
    nowWin: "now",
    onNow: "on now",
    min: "{0} min",
    every: "{0} every {1}",
    hm: "{0} h {1} min",
    foot: "Shabbat clock for Shelly · this page updates itself from the device",
    missingT: "Page not found",
    missing:
      "There is no schedule at this address. Publishing may have stopped, or the link is wrong.",
    homeT: "Shabbat schedules",
    home: "Schedules of Shabbat clocks for Shelly are published here. Each one has its own link, shared by the owner of the device.",
    wd: null,
    hol: { "Pesach VII": "Pesach (7th day)" },
    kind: { 1: "Shabbat", 2: "Yom Tov", 3: "Shabbat + Yom Tov" }
  }
};

function tr(s, ...a) {
  return a.reduce((x, v, i) => x.replace("{" + i + "}", v), s);
}
export function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function parts(t) {
  const o = {};
  for (const p of DF.formatToParts(new Date(t * 1000))) o[p.type] = p.value;
  return o;
}
const hm = (t) => {
  const p = parts(t);
  return p.hour + ":" + p.minute;
};
function day(t, L) {
  const p = parts(t);
  return (L.wd ? L.wd[p.weekday] : p.weekday) + " " + p.day + "/" + p.month;
}
const full = (t, L) => day(t, L) + " " + hm(t);

function gem(n) {
  if (n === 15) return "ט״ו";
  if (n === 16) return "ט״ז";
  const g =
    ["", "י", "כ", "ל"][Math.floor(n / 10)] +
    ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"][n % 10];
  return g.length > 1 ? g.slice(0, -1) + "״" + g.slice(-1) : g + "׳";
}
function hdate(t, lang) {
  const o = {};
  for (const p of HDF[lang].formatToParts(new Date(t * 1000))) o[p.type] = p.value;
  return lang === "he" ? gem(+o.day) + " ב" + o.month : o.day + " " + o.month;
}
function title(t, L) {
  return t
    .split(" + ")
    .map((x) => L.hol[x] || x)
    .join(" + ");
}
function dur(sec, L) {
  const m = Math.round(sec / 60);
  return m < 120 || m % 60 ? tr(L.min, m) : tr(L.hm, Math.floor(m / 60), m % 60);
}

const CSS = `
:root{--bg:#F3F5F8;--fg:#16202A;--card:#fff;--line:#E2E6EC;--muted:#4B5563;--acc:#1D4ED8;--slot:#EEF4FF;--slotfg:#1E3A8A;--warnbg:#FEF3C7;--warnfg:#92400E;--now:#0F5132}
@media (prefers-color-scheme:dark){:root{--bg:#0F141A;--fg:#E7ECF2;--card:#18202A;--line:#2A3440;--muted:#A3AEBB;--acc:#7EA6FF;--slot:#1C2A44;--slotfg:#BBD0FF;--warnbg:#3A2C0B;--warnfg:#F6D58A;--now:#3FB27F}}
body{margin:0;background:var(--bg);color:var(--fg);font-family:Heebo,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;line-height:1.4}
main{max-width:560px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:12px}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
h1{margin:0;font-size:22px;overflow-wrap:anywhere}
.s{font-size:13px;color:var(--muted)}
.lang{font-size:13px;color:var(--acc);border:1px solid var(--line);border-radius:999px;padding:5px 10px;text-decoration:none;white-space:nowrap;background:var(--card)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:8px}
.card.cur{border-color:var(--acc)}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.top b{font-size:16px}
.tag{font-size:12px;color:var(--muted);white-space:nowrap}
.tag.now{color:var(--now);font-weight:700}
.slot{display:flex;align-items:center;gap:10px;background:var(--slot);border-radius:8px;padding:8px 10px;font-size:14px}
.tm{font-weight:600;color:var(--slotfg);direction:ltr;unicode-bidi:isolate}
.grow{flex:1;color:var(--muted);font-size:13px}
.on{font-size:12px;font-weight:700;color:#fff;background:var(--now);border-radius:999px;padding:2px 8px}
.warn{font-size:14px;color:var(--warnfg);background:var(--warnbg);border-radius:8px;padding:8px 10px}
footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:4px 2px 24px}
footer a{color:var(--acc)}
`;

function shell(L, lang, head, body) {
  return (
    `<!doctype html><html lang="${lang}" dir="${L.dir}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex">${head}<style>${CSS}</style></head>` +
    `<body><main>${body}</main></body></html>`
  );
}

function windowCard(w, now, L, lang) {
  const cur = w.s <= now && now < w.e;
  let slots = "";
  if (w.x) slots = `<div class="warn">${esc(L.skipped)}</div>`;
  else if (!w.on.length && !(w.rp || []).length) slots = `<span class="s">${esc(L.noOn)}</span>`;
  else
    // rp (v 2): repeating timers in short, [first start, last end, every, duration] (minutes)
    slots = w.on
      .concat(w.rp || [])
      .filter((o) => o[1] > now)
      .sort((a, b) => a[0] - b[0])
      .map(
        (o) =>
          `<div class="slot"><span class="tm">${hm(o[0])}–${hm(o[1])}</span>` +
          `<span class="grow">${esc(day(o[0], L))} · ${esc(
            o.length > 2 ? tr(L.every, tr(L.min, o[3]), tr(L.min, o[2])) : dur(o[1] - o[0], L)
          )}</span>` +
          (o[0] <= now && o.length === 2 ? `<span class="on">${esc(L.onNow)}</span>` : "") +
          `</div>`
      )
      .join("");
  return (
    `<section class="card${cur ? " cur" : ""}"><div class="top">` +
    `<b>${esc(title(w.t, L))} · ${esc(hdate(w.s + 43200, lang))}</b>` +
    `<span class="tag${cur ? " now" : ""}">${esc(cur ? L.nowWin : L.kind[w.k])}</span></div>` +
    `<span class="s">${esc(tr(L.window, full(w.s, L), full(w.e, L)))}</span>${slots}</section>`
  );
}

// {lang, now, name, updated, data, link}
export function renderPage(o) {
  const L = T[o.lang];
  useTz((o.data && o.data.tz) || TZ);
  const name = o.name || L.defTitle;
  const wins = o.data ? o.data.w.filter((w) => w.e > o.now) : [];
  const next = wins[0];
  const desc = next ? title(next.t, L) + " · " + full(next.s, L) : L.sub;
  const head =
    `<title>${esc(name)}</title>` +
    `<meta name="description" content="${esc(desc)}">` +
    `<meta property="og:title" content="${esc(name)}">` +
    `<meta property="og:description" content="${esc(desc)}">` +
    `<meta property="og:type" content="website">` +
    `<meta property="og:url" content="${esc(o.link)}">` +
    `<meta http-equiv="refresh" content="900">`;
  let body =
    `<header><div><h1>${esc(name)}</h1><div class="s">${esc(L.sub)}</div>` +
    (o.updated ? `<div class="s">${esc(tr(L.updated, full(o.updated, L)))}</div>` : "") +
    `</div><a class="lang" lang="${L.other}" href="?lang=${L.other}">${L.otherLabel}</a></header>`;
  if (!o.data) body += `<div class="warn">${esc(L.never)}</div>`;
  else {
    if (o.now - o.updated > STALE)
      body += `<div class="warn">${esc(tr(L.stale, full(o.updated, L)))}</div>`;
    if (!o.data.auto) body += `<div class="warn">${esc(L.autoOff)}</div>`;
    body += wins.length
      ? wins.map((w) => windowCard(w, o.now, L, o.lang)).join("")
      : `<span class="s">${esc(L.none)}</span>`;
  }
  body += `<footer><span class="s">${esc(L.foot)}</span></footer>`;
  return shell(L, o.lang, head, body);
}

export function renderHome(lang) {
  const L = T[lang];
  return shell(
    L,
    lang,
    `<title>${esc(L.homeT)}</title>`,
    `<header><h1>${esc(L.homeT)}</h1><a class="lang" lang="${L.other}" href="?lang=${L.other}">${L.otherLabel}</a></header>` +
      `<div class="card">${esc(L.home)}</div>`
  );
}

export function renderMissing(lang) {
  const L = T[lang];
  return shell(
    L,
    lang,
    `<title>${esc(L.missingT)}</title>`,
    `<header><h1>${esc(L.missingT)}</h1><a class="lang" lang="${L.other}" href="?lang=${L.other}">${L.otherLabel}</a></header>` +
      `<div class="card">${esc(L.missing)}</div>`
  );
}
