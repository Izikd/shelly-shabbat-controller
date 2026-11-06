// Shabbat controller - settings UI. Install as a script named "shabbat_ui" and
// NEVER start it: the page at /script/<id>/ui loads this code into the browser.
// Plain ES5 + guard, so starting it on the Shelly by mistake does nothing.
if (typeof document !== "undefined")
  (function () {
    var UI_STAMP = "@@VERSION@@"; // "version v1.0.0 - commit e59860a", set by tools/build.mjs
    // "v1.0.0 · e59860a" for a release build, "e59860a" for any other build
    function verLabel(stamp) {
      var v = (stamp || "").match(/version (\S+)/),
        c = (stamp || "").match(/commit (\S+)/);
      if (!v && !c) return "";
      var cid = c ? c[1] : "?";
      return v && v[1] !== "dev" ? v[1] + " · " + cid : cid;
    }
    var UI_VERSION = verLabel(UI_STAMP);
    // build time from the stamp, ISO 8601 UTC ("built 2026-11-06T08:20Z") -> UTC seconds
    function builtAt(stamp) {
      var m = (stamp || "").match(/built (\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)Z/);
      return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 1000 : 0;
    }
    var UI_BUILT = builtAt(UI_STAMP);
    var ID = window.SE_ID,
      TZ = "Asia/Jerusalem";
    var S = {
      tab: "status",
      timers: [],
      saved: "[]",
      editing: -1,
      cfg: null,
      st: null,
      prev: null,
      err: "",
      flash: "",
      tbl: null,
      tblErr: "",
      tblHol: false,
      tblPast: false
    };

    // ---------- languages ----------
    // Every visible string lives here. tr(s, a, b, ...) fills {0} {1} ...
    var I18N = {
      he: {
        dir: "rtl",
        appTitle: "שעון שבת",
        langBtn: "English",
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
        kind: { 1: "שבת", 2: "יום טוב", 3: "שבת + יו״ט" },
        arrow: " ← ",
        more: "◂ ",
        less: "▾ ",
        min: "{0} דק׳",
        hours: "{0} שעות",
        upDays: "{0} ימים ",
        upHM: "{0} שע׳ {1} דק׳",
        noConn: "אין חיבור למכשיר",
        loading: "טוען…",
        none: "אין",
        dec5: "הפחת 5 דקות",
        inc5: "הוסף 5 דקות",
        curUntil: "{0} · עד {1}",
        autoOff: "האוטומציה כבויה",
        onNowUntil: "פועל עכשיו עד {0}",
        noOnNext: "אין הפעלות בחלון הקרוב",
        tableEnds: "טבלת הזמנים מסתיימת ב-{0} – יש לעדכן את הסקריפט",
        notSynced: "השעון לא מסונכרן – הממסר כבוי ליתר ביטחון",
        manualTitle: "הממסר הופעל/כובה ידנית",
        manualBody: "האוטומציה לא תשנה את מצבו עד האירוע הבא בלוח הזמנים.",
        resume: "חזור לאוטומטי עכשיו",
        nowLabel: "שבת / יום טוב עכשיו",
        nextWin: "החלון הבא",
        skippedParen: " (מדולג)",
        nextOn: "הפעלה הבאה של הממסר",
        auto: "אוטומציה פעילה",
        autoHint: "כבוי = הממסר בשליטה ידנית",
        skip: "דלג על החלון הקרוב",
        skipHint: "חד-פעמי, חוזר לפעול אחריו",
        testTime: "זמן בדיקה",
        testHint: "מדמה שעה אחרת (שעון ישראל) כדי לבדוק את הממסר. לא נשמר אחרי הפעלה מחדש.",
        clear: "נקה",
        testActive: "מצב בדיקה פעיל – הממסר פועל לפי {0}",
        cause: {
          a: "אוטומטי",
          m: "ידני",
          t: "כיבוי אוטומטי של המכשיר",
          f: "ביטחון (שעון לא מסונכרן)",
          x: "זמן בדיקה"
        },
        log: "יומן הממסר",
        logHint: "15 ההפעלות והכיבויים האחרונים (נשמר במכשיר).",
        logEmpty: "אין עדיין אירועים",
        timeUnknown: "זמן לא ידוע",
        turnedOn: "הופעל",
        turnedOff: "כובה",
        tech: "מידע טכני",
        techErr: "מידע טכני: {0}",
        dVersion: "גרסה",
        dBuilt: "נבנה",
        dVerBoth: "בקר {0} · דף {1}",
        dDevice: "מכשיר",
        dFirmware: "קושחה",
        dUptime: "זמן פעולה",
        dLastSync: "סנכרון שעון אחרון",
        dNeverSynced: "לא סונכרן",
        dRamFree: "זיכרון פנוי במכשיר",
        dStorage: "אחסון פנוי",
        dOfFmt: "{0} מתוך {1} ({2})",
        dScrMem: "זיכרון הסקריפט",
        dMemFmt: "{0} בשימוש ({1}) · שיא {2} ({3}) · פנוי {4}",
        dScrState: "מצב הסקריפט",
        dRunning: "רץ",
        dStopped: "עצור",
        dErrors: "שגיאות",
        dLastSrc: "מקור פקודה אחרונה לממסר",
        dTemp: "טמפרטורה",
        refresh: "רענן",
        shabbatOnly: " · שבת בלבד",
        ytOnly: " · יו״ט בלבד",
        afterCandles: "אחרי הדלקת נרות",
        badgeCandles: "נרות",
        startsAfter: "מתחיל {0} אחרי · פועל {1}",
        beforeHavdalah: "לפני הבדלה",
        badgeHavdalah: "הבדלה",
        startsBefore: "מתחיל {0} לפני · פועל {1}",
        atTime: "בשעה {0}",
        badgeTime: "שעה",
        days: ["כל הימים", "יום ראשון", "יום אחרון"],
        daysOnFor: "{0} · פועל {1}",
        zeroDur: "משך 0 – לא פועל",
        startPoint: "נקודת התחלה",
        anchors: ["הדלקת נרות", "שעה קבועה", "הבדלה"],
        timeLabel: "שעה",
        minBefore: "כמה דקות לפני ההבדלה",
        minAfter: "כמה דקות אחרי הדלקת הנרות",
        duration: "משך",
        appliesTo: "חל על",
        applies: ["שבת ויו״ט", "שבת בלבד", "יו״ט בלבד"],
        whichDays: "באילו ימים",
        daysHint: "בחג של יומיים או שבת צמודה לחג – יום ראשון / אחרון / כל הימים.",
        delTimer: "מחק טיימר",
        done: "סיום",
        disableT: "כבה {0}",
        enableT: "הפעל {0}",
        timersHint: "כל טיימר פועל רק בתוך חלון של שבת או יום טוב.",
        addTimer: "+ הוסף טיימר",
        maxTimers: "הגעת למקסימום של 12 טיימרים.",
        tableErr: "לא ניתן לקרוא את הטבלה: {0}",
        tableSummary: "{0} חלונות בטבלה, מ-{1} עד {2}. שעות לפי הדלקת נרות והבדלה.",
        allWin: "שבתות וחגים",
        holOnly: "חגים בלבד",
        showPast: "הצג גם חלונות שעברו",
        nowTag: " · עכשיו",
        skipTag: " · מדולג",
        noRows: "אין חלונות להצגה",
        pvHint: "כך הממסר יפעל בחלונות הקרובים, לפי ההגדרות הנוכחיות (גם לפני שמירה).",
        pvSkipped: "מדולג – הממסר לא יופעל בחלון זה",
        pvNone: "אין הפעלות בחלון זה",
        tabs: ["מצב", "טיימרים", "תחזית", "לוח זמנים"],
        relayOn: "ממסר: פועל",
        relayOff: "ממסר: כבוי",
        testTag: " · בדיקה",
        scriptN: "Shelly · סקריפט {0}",
        error: "שגיאה: {0}",
        unsaved: "יש שינויים שלא נשמרו",
        discard: "בטל",
        saved: "נשמר במכשיר ✓",
        save: "שמור במכשיר"
      },
      en: {
        dir: "ltr",
        appTitle: "Shabbat Clock",
        langBtn: "עברית",
        wd: null, // English weekday names come from Intl
        hol: { "Pesach VII": "Pesach (7th day)" }, // other table titles are already English
        kind: { 1: "Shabbat", 2: "Yom Tov", 3: "Shabbat + Yom Tov" },
        arrow: " → ",
        more: "▸ ",
        less: "▾ ",
        min: "{0} min",
        hours: "{0} h",
        upDays: "{0} d ",
        upHM: "{0} h {1} min",
        noConn: "No connection to the device",
        loading: "Loading…",
        none: "None",
        dec5: "5 minutes less",
        inc5: "5 minutes more",
        curUntil: "{0} · until {1}",
        autoOff: "Automation is off",
        onNowUntil: "On now until {0}",
        noOnNext: "No relay time in the next window",
        tableEnds: "The schedule table ends on {0} – update the script",
        notSynced: "Clock not synced – relay kept off for safety",
        manualTitle: "The relay was switched manually",
        manualBody: "Automation will leave it as it is until the next timer event.",
        resume: "Return to automatic now",
        nowLabel: "Shabbat / Yom Tov now",
        nextWin: "Next window",
        skippedParen: " (skipped)",
        nextOn: "Next relay ON",
        auto: "Automation on",
        autoHint: "Off = the relay is under manual control",
        skip: "Skip the next window",
        skipHint: "One time; resumes after it",
        testTime: "Test time",
        testHint: "Simulates another time (Israel time) to check the relay. Cleared on restart.",
        clear: "Clear",
        testActive: "Test mode – the relay follows {0}",
        cause: {
          a: "automatic",
          m: "manual",
          t: "device auto-off",
          f: "fail-safe (clock not synced)",
          x: "test time"
        },
        log: "Relay log",
        logHint: "The last 15 on/off events (kept on the device).",
        logEmpty: "No events yet",
        timeUnknown: "unknown time",
        turnedOn: "on",
        turnedOff: "off",
        tech: "Technical info",
        techErr: "Technical info: {0}",
        dVersion: "Version",
        dBuilt: "Built",
        dVerBoth: "controller {0} · page {1}",
        dDevice: "Device",
        dFirmware: "Firmware",
        dUptime: "Uptime",
        dLastSync: "Last clock sync",
        dNeverSynced: "never",
        dRamFree: "Free device memory",
        dStorage: "Free storage",
        dOfFmt: "{0} of {1} ({2})",
        dScrMem: "Script memory",
        dMemFmt: "{0} used ({1}) · peak {2} ({3}) · free {4}",
        dScrState: "Script state",
        dRunning: "running",
        dStopped: "stopped",
        dErrors: "Errors",
        dLastSrc: "Last relay command source",
        dTemp: "Temperature",
        refresh: "Refresh",
        shabbatOnly: " · Shabbat only",
        ytOnly: " · Yom Tov only",
        afterCandles: "After candle lighting",
        badgeCandles: "Candles",
        startsAfter: "Starts {0} after · on for {1}",
        beforeHavdalah: "Before havdalah",
        badgeHavdalah: "Havdalah",
        startsBefore: "Starts {0} before · on for {1}",
        atTime: "At {0}",
        badgeTime: "Time",
        days: ["Every day", "First day", "Last day"],
        daysOnFor: "{0} · on for {1}",
        zeroDur: "Duration 0 – never on",
        startPoint: "Start point",
        anchors: ["Candle lighting", "Fixed time", "Havdalah"],
        timeLabel: "Time",
        minBefore: "Minutes before havdalah",
        minAfter: "Minutes after candle lighting",
        duration: "Duration",
        appliesTo: "Applies to",
        applies: ["Shabbat & Yom Tov", "Shabbat only", "Yom Tov only"],
        whichDays: "Which days",
        daysHint: "For a two-day holiday or Shabbat next to a holiday – first / last / every day.",
        delTimer: "Delete timer",
        done: "Done",
        disableT: "Disable {0}",
        enableT: "Enable {0}",
        timersHint: "Each timer works only inside a Shabbat or Yom Tov window.",
        addTimer: "+ Add timer",
        maxTimers: "Maximum of 12 timers reached.",
        tableErr: "Cannot read the table: {0}",
        tableSummary: "{0} windows in the table, from {1} to {2}. Candle lighting to havdalah.",
        allWin: "Shabbat & holidays",
        holOnly: "Holidays only",
        showPast: "Show past windows",
        nowTag: " · now",
        skipTag: " · skipped",
        noRows: "No windows to show",
        pvHint:
          "How the relay will run in the next windows with these settings (even before saving).",
        pvSkipped: "Skipped – the relay will not turn on in this window",
        pvNone: "No relay time in this window",
        tabs: ["Status", "Timers", "Forecast", "Schedule"],
        relayOn: "Relay: on",
        relayOff: "Relay: off",
        testTag: " · test",
        scriptN: "Shelly · script {0}",
        error: "Error: {0}",
        unsaved: "Unsaved changes",
        discard: "Discard",
        saved: "Saved to device ✓",
        save: "Save to device"
      }
    };
    var LANG_KEY = "shabbat_lang"; // per browser; the device does not store it
    var LANG, L;
    function tr(s) {
      for (var i = 1; i < arguments.length; i++) s = s.replace("{" + (i - 1) + "}", arguments[i]);
      return s;
    }
    function setLang(lang, save) {
      LANG = I18N[lang] ? lang : "en";
      L = I18N[LANG];
      document.documentElement.lang = LANG;
      document.documentElement.dir = L.dir;
      document.title = L.appTitle;
      if (save) {
        try {
          localStorage.setItem(LANG_KEY, LANG);
        } catch (e) {}
      }
    }
    var savedLang = null;
    try {
      savedLang = localStorage.getItem(LANG_KEY);
    } catch (e) {}
    // first visit: Hebrew for a Hebrew browser, English otherwise
    setLang(savedLang || (/^(he|iw)\b/i.test(navigator.language || "") ? "he" : "en"), false);

    // ---------- RPC ----------
    function rpc(method, params, cb) {
      params = params || {};
      params.id = ID;
      fetch("/rpc/Script." + method, { method: "POST", body: JSON.stringify(params) })
        .then(function (r) {
          return r.json();
        })
        .then(function (j) {
          if (j && j.code !== undefined && j.message !== undefined && !j.cfg && !j.w) {
            S.err = j.message;
            render();
            return;
          }
          S.err = "";
          cb(j);
        })
        .catch(function (e) {
          S.err = L.noConn;
          render();
        });
    }
    function toArr(t) {
      return [t.a, t.a === 1 ? t.m : t.o, t.d, t.p, t.y, t.e ? 1 : 0];
    }
    function toObj(v) {
      return {
        a: v[0],
        o: v[0] === 1 ? (v[0] === 2 ? -40 : 15) : v[1],
        m: v[0] === 1 ? v[1] : 720,
        d: v[2],
        p: v[3],
        y: v[4],
        e: !!v[5]
      };
    }
    function draft() {
      return S.timers.map(toArr);
    }
    function load(j) {
      S.cfg = j.cfg;
      S.st = j.st;
      S.log = j.log || "";
      S.base = j.base;
      if (!dirty()) {
        S.timers = j.cfg.timers.map(toObj);
        S.saved = JSON.stringify(j.cfg.timers);
      }
      render();
    }
    function dirty() {
      return JSON.stringify(draft()) !== S.saved;
    }
    var pvTimer = null;
    function preview() {
      clearTimeout(pvTimer);
      pvTimer = setTimeout(function () {
        rpc("ShabbatPreview", { timers: draft(), n: 6 }, function (j) {
          S.prev = j.w;
          render();
        });
      }, 250);
    }
    function refresh() {
      rpc("ShabbatGet", {}, load);
    }

    // ---------- time formatting (Israel time) ----------
    var DF = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    function parts(t) {
      var o = {};
      DF.formatToParts(new Date(t * 1000)).forEach(function (p) {
        o[p.type] = p.value;
      });
      return o;
    }
    function hm(t) {
      var p = parts(t);
      return p.hour + ":" + p.minute;
    }
    function day(t) {
      var p = parts(t);
      return (L.wd ? L.wd[p.weekday] : p.weekday) + " " + p.day + "/" + p.month;
    }
    function full(t) {
      return day(t) + " " + hm(t);
    }
    function jOffset(t) {
      var p = parts(t);
      return (
        Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 1000 - Math.floor(t / 60) * 60
      );
    }
    function fromLocalInput(v) {
      // "YYYY-MM-DDTHH:MM" in Israel time -> UTC seconds
      var g =
        Date.UTC(
          +v.substr(0, 4),
          +v.substr(5, 2) - 1,
          +v.substr(8, 2),
          +v.substr(11, 2),
          +v.substr(14, 2)
        ) / 1000;
      var u = g - jOffset(g);
      return g - jOffset(u);
    }
    function toLocalInput(t) {
      var p = parts(t);
      return p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute;
    }
    // Hebrew-calendar date from the browser's built-in Hebrew calendar:
    // Hebrew "כ״ז בחשוון" (day in Hebrew numerals), English "27 Heshvan"
    var HDF = {};
    ["he", "en"].forEach(function (l) {
      HDF[l] = new Intl.DateTimeFormat(l + "-u-ca-hebrew", {
        timeZone: TZ,
        day: "numeric",
        month: "long"
      });
    });
    function gem(n) {
      if (n === 15) return "ט״ו";
      if (n === 16) return "ט״ז";
      var t = ["", "י", "כ", "ל"][Math.floor(n / 10)],
        o = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"][n % 10],
        g = t + o;
      return g.length > 1 ? g.slice(0, -1) + "״" + g.slice(-1) : g + "׳";
    }
    function hdate(t) {
      var o = {};
      HDF[LANG].formatToParts(new Date(t * 1000)).forEach(function (p) {
        o[p.type] = p.value;
      });
      return LANG === "he" ? gem(+o.day) + " ב" + o.month : o.day + " " + o.month;
    }
    function wdate(w) {
      return hdate(w.s + 43200);
    } // the day itself (window starts the evening before)
    function title(t) {
      return t
        .split(" + ")
        .map(function (x) {
          return L.hol[x] || x;
        })
        .join(" + ");
    }
    function mm(n) {
      return tr(L.min, n);
    }
    function hhmm(m) {
      return ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2);
    }

    // ---------- DOM helpers ----------
    function h(tag, attrs) {
      var el = document.createElement(tag);
      for (var k in attrs || {}) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else if (k === "cls") el.className = v;
        else el.setAttribute(k, v === true ? "" : v);
      }
      for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
      return el;
    }
    function add(el, c) {
      if (c === null || c === undefined || c === false) return;
      if (c instanceof Array) {
        c.forEach(function (x) {
          add(el, x);
        });
        return;
      }
      el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    }
    function sw(on, label, fn) {
      return h(
        "button",
        {
          cls: "sw" + (on ? " on" : ""),
          "aria-pressed": on ? "true" : "false",
          "aria-label": label,
          onclick: fn
        },
        h("span")
      );
    }
    function pills(opts, cur, fn) {
      return h(
        "div",
        { cls: "pills" },
        opts.map(function (o) {
          return h(
            "button",
            {
              cls: "pill" + (o[0] === cur ? " sel" : ""),
              "aria-pressed": o[0] === cur ? "true" : "false",
              onclick: function () {
                fn(o[0]);
              }
            },
            o[1]
          );
        })
      );
    }
    function stepper(text, dec, inc) {
      return h(
        "div",
        { cls: "step" },
        h("button", { "aria-label": L.dec5, onclick: dec }, "−"),
        h("span", null, text),
        h("button", { "aria-label": L.inc5, onclick: inc }, "+")
      );
    }
    function clamp(v, a, b) {
      return v < a ? a : v > b ? b : v;
    }
    function upd(i, patch) {
      for (var k in patch) S.timers[i][k] = patch[k];
      render();
      preview();
    }

    // ---------- views ----------
    function viewStatus() {
      var st = S.st,
        cfg = S.cfg;
      if (!st) return h("div", { cls: "card" }, L.loading);
      var cur = st.cur ? tr(L.curUntil, title(st.cur.t), full(st.cur.e)) : L.none;
      var nx = st.next;
      var nextOn = !st.auto
        ? L.autoOff
        : st.on
          ? tr(L.onNowUntil, hm(st.on[1]))
          : st.nextOn
            ? full(st.nextOn[0]) + " · " + mm(Math.round((st.nextOn[1] - st.nextOn[0]) / 60))
            : L.noOnNext;
      var warn =
        st.end - st.now < 180 * 86400
          ? h("div", { cls: "warn" }, tr(L.tableEnds, day(st.end)))
          : null;
      return [
        !st.synced ? h("div", { cls: "warn" }, L.notSynced) : null,
        warn,
        st.manual
          ? h(
              "div",
              { cls: "warn col" },
              h("b", null, L.manualTitle),
              h("span", null, L.manualBody),
              h(
                "button",
                {
                  cls: "btn",
                  onclick: function () {
                    rpc("ShabbatSet", { resume: true }, load);
                  }
                },
                L.resume
              )
            )
          : null,
        h(
          "div",
          { cls: "card col" },
          h(
            "div",
            { cls: "kv" },
            h("span", { cls: "k" }, L.nowLabel),
            h("span", { cls: "v big" }, cur)
          ),
          h("hr"),
          h(
            "div",
            { cls: "kv" },
            h("span", { cls: "k" }, L.nextWin),
            h(
              "span",
              { cls: "v" },
              nx ? title(nx.t) + " · " + wdate(nx) + (cfg.skip === nx.s ? L.skippedParen : "") : "—"
            ),
            nx ? h("span", { cls: "s" }, full(nx.s) + L.arrow + full(nx.e)) : null
          ),
          h("hr"),
          h(
            "div",
            { cls: "kv" },
            h("span", { cls: "k" }, L.nextOn),
            h("span", { cls: "v" }, nextOn)
          )
        ),
        h(
          "div",
          { cls: "card rows" },
          h(
            "div",
            { cls: "row" },
            h("div", { cls: "col0" }, h("b", null, L.auto), h("span", { cls: "s" }, L.autoHint)),
            sw(st.auto, L.auto, function () {
              rpc("ShabbatSet", { auto: !st.auto }, load);
            })
          ),
          h("hr"),
          h(
            "div",
            { cls: "row" },
            h("div", { cls: "col0" }, h("b", null, L.skip), h("span", { cls: "s" }, L.skipHint)),
            sw(!!cfg.skip, L.skip, function () {
              rpc("ShabbatSet", { skip: !cfg.skip }, function (j) {
                load(j);
                preview();
              });
            })
          )
        ),
        h(
          "div",
          { cls: "card col" },
          h("label", { for: "tt" }, h("b", null, L.testTime)),
          h("span", { cls: "s" }, L.testHint),
          h(
            "div",
            { cls: "line" },
            h("input", {
              id: "tt",
              type: "datetime-local",
              value: st.test ? toLocalInput(st.test) : "",
              onchange: function (e) {
                if (e.target.value)
                  rpc("ShabbatSet", { test: fromLocalInput(e.target.value) }, load);
              }
            }),
            h(
              "button",
              {
                cls: "btn",
                onclick: function () {
                  rpc("ShabbatSet", { test: 0 }, load);
                }
              },
              L.clear
            )
          ),
          st.test ? h("div", { cls: "warn" }, tr(L.testActive, full(st.test))) : null
        ),
        viewLog(),
        viewDiag()
      ];
    }

    // ---------- relay event log (kept on the device) ----------
    function viewLog() {
      var ev = (S.log ? S.log.split(",") : [])
        .map(function (e) {
          var m = e.match(/^(\d+)([01])([a-z])$/);
          return m ? { t: +m[1] ? S.base + +m[1] * 60 : 0, on: m[2] === "1", c: m[3] } : null;
        })
        .filter(Boolean)
        .reverse();
      return h(
        "div",
        { cls: "card col" },
        h("b", null, L.log),
        h("span", { cls: "s" }, L.logHint),
        !ev.length
          ? h("span", { cls: "s" }, L.logEmpty)
          : ev.map(function (e) {
              return h(
                "div",
                { cls: "slot" + (e.on ? "" : " offev") },
                h("span", { cls: "tm" }, e.t ? hm(e.t) : "--:--"),
                h(
                  "span",
                  { cls: "grow" },
                  (e.t ? day(e.t) : L.timeUnknown) + " · " + (e.on ? L.turnedOn : L.turnedOff)
                ),
                h("span", { cls: "who" }, L.cause[e.c] || e.c)
              );
            })
      );
    }

    // ---------- diagnostics: firmware RPCs read by the browser (no script memory) ----------
    function viewDiag() {
      var d = S.diag;
      var box = h(
        "div",
        { cls: "card col" },
        h(
          "button",
          {
            cls: "tname",
            "aria-expanded": S.diagOpen ? "true" : "false",
            onclick: function () {
              S.diagOpen = !S.diagOpen;
              if (S.diagOpen) loadDiag();
              render();
            }
          },
          h("b", null, (S.diagOpen ? L.less : L.more) + L.tech)
        )
      );
      if (!S.diagOpen) return box;
      if (!d) {
        add(box, h("span", { cls: "s" }, L.loading));
        return box;
      }
      function up(sec) {
        var dd = Math.floor(sec / 86400),
          hh = Math.floor((sec % 86400) / 3600),
          mi = Math.floor((sec % 3600) / 60);
        return (dd ? tr(L.upDays, dd) : "") + tr(L.upHM, hh, mi);
      }
      function kb(n) {
        // LRI ... PDI keeps "94.7 KB" in that order inside Hebrew text
        var v = (n < 102400 ? (n / 1024).toFixed(1) : Math.round(n / 1024)) + " KB";
        return "\u2066" + v + "\u2069";
      }
      function pct(n, total) {
        return total ? Math.round((n * 100) / total) + "%" : "—";
      }
      // build time in Israel time, ISO-like: "2026-11-06 10:20"
      function stampTime(t) {
        if (!t) return "—";
        var p = parts(t);
        return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute;
      }
      function ofTotal(free, total) {
        return total ? tr(L.dOfFmt, kb(free), kb(total), pct(free, total)) : kb(free);
      }
      // mem_free is the free part of the JS pool shared by all running scripts; with only
      // the controller running (shabbat_ui never runs) used + free is the whole pool
      var pool = d.scr.mem_used + d.scr.mem_free;
      var rows = [
        [
          L.dVersion,
          d.ver === UI_VERSION || !d.ver ? UI_VERSION : tr(L.dVerBoth, d.ver, UI_VERSION)
        ],
        [
          L.dBuilt,
          !d.built || d.built === UI_BUILT
            ? stampTime(UI_BUILT)
            : tr(L.dVerBoth, stampTime(d.built), stampTime(UI_BUILT))
        ],
        [L.dDevice, d.info.model + " · " + d.info.id],
        [L.dFirmware, d.info.ver],
        [L.dUptime, up(d.sys.uptime)],
        [L.dLastSync, d.sys.last_sync_ts ? full(d.sys.last_sync_ts) : L.dNeverSynced],
        [L.dRamFree, ofTotal(d.sys.ram_free, d.sys.ram_size)],
        [L.dStorage, ofTotal(d.sys.fs_free, d.sys.fs_size)],
        [
          L.dScrMem,
          tr(
            L.dMemFmt,
            kb(d.scr.mem_used),
            pct(d.scr.mem_used, pool),
            kb(d.scr.mem_peak),
            pct(d.scr.mem_peak, pool),
            kb(d.scr.mem_free)
          )
        ],
        [L.dScrState, d.scr.running ? L.dRunning : L.dStopped],
        [L.dErrors, d.scr.error_msg || (d.scr.errors && d.scr.errors.join(", ")) || L.none],
        [L.dLastSrc, d.sw.source + (d.sw.tag ? " (" + d.sw.tag + ")" : "")],
        [L.dTemp, d.sw.temperature ? d.sw.temperature.tC + "°C" : "—"]
      ];
      add(
        box,
        rows.map(function (r) {
          return h(
            "div",
            { cls: "line sb drow" },
            h("span", { cls: "s" }, r[0]),
            h("span", { cls: "dv" }, String(r[1]))
          );
        })
      );
      add(
        box,
        h(
          "button",
          {
            cls: "btn",
            onclick: function () {
              S.diag = null;
              loadDiag();
              render();
            }
          },
          L.refresh
        )
      );
      return box;
    }
    function loadDiag() {
      function g(u) {
        return fetch(u).then(function (r) {
          return r.json();
        });
      }
      Promise.all([
        g("/rpc/Shelly.GetDeviceInfo"),
        g("/rpc/Sys.GetStatus"),
        g("/rpc/Script.GetStatus?id=" + ID),
        g("/rpc/Switch.GetStatus?id=0"),
        // the controller's version is in the first line of its code (no script memory used)
        g("/rpc/Script.GetCode?id=" + ID + "&offset=0&len=120")
      ])
        .then(function (r) {
          var first = (r[4].data || "").split("\n")[0];
          S.diag = {
            info: r[0],
            sys: r[1],
            scr: r[2],
            sw: r[3],
            ver: verLabel(first),
            built: builtAt(first)
          };
          render();
        })
        .catch(function (e) {
          S.err = tr(L.techErr, e.message);
          render();
        });
    }

    function viewTimers() {
      var list = S.timers.map(function (t, i) {
        var ed = S.editing === i,
          isC = t.a === 1;
        var ap = t.p === 1 ? L.shabbatOnly : t.p === 2 ? L.ytOnly : "";
        var nm, badge, sum;
        if (t.a === 0) {
          nm = L.afterCandles;
          badge = L.badgeCandles;
          sum = tr(L.startsAfter, mm(t.o), mm(t.d)) + ap;
        } else if (t.a === 2) {
          nm = L.beforeHavdalah;
          badge = L.badgeHavdalah;
          sum = tr(L.startsBefore, mm(-t.o), mm(t.d)) + ap;
        } else {
          nm = tr(L.atTime, hhmm(t.m));
          badge = L.badgeTime;
          sum = tr(L.daysOnFor, L.days[t.y], mm(t.d)) + ap;
        }
        if (t.d <= 0) sum = L.zeroDur;
        var lim = t.a === 2 ? [-180, 0] : [0, 180];
        var editor = !ed
          ? null
          : h(
              "div",
              { cls: "ed" },
              h("span", { cls: "lab" }, L.startPoint),
              pills(
                [
                  [0, L.anchors[0]],
                  [1, L.anchors[1]],
                  [2, L.anchors[2]]
                ],
                t.a,
                function (v) {
                  upd(i, { a: v, o: v === 2 ? -40 : 15 });
                }
              ),
              isC
                ? [
                    h("label", { cls: "lab", for: "tm" + i }, L.timeLabel),
                    h("input", {
                      id: "tm" + i,
                      type: "time",
                      value: hhmm(t.m),
                      onchange: function (e) {
                        var p = e.target.value.split(":");
                        if (p.length === 2) upd(i, { m: +p[0] * 60 + +p[1] });
                      }
                    })
                  ]
                : [
                    h("span", { cls: "lab" }, t.a === 2 ? L.minBefore : L.minAfter),
                    stepper(
                      mm(Math.abs(t.o)),
                      function () {
                        upd(i, { o: clamp(t.a === 2 ? t.o + 5 : t.o - 5, lim[0], lim[1]) });
                      },
                      function () {
                        upd(i, { o: clamp(t.a === 2 ? t.o - 5 : t.o + 5, lim[0], lim[1]) });
                      }
                    )
                  ],
              h("span", { cls: "lab" }, L.duration),
              stepper(
                mm(t.d),
                function () {
                  upd(i, { d: clamp(t.d - 5, 0, 240) });
                },
                function () {
                  upd(i, { d: clamp(t.d + 5, 0, 240) });
                }
              ),
              h("span", { cls: "lab" }, L.appliesTo),
              pills(
                [
                  [0, L.applies[0]],
                  [1, L.applies[1]],
                  [2, L.applies[2]]
                ],
                t.p,
                function (v) {
                  upd(i, { p: v });
                }
              ),
              isC
                ? [
                    h("span", { cls: "lab" }, L.whichDays),
                    pills(
                      [
                        [0, L.days[0]],
                        [1, L.days[1]],
                        [2, L.days[2]]
                      ],
                      t.y,
                      function (v) {
                        upd(i, { y: v });
                      }
                    ),
                    h("span", { cls: "s" }, L.daysHint)
                  ]
                : null,
              h(
                "div",
                { cls: "line sb" },
                h(
                  "button",
                  {
                    cls: "btn danger",
                    onclick: function () {
                      S.timers.splice(i, 1);
                      S.editing = -1;
                      render();
                      preview();
                    }
                  },
                  L.delTimer
                ),
                h(
                  "button",
                  {
                    cls: "btn pri",
                    onclick: function () {
                      S.editing = -1;
                      render();
                    }
                  },
                  L.done
                )
              )
            );
        return h(
          "div",
          { cls: "card t" + (ed ? " edit" : "") + (t.e ? "" : " off") },
          h(
            "div",
            { cls: "row" },
            h("span", { cls: "badge b" + t.a }, badge),
            h(
              "button",
              {
                cls: "tname",
                "aria-expanded": ed ? "true" : "false",
                onclick: function () {
                  S.editing = ed ? -1 : i;
                  render();
                }
              },
              h("b", null, nm),
              h("span", { cls: "s" }, sum)
            ),
            sw(t.e, tr(t.e ? L.disableT : L.enableT, nm), function () {
              upd(i, { e: !t.e });
            })
          ),
          editor
        );
      });
      return [
        h("span", { cls: "s" }, L.timersHint),
        list,
        S.timers.length < 12
          ? h(
              "button",
              {
                cls: "addbtn",
                onclick: function () {
                  S.timers.push({ a: 1, o: 15, m: 540, d: 30, p: 0, y: 0, e: true });
                  S.editing = S.timers.length - 1;
                  render();
                  preview();
                }
              },
              L.addTimer
            )
          : h("span", { cls: "s" }, L.maxTimers)
      ];
    }

    // ---------- full schedule: decoded in the browser from the controller's own code ----------
    // (Script.GetCode is served by the firmware: no memory cost for the controller)
    var A64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-";
    // A script's code via Script.GetCode in 4 KB pieces, up to 4 at a time - the same pattern
    // as the loader in main.js (fast, small memory spikes on the device). The built scripts are
    // ASCII, so offsets in bytes are offsets in characters.
    function readCode(id) {
      function piece(o) {
        return fetch("/rpc/Script.GetCode?id=" + id + "&len=4096&offset=" + o)
          .then(function (r) {
            return r.json();
          })
          .then(function (j) {
            if (j.data === undefined) throw new Error(j.message || "GetCode");
            return j;
          });
      }
      return piece(0).then(function (first) {
        var n = first.data.length + first.left,
          code = first.data,
          offs = [];
        for (var o = code.length; o < n; o += 4096) offs.push(o);
        function batch(i) {
          if (i >= offs.length) {
            if (code.length !== n) throw new Error("incomplete code");
            return code;
          }
          return Promise.all(offs.slice(i, i + 4).map(piece)).then(function (rs) {
            rs.forEach(function (r) {
              code += r.data;
            });
            return batch(i + 4);
          });
        }
        return batch(0);
      });
    }
    function loadTable() {
      if (S.tbl || S.tblLoading) return;
      S.tblLoading = true;
      readCode(ID)
        .then(function (code) {
          var b = code.match(/TBL_BASE\s*=\s*(\d+)/),
            t = code.match(/TBL_T\s*=\s*(\[[^\]]*\])/),
            d = code.match(/TBL\s*=\s*"([A-Za-z0-9+\-]*)"/);
          if (!b || !t || !d) throw new Error("table not found in controller code");
          var base = +b[1],
            titles = JSON.parse(t[1]),
            data = d[1],
            out = [];
          function dec(p, w) {
            var n = 0;
            for (var i = 0; i < w; i++) n = n * 64 + A64.indexOf(data.charAt(p + i));
            return n;
          }
          for (var p = 0; p + 8 <= data.length; p += 8) {
            var st = base + dec(p, 4) * 60,
              ti = titles[A64.indexOf(data.charAt(p + 7))];
            out.push({
              s: st,
              e: st + dec(p + 4, 3) * 60,
              t: ti,
              k: ti === "Shabbat" ? 1 : ti.indexOf("Shabbat") >= 0 ? 3 : 2
            });
          }
          S.tbl = out;
          S.tblLoading = false;
          render();
        })
        .catch(function (e) {
          S.tblErr = e.message;
          S.tblLoading = false;
          render();
        });
    }
    function dur(sec) {
      var h = Math.round(sec / 3600);
      return tr(L.hours, h);
    }
    function viewTable() {
      if (S.tblErr) return h("div", { cls: "warn" }, tr(L.tableErr, S.tblErr));
      if (!S.tbl) {
        loadTable();
        return h("div", { cls: "card" }, L.loading);
      }
      var now = (S.st && S.st.now) || Date.now() / 1000;
      var rows = S.tbl.filter(function (w) {
        return (S.tblPast || w.e > now) && (!S.tblHol || w.k !== 1);
      });
      var first = S.tbl[0],
        last = S.tbl[S.tbl.length - 1];
      var out = [
        h(
          "span",
          { cls: "s" },
          tr(
            L.tableSummary,
            S.tbl.length,
            day(first.s) + "/" + parts(first.s).year,
            day(last.e) + "/" + parts(last.e).year
          )
        ),
        h(
          "div",
          { cls: "pills two" },
          h(
            "button",
            {
              cls: "pill" + (S.tblHol ? "" : " sel"),
              "aria-pressed": S.tblHol ? "false" : "true",
              onclick: function () {
                S.tblHol = false;
                render();
              }
            },
            L.allWin
          ),
          h(
            "button",
            {
              cls: "pill" + (S.tblHol ? " sel" : ""),
              "aria-pressed": S.tblHol ? "true" : "false",
              onclick: function () {
                S.tblHol = true;
                render();
              }
            },
            L.holOnly
          )
        ),
        h(
          "div",
          { cls: "row" },
          h("div", { cls: "col0" }, h("b", null, L.showPast)),
          sw(S.tblPast, L.showPast, function () {
            S.tblPast = !S.tblPast;
            render();
          })
        )
      ];
      var year = "";
      var list = null;
      rows.forEach(function (w) {
        var y = parts(w.s).year;
        if (y !== year) {
          year = y;
          out.push(h("h2", { cls: "yr" }, y));
          list = h("div", { cls: "card tl" });
          out.push(list);
        }
        var cur = w.s <= now && now < w.e,
          skip = S.cfg && S.cfg.skip === w.s;
        list.appendChild(
          h(
            "div",
            { cls: "tr" + (cur ? " cur" : "") + (w.k !== 1 ? " hol" : "") },
            h(
              "div",
              { cls: "col0 grow" },
              h(
                "b",
                null,
                title(w.t) + " · " + wdate(w) + (cur ? L.nowTag : "") + (skip ? L.skipTag : "")
              ),
              h("span", { cls: "s" }, full(w.s) + L.arrow + full(w.e))
            ),
            h("span", { cls: "s nowrap" }, dur(w.e - w.s))
          )
        );
      });
      if (!rows.length) out.push(h("span", { cls: "s" }, L.noRows));
      return out;
    }

    function viewPreview() {
      if (!S.prev) return h("div", { cls: "card" }, L.loading);
      return [
        h("span", { cls: "s" }, L.pvHint),
        S.prev.map(function (w) {
          return h(
            "div",
            { cls: "card col" },
            h(
              "div",
              { cls: "line sb" },
              h("b", null, title(w.t) + " · " + wdate(w)),
              h("span", { cls: "s" }, L.kind[w.k])
            ),
            h("span", { cls: "s" }, full(w.s) + L.arrow + full(w.e)),
            w.skip ? h("div", { cls: "warn" }, L.pvSkipped) : null,
            !w.skip && !w.on.length ? h("span", { cls: "s" }, L.pvNone) : null,
            w.on.map(function (o) {
              var names = o[2].split("+").map(function (n) {
                var t = S.timers[+n - 1];
                return !t
                  ? "#" + n
                  : t.a === 0
                    ? L.badgeCandles
                    : t.a === 2
                      ? L.badgeHavdalah
                      : hhmm(t.m);
              });
              return h(
                "div",
                { cls: "slot" },
                h("span", { cls: "tm" }, hm(o[0]) + "–" + hm(o[1])),
                h("span", { cls: "grow" }, day(o[0]) + " · " + mm(Math.round((o[1] - o[0]) / 60))),
                h("span", { cls: "who" }, names.join(" + "))
              );
            })
          );
        })
      ];
    }

    // ---------- render ----------
    var root = document.getElementById("app");
    function render() {
      var st = S.st;
      var tabs = [
        ["status", L.tabs[0]],
        ["timers", L.tabs[1]],
        ["preview", L.tabs[2]],
        ["table", L.tabs[3]]
      ];
      var relay = !st ? "…" : (st.relay ? L.relayOn : L.relayOff) + (st.test ? L.testTag : "");
      var body =
        S.tab === "status"
          ? viewStatus()
          : S.tab === "timers"
            ? viewTimers()
            : S.tab === "preview"
              ? viewPreview()
              : viewTable();
      var d = dirty();
      var app = h(
        "div",
        { cls: "app" },
        h(
          "header",
          null,
          h(
            "div",
            { cls: "line sb" },
            h(
              "div",
              { cls: "col0" },
              h("h1", null, L.appTitle),
              h("span", { cls: "s" }, tr(L.scriptN, ID))
            ),
            h(
              "div",
              { cls: "line" },
              h(
                "button",
                {
                  cls: "lang",
                  lang: LANG === "he" ? "en" : "he",
                  onclick: function () {
                    setLang(LANG === "he" ? "en" : "he", true);
                    render();
                  }
                },
                L.langBtn
              ),
              h("span", { cls: "relay" + (st && st.relay ? " on" : "") }, relay)
            )
          ),
          h(
            "div",
            { cls: "tabs", role: "tablist" },
            tabs.map(function (t) {
              return h(
                "button",
                {
                  role: "tab",
                  "aria-selected": S.tab === t[0] ? "true" : "false",
                  cls: S.tab === t[0] ? "sel" : "",
                  onclick: function () {
                    S.tab = t[0];
                    if (t[0] === "preview") preview();
                    render();
                  }
                },
                t[1]
              );
            })
          )
        ),
        S.err ? h("div", { cls: "warn m" }, tr(L.error, S.err)) : null,
        h("main", null, body),
        d
          ? h(
              "div",
              { cls: "bar" },
              h("span", null, L.unsaved),
              h(
                "div",
                { cls: "line" },
                h(
                  "button",
                  {
                    cls: "btn ghost",
                    onclick: function () {
                      S.timers = JSON.parse(S.saved).map(toObj);
                      S.editing = -1;
                      render();
                      preview();
                    }
                  },
                  L.discard
                ),
                h(
                  "button",
                  {
                    cls: "btn pri",
                    onclick: function () {
                      rpc("ShabbatSet", { timers: draft() }, function (j) {
                        S.saved = JSON.stringify(j.cfg.timers);
                        S.editing = -1;
                        S.flash = L.saved;
                        load(j);
                        preview();
                        setTimeout(function () {
                          S.flash = "";
                          render();
                        }, 2500);
                      });
                    }
                  },
                  L.save
                )
              )
            )
          : S.flash
            ? h("div", { cls: "bar ok", role: "status" }, S.flash)
            : null
      );
      var y = window.scrollY;
      root.replaceChildren(app);
      window.scrollTo(0, y);
    }

    // Readable here; tools/build.mjs squeezes the whitespace out of this template.
    var css = `
      body { margin: 0; background: #F3F5F8; color: #16202A; font-family: Heebo,system-ui,-apple-system,'Segoe UI',Arial,sans-serif }
      .app { max-width: 560px; margin: 0 auto; min-height: 100vh; display: flex; flex-direction: column }
      header { background: #fff; border-bottom: 1px solid #E2E6EC; padding: 16px; display: flex; flex-direction: column; gap: 12px; position: sticky; top: 0; z-index: 2 }
      h1 { margin: 0; font-size: 20px }
      main { flex: 1; padding: 16px 16px 96px; display: flex; flex-direction: column; gap: 12px }
      .s { font-size: 13px; color: #4B5563 }
      .line { display: flex; gap: 8px; align-items: center }
      .sb { justify-content: space-between }
      .col0 { display: flex; flex-direction: column; gap: 2px; min-width: 0 }
      .relay { font-size: 13px; font-weight: 500; border-radius: 999px; padding: 6px 12px; background: #EEF1F5; color: #374151; white-space: nowrap }
      .relay.on { background: #0F5132; color: #fff }
      .lang { font: inherit; font-size: 13px; height: 32px; padding: 0 10px; border: 1px solid #C9D0DA; border-radius: 999px; background: #fff; color: #1D4ED8; cursor: pointer; white-space: nowrap }
      .tabs { display: grid; grid-template-columns: repeat(4,1fr); gap: 4px; background: #EEF1F5; border-radius: 10px; padding: 4px }
      .tabs button { height: 38px; border: 0; border-radius: 8px; background: transparent; font: inherit; font-size: 13px; font-weight: 500; color: #374151; cursor: pointer; padding: 0 2px }
      .tabs .sel { background: #fff; color: #16202A; font-weight: 700; box-shadow: 0 1px 2px rgba(22,32,42,.15) }
      .card { background: #fff; border: 1px solid #E2E6EC; border-radius: 14px; padding: 14px }
      .col { display: flex; flex-direction: column; gap: 8px }
      .rows { padding: 2px 14px }
      .kv { display: flex; flex-direction: column; gap: 2px }
      .k { font-size: 13px; color: #4B5563 }
      .v { font-size: 16px; font-weight: 500 }
      .big { font-size: 18px; font-weight: 700 }
      hr { border: 0; border-top: 1px solid #E2E6EC; margin: 4px 0; width: 100% }
      .row { display: flex; align-items: center; gap: 12px; min-height: 56px }
      .row .col0 { flex: 1 }
      /* physical direction: knob on the right = on, in both languages */
      .sw { width: 52px; height: 32px; flex-shrink: 0; border-radius: 16px; border: 0; padding: 3px; cursor: pointer; display: flex; direction: ltr; justify-content: flex-start; align-items: center; background: #AEB7C4 }
      .sw.on { justify-content: flex-end; background: #1D4ED8 }
      .sw span { width: 26px; height: 26px; border-radius: 13px; background: #fff; display: block }
      input { font: inherit; font-size: 16px; height: 44px; box-sizing: border-box; border: 1px solid #C9D0DA; border-radius: 10px; padding: 0 10px; background: #fff; color: #16202A }
      #tt { flex: 1; min-width: 0 }
      .btn { font: inherit; height: 44px; padding: 0 16px; border: 1px solid #C9D0DA; border-radius: 10px; background: #fff; color: #16202A; font-size: 14px; cursor: pointer }
      .btn.pri { background: #1D4ED8; border-color: #1D4ED8; color: #fff; font-weight: 500 }
      .btn.danger { border-color: #F1C4C4; color: #B42318 }
      .btn.ghost { background: transparent; color: #fff; border-color: #5B6675 }
      .warn { font-size: 13px; color: #92400E; background: #FEF3C7; border-radius: 8px; padding: 8px 10px }
      .m { margin: 12px 16px 0 }
      .t { padding: 0 }
      .t>.row { padding: 10px 14px }
      .t.edit { border-color: #1D4ED8 }
      .t.off { opacity: .65 }
      .badge { flex-shrink: 0; min-width: 52px; text-align: center; font-size: 12px; font-weight: 700; border-radius: 8px; padding: 6px 8px }
      .b0 { background: #FFF4E5; color: #8A4B00 }
      .b1 { background: #E6F0FF; color: #1E3A8A }
      .b2 { background: #EFEAFE; color: #4C2A9E }
      .tname { flex: 1; min-width: 0; text-align: start; background: none; border: 0; padding: 4px 0; cursor: pointer; display: flex; flex-direction: column; gap: 2px; font: inherit; color: #16202A }
      .ed { border-top: 1px solid #E2E6EC; padding: 14px; display: flex; flex-direction: column; gap: 8px; background: #FAFBFC; border-radius: 0 0 14px 14px }
      .lab { font-size: 13px; font-weight: 500; color: #374151; margin-top: 4px }
      .pills { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px }
      .pill { font: inherit; height: 40px; border: 1px solid #C9D0DA; border-radius: 10px; background: #fff; color: #16202A; font-size: 14px; cursor: pointer }
      .pill.sel { background: #1D4ED8; border-color: #1D4ED8; color: #fff; font-weight: 500 }
      .step { display: flex; align-items: center; gap: 8px }
      .step button { width: 44px; height: 44px; border: 1px solid #C9D0DA; border-radius: 10px; background: #fff; font-size: 20px; color: #16202A; cursor: pointer }
      .step span { min-width: 88px; text-align: center; font-size: 16px; font-weight: 500 }
      .addbtn { font: inherit; height: 48px; border: 1.5px dashed #9AA5B4; border-radius: 14px; background: transparent; color: #1D4ED8; font-size: 15px; font-weight: 500; cursor: pointer }
      .slot { display: flex; align-items: center; gap: 10px; background: #EEF4FF; border-radius: 8px; padding: 8px 10px; font-size: 13px }
      .slot .tm { font-size: 14px; font-weight: 500; color: #1E3A8A; direction: ltr; unicode-bidi: isolate }
      .slot .grow { flex: 1; color: #374151 }
      .slot .who { font-size: 12px; color: #1E3A8A }
      .bar { position: fixed; bottom: 0; left: 0; right: 0; max-width: 560px; margin: 0 auto; box-sizing: border-box; background: #16202A; color: #fff; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 14px }
      .bar.ok { background: #0F5132 }
      .pills.two { grid-template-columns: repeat(2,1fr) }
      .yr { font-size: 15px; margin: 8px 4px 0; color: #374151 }
      .tl { padding: 0 14px }
      .tr { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid #EEF1F5 }
      .tr:first-child { border-top: 0 }
      .tr .grow { flex: 1 }
      .tr b { font-size: 14px; font-weight: 500 }
      .tr.hol b { color: #4C2A9E; font-weight: 700 }
      .tr.cur { background: #EEF4FF; margin: 0 -14px; padding: 10px 14px }
      .nowrap { white-space: nowrap }
      .slot.offev { background: #F3F4F6 }
      .slot.offev .tm { color: #374151 }
      .drow { padding: 4px 0; border-top: 1px solid #EEF1F5 }
      .dv { font-size: 13px; text-align: end; unicode-bidi: isolate; overflow-wrap: anywhere }
      .warn.col { display: flex; flex-direction: column; gap: 6px }
      button:focus-visible, input:focus-visible { outline: 2px solid #1D4ED8; outline-offset: 2px }
    `;
    document.head.appendChild(h("style", null, css));
    render();
    refresh();
    preview();
    setInterval(refresh, 15000);
  })();
