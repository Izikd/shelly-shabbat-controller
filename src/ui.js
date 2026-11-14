// SPDX-License-Identifier: MIT
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
    // times are shown in the time zone of the place the table was computed for (st.tz)
    var ID = window.SE_ID,
      TZ = "";
    // schedule service for the public page (service/ in this repository); a page created on
    // a device keeps the address it was created with (stored on the device)
    var PUB_URL = "https://shabbat-schedule.izikdd.workers.dev";
    var S = {
      tab: "status",
      timers: [],
      saved: '{"timers":[],"reps":[]}',
      editing: -1,
      cfg: null,
      st: null,
      prev: null,
      err: "",
      flash: "",
      tbl: null,
      tblErr: "",
      tblHol: false,
      tblPast: false,
      pub: null, // publishing state from the device (ShabbatPub)
      pubName: null, // page name typed / loaded from the service
      pubBusy: false,
      pubErr: "",
      copied: false
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
        tableEnds: "הזמנים מסתיימים ב-{0} – בחר שוב מיקום כדי להאריך אותם",
        loc: "מיקום",
        locNone: "לא נבחר מיקום – הממסר לא יופעל עד שתבחר מיקום.",
        locInfo: "{0} · זמנים עד {1}",
        locHm: "במקום הזה אין בקיץ צאת הכוכבים: ההבדלה חושבה {0} דקות אחרי השקיעה.",
        locSet: "בחר מיקום",
        locChange: "שנה מיקום",
        locHint: "הזמנים מחושבים בדפדפן עם hebcal, שנטען מהאינטרנט רק בלחיצה.",
        locLoading: "טוען את hebcal…",
        locLoadErr: "לא ניתן לטעון את hebcal: {0}",
        locSearch: "חיפוש עיר (שמות באנגלית)",
        locOr: "או קואורדינטות ואזור זמן:",
        locLat: "קו רוחב",
        locLon: "קו אורך",
        locTz: "אזור זמן",
        locIl: "ישראל (יום טוב אחד)",
        locSave: "שמור מיקום",
        cancel: "ביטול",
        locBad: "קואורדינטות לא תקינות",
        locCalc: "מחשב זמנים…",
        locSaving: "שומר במכשיר… {0}%",
        locDone: "המיקום נשמר ✓",
        locFail: "שמירת המיקום נכשלה: {0}",
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
        testHint: "מדמה שעה אחרת (לפי שעון המיקום) כדי לבדוק את הממסר. לא נשמר אחרי הפעלה מחדש.",
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
        upd: "עדכון תוכנה",
        updHint: "בדיקה ב-GitHub, רק בלחיצה.",
        updCheck: "בדוק עדכונים",
        updChecking: "בודק…",
        updCurrent: "מותקנת הגרסה האחרונה ({0}).",
        updNewer: "גרסה {0} זמינה (מותקנת {1}).",
        updDev: "גרסת פיתוח ({0}). אחרונה: {1}.",
        updNotes: "מה חדש",
        updInstall: "התקן {0}",
        updConfirm: "להתקין את {0}? הבקר יופעל מחדש לכמה שניות; ההגדרות נשמרות.",
        updInWindow: "שים לב: חלון שבת / יו״ט פעיל עכשיו.",
        updUi: "מתקין את דף ההגדרות… {0}%",
        updCtrl: "מתקין את הבקר… {0}%",
        updRestart: "מפעיל מחדש את הבקר…",
        updDone: "העדכון הותקן ✓ טוען מחדש…",
        updFailed: "העדכון נכשל: {0}.",
        updRestored: " הגרסה הקודמת הוחזרה ופועלת.",
        updStopped: " הבקר עצור - הפעל אותו בדף הסקריפטים.",
        updCheckFailed: "לא ניתן לבדוק: {0}",
        updMismatch: "נסה שוב בעוד כמה דקות",
        updBadFile: "קובץ לא תקין מהשרת",
        updVerify: "אימות נכשל",
        updBeta: "גרסאות בטא",
        updBetaHint: "להציע גם גרסאות ניסיון",
        updOnBeta: "מותקנת גרסת בטא ({0}). תוצע הגרסה היציבה הבאה כשתהיה חדשה ממנה.",
        updStable: "התקן גרסה יציבה {0}",
        updDowngrade:
          "להתקין את {0}? היא ישנה מהגרסה המותקנת. ההגדרות נשמרות, אלא אם בהערות של גרסת הבטא כתוב שמבנה ההגדרות השתנה - אז הטיימרים עלולים לחזור לברירת המחדל.",
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
        repeat: "חזרה",
        repOpts: ["פעם אחת", "חוזר"],
        every: "כל",
        forLen: "למשך",
        repSum: " · כל {0} למשך {1}",
        pulseEvery: "{0} כל {1}",
        hrs: "{0} שע׳",
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
        tabs: ["מצב", "טיימרים", "לוח זמנים", "הגדרות"],
        pvTitle: "ההפעלות הקרובות",
        showAll: "הצג את כל השנים ({0} חלונות נוספים)",
        relayOn: "ממסר: פועל",
        relayOff: "ממסר: כבוי",
        testTag: " · בדיקה",
        scriptN: "Shelly · סקריפט {0}",
        error: "שגיאה: {0}",
        unsaved: "יש שינויים שלא נשמרו",
        discard: "בטל",
        saved: "נשמר במכשיר ✓",
        save: "שמור במכשיר",
        pub: "פרסום לוח הזמנים",
        pubHint:
          "דף לקריאה בלבד עם זמני ההפעלה בשבתות ובחגים הקרובים, לשיתוף עם אחרים. המכשיר שולח את הזמנים ל-{0} פעם ביום ואחרי כל שינוי.",
        pubName: "שם הדף",
        pubNamePh: "למשל: מעלית בניין הרצל 5",
        pubCreate: "צור דף",
        pubWait: "רגע…",
        pubLink: "הקישור לשיתוף",
        pubCopy: "העתק",
        pubCopied: "הועתק ✓",
        pubLast: "נשלח לאחרונה: {0}",
        pubNever: "עוד לא נשלח",
        pubFail: "השליחה האחרונה נכשלה ({0}). המכשיר ינסה שוב אוטומטית.",
        pubSend: "שלח עכשיו",
        pubRename: "שמור שם",
        pubStop: "הפסק פרסום",
        pubStopQ: "להפסיק את הפרסום ולמחוק את הדף? הקישור יפסיק לעבוד.",
        pubNet: "אין חיבור לשירות הפרסום: {0}"
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
        tableEnds: "The times end on {0} – set the location again to extend them",
        loc: "Location",
        locNone: "No location set – the relay will not switch until you set one.",
        locInfo: "{0} · times until {1}",
        locHm: "No nightfall here in summer: havdalah is {0} minutes after sunset.",
        locSet: "Set location",
        locChange: "Change location",
        locHint:
          "Times are computed in the browser with hebcal, loaded from the internet only when pressed.",
        locLoading: "Loading hebcal…",
        locLoadErr: "Cannot load hebcal: {0}",
        locSearch: "Search a city",
        locOr: "Or coordinates and time zone:",
        locLat: "Latitude",
        locLon: "Longitude",
        locTz: "Time zone",
        locIl: "Israel (one-day Yom Tov)",
        locSave: "Save location",
        cancel: "Cancel",
        locBad: "Invalid coordinates",
        locCalc: "Calculating times…",
        locSaving: "Saving to the device… {0}%",
        locDone: "Location saved ✓",
        locFail: "Saving the location failed: {0}",
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
        testHint:
          "Simulates another time (the location's time) to check the relay. Cleared on restart.",
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
        upd: "Software update",
        updHint: "Asks GitHub, only when pressed.",
        updCheck: "Check for updates",
        updChecking: "Checking…",
        updCurrent: "The latest version is installed ({0}).",
        updNewer: "Version {0} is available (installed: {1}).",
        updDev: "Development build ({0}). Latest: {1}.",
        updNotes: "What's new",
        updInstall: "Install {0}",
        updConfirm: "Install {0}? The controller restarts for a few seconds; settings are kept.",
        updInWindow: "Note: a Shabbat / Yom Tov window is active now.",
        updUi: "Installing the settings page… {0}%",
        updCtrl: "Installing the controller… {0}%",
        updRestart: "Restarting the controller…",
        updDone: "Update installed ✓ Reloading…",
        updFailed: "Update failed: {0}.",
        updRestored: " The previous version was restored and is running.",
        updStopped: " The controller is stopped - start it on the Scripts page.",
        updCheckFailed: "Could not check: {0}",
        updMismatch: "try again in a few minutes",
        updBadFile: "invalid file from the server",
        updVerify: "verification failed",
        updBeta: "Beta versions",
        updBetaHint: "Also offer test releases",
        updOnBeta:
          "Beta {0} is installed. You'll be offered the next stable release once it's newer.",
        updStable: "Install stable {0}",
        updDowngrade:
          "Install {0}? It is older than the installed version. Settings are kept unless the beta's release notes say the settings format changed; then the timers may reset to the defaults.",
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
        repeat: "Repeat",
        repOpts: ["Once", "Repeats"],
        every: "Every",
        forLen: "For",
        repSum: " · every {0} for {1}",
        pulseEvery: "{0} every {1}",
        hrs: "{0} h",
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
        tabs: ["Status", "Timers", "Schedule", "Settings"],
        pvTitle: "Coming relay times",
        showAll: "Show all years ({0} more windows)",
        relayOn: "Relay: on",
        relayOff: "Relay: off",
        testTag: " · test",
        scriptN: "Shelly · script {0}",
        error: "Error: {0}",
        unsaved: "Unsaved changes",
        discard: "Discard",
        saved: "Saved to device ✓",
        save: "Save to device",
        pub: "Public schedule page",
        pubHint:
          "A read-only page with the on times for the coming Shabbatot and holidays, to share with others. The device sends the times to {0} once a day and after every change.",
        pubName: "Page name",
        pubNamePh: "e.g. Herzl 5 elevator",
        pubCreate: "Create page",
        pubWait: "One moment…",
        pubLink: "Link to share",
        pubCopy: "Copy",
        pubCopied: "Copied ✓",
        pubLast: "Last sent: {0}",
        pubNever: "Not sent yet",
        pubFail: "The last send failed ({0}). The device will retry automatically.",
        pubSend: "Send now",
        pubRename: "Save name",
        pubStop: "Stop publishing",
        pubStopQ: "Stop publishing and delete the page? The link will stop working.",
        pubNet: "Cannot reach the publishing service: {0}"
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

    // ---------- requests to the device ----------
    // The device accepts only a few connections at a time, shared by every open page, app and
    // tab (docs/device/network.md), so at most 2 of this page's requests are in flight; the
    // rest wait in a queue. With retry, a request that fails ("Failed to fetch", or a proxy's
    // error page instead of the device's JSON) is tried again up to 3 times: only for
    // requests that are safe to repeat (not code uploads, which manage their own retries).
    var inFlight = 0,
      waiting = [];
    function nextReq() {
      if (inFlight < 2 && waiting.length) {
        inFlight++;
        waiting.shift()();
      }
    }
    function dev(url, opts, retry) {
      return new Promise(function (ok, no) {
        function attempt(a) {
          fetch(url, opts)
            .then(function (r) {
              return r.text().then(function (t) {
                // not the device's answer (a proxy's error page): like a lost connection
                if (t.charAt(0) !== "{") throw new TypeError("HTTP " + r.status);
                return JSON.parse(t);
              });
            })
            .then(
              function (j) {
                inFlight--;
                nextReq();
                ok(j);
              },
              function (e) {
                if (retry && a < 3)
                  return setTimeout(
                    function () {
                      attempt(a + 1);
                    },
                    300 + 500 * a
                  );
                inFlight--;
                nextReq();
                no(e);
              }
            );
        }
        waiting.push(function () {
          attempt(0);
        });
        nextReq();
      });
    }

    // ---------- RPC ----------
    function rpc(method, params, cb) {
      params = params || {};
      params.id = ID;
      // the Shabbat* calls set absolute values, so repeating one is harmless
      dev("/rpc/Script." + method, { method: "POST", body: JSON.stringify(params) }, true)
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
    // a repeating timer is stored disabled (older releases leave it off); its on/off is in reps
    function toArr(t) {
      return [t.a, t.a === 1 ? t.m : t.o, t.d, t.p, t.y, t.e && !t.r ? 1 : 0];
    }
    function toObj(v, p) {
      return {
        r: p ? [p[0], p[1]] : 0,
        a: v[0],
        o: v[0] === 1 ? (v[0] === 2 ? -40 : 15) : v[1],
        m: v[0] === 1 ? v[1] : 720,
        d: v[2],
        p: v[3],
        y: v[4],
        e: !!(p ? p[2] : v[5])
      };
    }
    function fromCfg(c) {
      return c.timers.map(function (v, i) {
        return toObj(v, (c.reps || [])[i]);
      });
    }
    function draft() {
      var any = false;
      var reps = S.timers.map(function (t) {
        if (t.r) any = true;
        return t.r ? [t.r[0], t.r[1], t.e ? 1 : 0] : 0;
      });
      return { timers: S.timers.map(toArr), reps: any ? reps : [] };
    }
    // quiet: the reply matches the last one (apart from the clock), so the page stays as it is;
    // rebuilding it every 15 s re-created every row of the Schedule tab for nothing
    function load(j, quiet) {
      S.cfg = j.cfg;
      S.st = j.st;
      S.log = j.log || "";
      S.base = j.base;
      if (S.did !== j.did) S.tbl = null; // another table: read it again
      S.did = j.did;
      setTz(j.st.tz);
      if (!dirty()) {
        S.timers = fromCfg(j.cfg);
        S.saved = JSON.stringify(draft());
      }
      if (S.tab === "timers" && !S.prev) preview(); // opened on Timers (#timers)
      if (!quiet) render();
    }
    // the status reply without the device's clock (st.now changes on every reply)
    var lastGet = "";
    function same(j) {
      var now = j.st.now;
      j.st.now = 0;
      var k = JSON.stringify(j);
      j.st.now = now;
      var was = lastGet;
      lastGet = k;
      return k === was;
    }
    function dirty() {
      return JSON.stringify(draft()) !== S.saved;
    }
    var pvTimer = null,
      pvSeq = 0;
    function preview() {
      if (!S.cfg) return; // the timers are not known yet: load() asks once they are
      clearTimeout(pvTimer);
      pvTimer = setTimeout(function () {
        // 6 windows in two requests of 3: 6 at once with repeating timers ran the controller out
        // of memory (docs/device/memory.md)
        var d = draft(),
          my = ++pvSeq;
        d.n = 3;
        rpc("ShabbatPreview", d, function (j) {
          if (my !== pvSeq) return;
          if (j.w.length < 3) {
            S.prev = j.w;
            render();
            return;
          }
          d.from = j.w[2].e;
          rpc("ShabbatPreview", d, function (k) {
            if (my !== pvSeq) return;
            S.prev = j.w.concat(k.w);
            render();
          });
        });
      }, 250);
    }
    function refresh() {
      if (S.upd && S.upd.busy) return; // the controller may be stopped for its upload
      // the first status was already requested by the loader, in parallel with this code
      var first = window.SE_FIRST;
      if (first) {
        window.SE_FIRST = null;
        first
          .then(function (j) {
            if (j && j.cfg) {
              S.err = "";
              same(j);
              load(j);
            } else refresh();
          })
          .catch(refresh);
        return;
      }
      var err = S.err; // an error on screen goes away with the next good reply
      rpc("ShabbatGet", {}, function (j) {
        load(j, same(j) && !err);
      });
    }

    // ---------- time formatting (time zone of the place; the browser's before one is set) ----------
    var DF, HDF;
    function setTz(tz) {
      tz = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz === TZ) return;
      TZ = tz;
      DF = new Intl.DateTimeFormat("en-GB", {
        timeZone: TZ,
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      });
      // Hebrew-calendar date from the browser's built-in Hebrew calendar:
      // Hebrew "כ״ז בחשוון" (day in Hebrew numerals), English "27 Heshvan"
      HDF = {};
      ["he", "en"].forEach(function (l) {
        HDF[l] = new Intl.DateTimeFormat(l + "-u-ca-hebrew", {
          timeZone: TZ,
          day: "numeric",
          month: "long"
        });
      });
    }
    setTz("");
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
      // "YYYY-MM-DDTHH:MM" in the place's time -> UTC seconds
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
    function hmn(n) {
      return n % 60 ? mm(n) : tr(L.hrs, n / 60);
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
        st.end && st.end - st.now < 365 * 86400
          ? h("div", { cls: "warn" }, tr(L.tableEnds, day(st.end) + "/" + parts(st.end).year))
          : null;
      return [
        !st.synced ? h("div", { cls: "warn" }, L.notSynced) : null,
        warn,
        // on top until a place is set, then below the daily controls
        st.loc ? null : viewLoc(),
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
        // a test time on is shown here too: the relay follows it
        st.test ? h("div", { cls: "warn" }, tr(L.testActive, full(st.test))) : null,
        viewLog()
      ];
    }
    function viewTest(st) {
      return h(
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
              if (e.target.value) rpc("ShabbatSet", { test: fromLocalInput(e.target.value) }, load);
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
      );
    }
    // set up once: place, test time, public page, updates, technical info
    function viewSettings() {
      var st = S.st;
      if (!st) return h("div", { cls: "card" }, L.loading);
      return [viewLoc(), viewTest(st), viewPub(), viewUpdate(), viewDiag()];
    }

    // ---------- public schedule page (service/; the device sends, the browser sets it up) ----------
    function svc(base, method, path, body, key) {
      var o = { method: method, headers: {} };
      if (body) {
        o.headers["Content-Type"] = "application/json";
        o.body = JSON.stringify(body);
      }
      if (key) o.headers.Authorization = "Bearer " + key;
      return fetch(base + path, o).then(function (r) {
        if (r.status === 204) return {};
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
          return j;
        });
      });
    }
    function pubFail(e) {
      S.pubBusy = false;
      S.pubErr = tr(L.pubNet, e.message);
      render();
    }
    function loadPub() {
      rpc("ShabbatPub", {}, function (j) {
        S.pub = j;
        if (j.on && S.pubName === null) {
          S.pubName = "";
          svc(j.u, "GET", "/s/" + j.i + ".json")
            .then(function (d) {
              S.pubName = d.name || "";
              render();
            })
            .catch(function () {});
        }
        render();
      });
    }
    function pubCreate() {
      S.pubBusy = true;
      S.pubErr = "";
      render();
      svc(PUB_URL, "POST", "/api/register", { name: S.pubName || "" })
        .then(function (r) {
          rpc("ShabbatPub", { u: PUB_URL, i: r.id, k: r.key }, function (j) {
            S.pubBusy = false;
            S.pub = j;
            render();
            setTimeout(loadPub, 3000); // the first send takes a moment
          });
        })
        .catch(pubFail);
    }
    function pubRename() {
      var p = S.pub;
      S.pubBusy = true;
      S.pubErr = "";
      render();
      svc(p.u, "PUT", "/api/s/" + p.i + "/name", { name: S.pubName || "" }, p.k)
        .then(function () {
          S.pubBusy = false;
          S.flash = L.saved;
          render();
          setTimeout(function () {
            S.flash = "";
            render();
          }, 2500);
        })
        .catch(pubFail);
    }
    function pubStop() {
      var p = S.pub;
      if (!confirm(L.pubStopQ)) return;
      S.pubBusy = true;
      S.pubErr = "";
      render();
      // the device stops even if the service cannot be reached (it deletes unused pages later)
      svc(p.u, "DELETE", "/api/s/" + p.i, null, p.k)
        .catch(function (e) {
          S.pubErr = tr(L.pubNet, e.message);
        })
        .then(function () {
          rpc("ShabbatPub", { off: true }, function (j) {
            S.pubBusy = false;
            S.pub = j;
            S.pubName = null;
            render();
          });
        });
    }
    function copyLink(link) {
      function done() {
        S.copied = true;
        render();
        setTimeout(function () {
          S.copied = false;
          render();
        }, 2000);
      }
      // the clipboard API needs https; the device page is usually http
      if (navigator.clipboard && window.isSecureContext)
        return navigator.clipboard.writeText(link).then(done);
      var el = document.getElementById("plink");
      el.select();
      if (document.execCommand("copy")) done();
    }
    function viewPub() {
      var p = S.pub;
      var box = h(
        "div",
        { cls: "card col" },
        h("b", null, L.pub),
        h(
          "span",
          { cls: "s" },
          tr(
            L.pubHint,
            // LRI ... PDI keeps the address in one piece inside Hebrew text
            "\u2066" + (p && p.on ? p.u : PUB_URL).replace(/^https?:\/\//, "") + "\u2069"
          )
        )
      );
      if (!p) return box;
      if (S.pubErr) add(box, h("div", { cls: "warn" }, S.pubErr));
      var name = [
        h("label", { cls: "lab", for: "pn" }, L.pubName),
        h("input", {
          id: "pn",
          maxlength: 60,
          placeholder: L.pubNamePh,
          value: S.pubName || "",
          oninput: function (e) {
            S.pubName = e.target.value;
          }
        })
      ];
      if (!p.on) {
        add(box, [
          name,
          h(
            "button",
            { cls: "btn pri", disabled: S.pubBusy, onclick: pubCreate },
            S.pubBusy ? L.pubWait : L.pubCreate
          )
        ]);
        return box;
      }
      var link = p.u + "/s/" + p.i;
      add(box, [
        h("span", { cls: "lab" }, L.pubLink),
        h(
          "div",
          { cls: "line" },
          h("input", { id: "plink", cls: "grow", readonly: true, dir: "ltr", value: link }),
          h(
            "button",
            {
              cls: "btn",
              onclick: function () {
                copyLink(link);
              }
            },
            S.copied ? L.pubCopied : L.pubCopy
          )
        ),
        h(
          "a",
          { href: link, target: "_blank", rel: "noopener", cls: "qr" },
          h("img", { src: link + "/qr.svg", alt: link, width: 168, height: 168 })
        ),
        h("span", { cls: "s" }, p.ok ? tr(L.pubLast, full(p.ok)) : L.pubNever),
        p.err ? h("div", { cls: "warn" }, tr(L.pubFail, p.err)) : null,
        name,
        h(
          "div",
          { cls: "line wrap" },
          h("button", { cls: "btn", disabled: S.pubBusy, onclick: pubRename }, L.pubRename),
          h(
            "button",
            {
              cls: "btn",
              disabled: S.pubBusy,
              onclick: function () {
                rpc("ShabbatPub", { send: true }, function (j) {
                  S.pub = j;
                  render();
                  setTimeout(loadPub, 3000);
                });
              }
            },
            L.pubSend
          ),
          h("button", { cls: "btn danger", disabled: S.pubBusy, onclick: pubStop }, L.pubStop)
        )
      ]);
      return box;
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
      // build time in the place's time, ISO-like: "2026-11-06 10:20"
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
          d.ver === UI_VERSION || !d.ver ? verLink(UI_VERSION) : tr(L.dVerBoth, d.ver, UI_VERSION)
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
            h("span", { cls: "dv" }, typeof r[1] === "object" ? r[1] : String(r[1]))
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
        return dev(u, undefined, true);
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
        if (t.r) sum += tr(L.repSum, mm(t.r[0]), hmn(t.r[1]));
        if (t.d <= 0) sum = L.zeroDur;
        var ds = t.r && t.d < 10 ? 1 : 5,
          dmax = t.r ? t.r[0] - 1 : 240,
          ls = t.r && t.r[1] < 120 ? 15 : 60;
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
                  upd(i, { d: clamp(t.d - (t.r && t.d <= 10 ? 1 : 5), t.r ? 1 : 0, dmax) });
                },
                function () {
                  upd(i, { d: clamp(t.d + ds, 0, dmax) });
                }
              ),
              h("span", { cls: "lab" }, L.repeat),
              pills(
                [
                  [0, L.repOpts[0]],
                  [1, L.repOpts[1]]
                ],
                t.r ? 1 : 0,
                function (v) {
                  var d = clamp(t.d, 1, 240);
                  upd(i, { d: d, r: v ? [Math.max(20, Math.ceil((d + 1) / 5) * 5), 240] : 0 });
                }
              ),
              t.r
                ? [
                    h("span", { cls: "lab" }, L.every),
                    stepper(
                      mm(t.r[0]),
                      function () {
                        upd(i, { r: [clamp(t.r[0] - 5, Math.max(5, t.d + 1), 720), t.r[1]] });
                      },
                      function () {
                        upd(i, { r: [clamp(t.r[0] + 5, 5, 720), t.r[1]] });
                      }
                    ),
                    h("span", { cls: "lab" }, L.forLen),
                    stepper(
                      hmn(t.r[1]),
                      function () {
                        upd(i, {
                          r: [t.r[0], clamp(t.r[1] - (t.r[1] <= 120 ? 15 : 60), 15, 1440)]
                        });
                      },
                      function () {
                        upd(i, { r: [t.r[0], clamp(t.r[1] + ls, 15, 1440)] });
                      }
                    )
                  ]
                : null,
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
                  S.timers.push({ a: 1, o: 15, m: 540, d: 30, p: 0, y: 0, e: true, r: 0 });
                  S.editing = S.timers.length - 1;
                  render();
                  preview();
                }
              },
              L.addTimer
            )
          : h("span", { cls: "s" }, L.maxTimers),
        // what the timers do in the coming windows, as edited (before saving too)
        h("h2", { cls: "yr" }, L.pvTitle),
        viewPreview()
      ];
    }

    // ---------- the table: computed with hebcal, stored in the shabbat_dates script ----------
    // src/tablegen.js (sdBuild, sdParse, ...), put here by tools/build.mjs
    //@@TABLEGEN@@

    // A script's code via Script.GetCode in 4 KB pieces, asked 4 at a time (dev keeps at most
    // 2 in flight) - the same pattern as the loader in main.js (fast, small memory spikes on the device). The built scripts are
    // ASCII, so offsets in bytes are offsets in characters.
    function readCode(id) {
      function piece(o) {
        return dev("/rpc/Script.GetCode?id=" + id + "&len=4096&offset=" + o, undefined, true).then(
          function (j) {
            if (j.data === undefined) throw new Error(j.message || "GetCode");
            return j;
          }
        );
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
    // ---------- location: hebcal in the browser, only when the user sets it ----------
    // hebcal (@hebcal/core + its city list @hebcal/cities; GPL, not part of this project) is
    // loaded from a CDN only when "Set location" is pressed - never on load. Exact versions with
    // integrity hashes (test/ui_test.js checks them against node_modules), jsDelivr first,
    // unpkg if that fails. The page computes 5 years of windows (src/tablegen.js), writes them
    // as the code of the never-started script shabbat_dates and asks the controller to read it.
    var HC_LIBS = [
      [
        "@hebcal/core@6.14.6",
        "sha384-huTePbTparvpJ8OdNSTPdL+Uz8Pc5HJIb3mY8ULt8TQB62pLqxpx2QQDYQ4uxF37"
      ],
      [
        "@hebcal/cities@6.2.2",
        "sha384-e8+w5wcWoqEOqF5QtSvIIQuT0FNRno4IuGixwjSzH5VrjcFq4IJHz3k6e421o66Y"
      ]
    ];
    var HC_CDN = ["https://cdn.jsdelivr.net/npm/", "https://unpkg.com/"];
    var hcLoad = null,
      HC_CITIES = [];
    function loadLib(lib, i) {
      return new Promise(function (ok, no) {
        var el = h("script", {
          src: HC_CDN[i] + lib[0] + "/dist/bundle.min.js",
          integrity: lib[1],
          crossorigin: "anonymous"
        });
        el.onload = ok;
        el.onerror = function () {
          el.remove();
          no(new Error(lib[0]));
        };
        document.head.appendChild(el);
      }).catch(function (e) {
        if (i + 1 < HC_CDN.length) return loadLib(lib, i + 1);
        throw e;
      });
    }
    function loadHebcal() {
      if (!hcLoad)
        hcLoad = loadLib(HC_LIBS[0], 0)
          .then(function () {
            // @hebcal/cities adds each city (and its aliases) with Location.addLocation:
            // listen in for the list to search
            var add = hebcal.Location.addLocation;
            hebcal.Location.addLocation = function (n, l) {
              if (HC_CITIES.indexOf(l) < 0) HC_CITIES.push(l);
              return add.apply(this, arguments);
            };
            return loadLib(HC_LIBS[1], 0);
          })
          .catch(function (e) {
            hcLoad = null;
            throw e;
          });
      return hcLoad;
    }
    function cityLabel(l) {
      var cc = l.getCountryCode();
      return l.getName() + " · " + (hebcal.cities.countryNames[cc] || cc);
    }
    function locOpen() {
      var P = (S.loc = {
        msg: L.locLoading,
        q: "",
        la: "",
        lo: "",
        tz: TZ,
        il: TZ === "Asia/Jerusalem"
      });
      render();
      Promise.all([
        loadHebcal(),
        // the current place, to start from
        S.did >= 0
          ? readCode(S.did)
              .then(sdParse)
              .catch(function () {})
          : null
      ])
        .then(function (r) {
          var m = r[1] && r[1].meta;
          if (m && m.tz) {
            P.n = m.n;
            P.cc = m.cc;
            P.la = "" + m.la;
            P.lo = "" + m.lo;
            P.tz = m.tz;
            P.il = !!m.il;
          }
          P.ready = true;
          render();
        })
        .catch(function (e) {
          P.err = tr(L.locLoadErr, e.message);
          render();
        });
    }
    function locSave() {
      var P = S.loc,
        la = parseFloat(P.la),
        lo = parseFloat(P.lo);
      if (!(Math.abs(la) <= 90 && Math.abs(lo) <= 180)) {
        P.err = L.locBad;
        return render();
      }
      var place = { n: P.n || la + ", " + lo, cc: P.cc || "", la: la, lo: lo, tz: P.tz, il: P.il },
        code;
      P.busy = true;
      P.err = "";
      P.msg = L.locCalc;
      render();
      new Promise(function (ok) {
        setTimeout(ok, 30); // show the message first
      })
        .then(function () {
          var now = Date.now(),
            from = new Date(now - 30 * 86400000);
          code = sdBuild(
            hebcal,
            place,
            from,
            new Date(from.getTime() + 5 * 365.25 * 86400000),
            hebcal.version,
            Math.floor(now / 1000)
          );
          // the far north: say that havdalah is by minutes (src/tablegen.js)
          if (code.indexOf('"hm"') > 0) window.alert(tr(L.locHm, SD_HM));
          return devRpc("Script.List");
        })
        .then(function (l) {
          var d = (l.scripts || []).filter(function (x) {
            return (x.name || "").indexOf("shabbat_dates") === 0;
          })[0];
          return d
            ? d.id
            : devRpc("Script.Create", { name: "shabbat_dates" }).then(function (r) {
                return r.id;
              });
        })
        .then(function (id) {
          return putCode(id, code, L.locSaving, P);
        })
        .then(function () {
          return devRpc("Script.ShabbatSet", { id: ID, reload: true });
        })
        .then(function (j) {
          S.loc = null;
          S.tbl = null;
          S.flash = L.locDone;
          load(j);
          preview();
          setTimeout(function () {
            S.flash = "";
            render();
          }, 2500);
        })
        .catch(function (e) {
          P.busy = false;
          P.err = tr(L.locFail, e.message);
          render();
        });
    }
    function viewLoc() {
      var st = S.st,
        P = S.loc;
      var box = h("div", { cls: "card col" }, h("b", null, L.loc));
      if (!P) {
        add(
          box,
          st.loc
            ? [
                h("span", { cls: "v" }, st.loc),
                h(
                  "span",
                  { cls: "s" },
                  tr(L.locInfo, st.tz, day(st.end) + "/" + parts(st.end).year)
                )
              ]
            : h("div", { cls: "warn" }, L.locNone)
        );
        add(box, [
          h("span", { cls: "s" }, L.locHint),
          h(
            "div",
            { cls: "line" },
            h(
              "button",
              { cls: st.loc ? "btn" : "btn pri", onclick: locOpen },
              st.loc ? L.locChange : L.locSet
            )
          )
        ]);
        return box;
      }
      var cancel = h(
        "button",
        {
          cls: "btn",
          onclick: function () {
            S.loc = null;
            render();
          }
        },
        L.cancel
      );
      if (P.err) add(box, h("div", { cls: "warn" }, P.err));
      if (!P.ready || P.busy) {
        add(box, [h("span", { cls: "s", role: "status" }, P.msg), P.busy ? null : cancel]);
        return box;
      }
      function field(k, label, attrs) {
        attrs.id = "l" + k;
        attrs.value = P[k];
        attrs.oninput = function (e) {
          P[k] = e.target.value;
          P.n = P.cc = ""; // typed by hand: the name becomes the coordinates
        };
        return h(
          "div",
          { cls: "col0 grow" },
          h("label", { cls: "lab", for: attrs.id }, label),
          h("input", attrs)
        );
      }
      // the search updates only its results, so the field keeps the focus while typing
      var hits = h("div", { cls: "line wrap" });
      function find() {
        var q = P.q.toLowerCase();
        hits.replaceChildren();
        if (q.length < 2) return;
        add(
          hits,
          HC_CITIES.filter(function (l) {
            return cityLabel(l).toLowerCase().indexOf(q) >= 0;
          })
            .slice(0, 8)
            .map(function (l) {
              return h(
                "button",
                {
                  cls: "pill",
                  onclick: function () {
                    P.n = l.getName();
                    P.cc = l.getCountryCode();
                    P.la = "" + l.getLatitude();
                    P.lo = "" + l.getLongitude();
                    P.tz = l.getTzid();
                    P.il = l.getIsrael();
                    P.q = "";
                    render();
                  }
                },
                cityLabel(l)
              );
            })
        );
      }
      find();
      var zones = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [];
      add(box, [
        P.n ? h("span", { cls: "v" }, P.n) : null,
        h("input", {
          id: "lq",
          type: "search",
          placeholder: L.locSearch,
          "aria-label": L.locSearch,
          value: P.q,
          oninput: function (e) {
            P.q = e.target.value;
            find();
          }
        }),
        hits,
        h("span", { cls: "s" }, L.locOr),
        h(
          "div",
          { cls: "line" },
          field("la", L.locLat, { inputmode: "decimal" }),
          field("lo", L.locLon, { inputmode: "decimal" })
        ),
        field("tz", L.locTz, { list: "ltzs", autocomplete: "off" }),
        h(
          "datalist",
          { id: "ltzs" },
          zones.map(function (z) {
            return h("option", { value: z });
          })
        ),
        h(
          "div",
          { cls: "row" },
          h("div", { cls: "col0" }, h("b", null, L.locIl)),
          sw(P.il, L.locIl, function () {
            P.il = !P.il;
            render();
          })
        ),
        h(
          "div",
          { cls: "line" },
          h("button", { cls: "btn pri", onclick: locSave }, L.locSave),
          cancel
        )
      ]);
      return box;
    }

    // ---------- software update: only when the user presses "Check for updates" ----------
    // The latest release is read from the repository's `library` branch (written only by the
    // release workflow, from a tested build; the Shelly script library installs from the same
    // place) on raw.githubusercontent.com, which allows cross-origin reads - GitHub release
    // downloads do not. The browser downloads and uploads; the device needs no internet.
    var REPO = "Izikd/shelly-shabbat-controller";
    // stable releases go to the `library` branch, pre-releases (v1.2.3-beta.1) to
    // `library-beta` (.github/workflows/release.yml)
    var LIB = "https://raw.githubusercontent.com/" + REPO + "/";
    // the beta choice is kept on the device (firmware KVS, written by the browser: no script
    // memory), so every browser opening this device sees the same channel
    var BETA_KEY = "shabbat_upd_beta";
    function firstLine(code) {
      return (code || "").split("\n")[0];
    }
    function stampVer(stamp) {
      var m = (stamp || "").match(/version (\S+)/);
      return m ? m[1] : "";
    }
    // "v1.2.3" or "v1.2.3-rc.1" -> [1, 2, 3, "-rc.1"]; null for "dev" and anything else
    function semver(v) {
      var m = /^v(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.]+)?$/.exec(v || "");
      return m ? [+m[1], +m[2], +m[3], m[4] || "~"] : null;
    }
    // > 0 when release a is newer than b. A pre-release is older than its release ("~" sorts
    // after "-"); pre-releases of one version compare as text
    function cmpVer(a, b) {
      var x = semver(a),
        y = semver(b);
      for (var i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
      return x[3] === y[3] ? 0 : x[3] < y[3] ? -1 : 1;
    }
    // a firmware RPC; an error reply ({code, message}) becomes a rejected promise. Network
    // failures and proxy error pages reject with a TypeError, which putCode tells apart.
    function devRpc(method, params) {
      // no automatic retry: a repeated PutCode append would duplicate code (putCode retries
      // itself, after checking what arrived); queued like every other device request
      return dev("/rpc/" + method, { method: "POST", body: JSON.stringify(params || {}) }).then(
        function (j) {
          if (j && j.code !== undefined && j.message !== undefined) throw new Error(j.message);
          return j;
        }
      );
    }
    // what Script.PutCode accepts as-is: built scripts are ASCII (see AGENTS.md), and only tab
    // and newline as control characters, so JSON.stringify adds no \u escapes (PutCode rejects
    // them)
    function okCode(code, head) {
      if (code.indexOf(head) !== 0 || !/^[\t\n\x20-\x7e]*$/.test(code))
        throw new Error(L.updBadFile);
    }
    // one channel's release: both files, checked; rejects on anything wrong
    function getRelease(branch) {
      function get(name) {
        return fetch(LIB + branch + "/" + name, { cache: "no-store" }).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        });
      }
      return Promise.all([get("shabbat_controller.js"), get("shabbat_ui.js")]).then(function (r) {
        var v = stampVer(firstLine(r[0]));
        okCode(r[0], "// Shabbat controller - ");
        okCode(r[1], "// shabbat_ui - ");
        if (!semver(v)) throw new Error(L.updBadFile);
        // the CDN caches each file for up to 5 minutes: right after a release they may differ
        if (stampVer(firstLine(r[1])) !== v) throw new Error(L.updMismatch);
        return { v: v, ctrl: r[0], ui: r[1] };
      });
    }
    function checkUpdate() {
      S.upd = { busy: true, msg: L.updChecking };
      render();
      Promise.all([
        getRelease("library"),
        // beta: the newer of the two channels (a stable release can follow a beta). No beta
        // published, or a broken one, still leaves the stable release
        S.beta
          ? getRelease("library-beta").catch(function () {
              return null;
            })
          : null,
        // the installed version is in the first line of the controller's code
        devRpc("Script.GetCode", { id: ID, offset: 0, len: 120 })
      ])
        .then(function (r) {
          var rel = r[1] && cmpVer(r[1].v, r[0].v) > 0 ? r[1] : r[0];
          var ctrl = firstLine(r[2].data),
            iv = stampVer(ctrl),
            uv = stampVer(UI_STAMP);
          rel.inst = verLabel(ctrl) || "?";
          // "onbeta": beta switched off while a beta newer than the stable release runs. Like
          // other beta programmes, leaving the channel does not downgrade: the next stable
          // release newer than the beta is offered as usual, and going back to the older
          // stable one now is a separate, explicit choice (with a warning)
          rel.state =
            !semver(iv) || !semver(uv)
              ? "dev"
              : cmpVer(rel.v, iv) > 0 || cmpVer(rel.v, uv) > 0
                ? "newer"
                : !S.beta && iv.indexOf("-") > 0 && cmpVer(rel.v, iv) < 0
                  ? "onbeta"
                  : "current";
          S.upd = rel;
          render();
        })
        .catch(function (e) {
          S.upd = { err: tr(L.updCheckFailed, e.message) };
          render();
        });
    }
    // KVS.GetMany, not KVS.Get: a missing key is an empty result, not an HTTP 500 (and a
    // console error) on every load. The docs show `items` both as a list and as an object.
    function loadBeta() {
      devRpc("KVS.GetMany", { match: BETA_KEY }).then(
        function (j) {
          var it = j.items || {},
            v = it.length !== undefined ? it[0] : it[BETA_KEY];
          S.beta = !!v && v.value === "1";
          render();
        },
        function () {}
      );
    }
    function setBeta(on) {
      S.beta = on;
      S.upd = null; // the last result was for the other channel
      render();
      devRpc("KVS.Set", { key: BETA_KEY, value: on ? "1" : "0" }).catch(function (e) {
        S.err = e.message;
        render();
      });
    }
    // Upload in 1 KB pieces, like tools/deploy.py. A lost reply may or may not have applied its
    // piece, so an append is never re-sent blindly: the upload resumes from the length the
    // device reports. Then the code is read back and compared.
    function putCode(id, code, label, prog) {
      var i = 0,
        fails = 0;
      function next() {
        (prog || S.upd).msg = tr(label, Math.round((i * 100) / code.length));
        render();
        if (i >= code.length)
          return readCode(id).then(function (c) {
            if (c !== code) throw new Error(L.updVerify);
          });
        var piece = code.slice(i, i + 1024);
        return devRpc("Script.PutCode", { id: id, code: piece, append: i > 0 }).then(
          function () {
            i += piece.length;
            return next();
          },
          function (e) {
            if (!(e instanceof TypeError) || ++fails > 5) throw e; // a device error: give up
            if (i === 0) return next(); // the first piece replaces the code: safe to resend
            var q = "/rpc/Script.GetCode?id=" + id + "&offset=0&len=1";
            return dev(q, undefined, true).then(function (j) {
              var have = j.data.length + j.left;
              i = have === i || have === i + piece.length ? have : 0;
              return next();
            });
          }
        );
      }
      return next();
    }
    // wait until the restarted controller answers (it says "starting" until its boot is done)
    function waitCtrl(n) {
      return devRpc("Script.ShabbatGet", { id: ID }).catch(function () {
        if (n <= 0) return null; // reload anyway: the page shows what is wrong
        return new Promise(function (ok) {
          setTimeout(ok, 1000);
        }).then(function () {
          return waitCtrl(n - 1);
        });
      });
    }
    // Same order as tools/deploy.py: the page first (the controller keeps running), then the
    // controller is stopped only for its own upload. Its old code is kept, and put back if
    // anything fails after the stop.
    function installUpdate() {
      var U = S.upd,
        backup = null,
        stopped = false;
      var ask =
        tr(U.state === "onbeta" ? L.updDowngrade : L.updConfirm, U.v) +
        (S.st && S.st.cur ? "\n\n" + L.updInWindow : "");
      if (!window.confirm(ask)) return;
      U.busy = true;
      U.err = "";
      devRpc("Script.List")
        .then(function (l) {
          var ui = (l.scripts || []).filter(function (s) {
            return (s.name || "").indexOf("shabbat_ui") === 0;
          })[0];
          if (!ui) throw new Error("script shabbat_ui not found");
          return putCode(ui.id, U.ui, L.updUi);
        })
        .then(function () {
          return readCode(ID);
        })
        .then(function (c) {
          backup = c;
          return devRpc("Script.Stop", { id: ID });
        })
        .then(function () {
          stopped = true;
          return putCode(ID, U.ctrl, L.updCtrl);
        })
        .then(function () {
          U.msg = L.updRestart;
          render();
          return devRpc("Script.Start", { id: ID });
        })
        .then(function () {
          stopped = false;
          return waitCtrl(20);
        })
        .then(function () {
          U.msg = L.updDone;
          render();
          setTimeout(function () {
            location.reload();
          }, 1000);
        })
        .catch(function (e) {
          var msg = tr(L.updFailed, e.message);
          function done(extra) {
            S.upd = { err: msg + extra };
            render();
            refresh();
          }
          if (!stopped) return done("");
          putCode(ID, backup, L.updCtrl)
            .then(function () {
              return devRpc("Script.Start", { id: ID });
            })
            .then(
              function () {
                return waitCtrl(20).then(function () {
                  done(L.updRestored);
                });
              },
              function () {
                done(L.updStopped);
              }
            );
        });
    }
    // a release (stable or beta) links to its GitHub release page; a development build does not
    function verLink(label) {
      var v = label.split(" · ")[0];
      return semver(v)
        ? h("a", { cls: "lnk", href: relUrl(v), target: "_blank", rel: "noopener" }, label)
        : label;
    }
    function relUrl(v) {
      return "https://github.com/" + REPO + "/releases/tag/" + encodeURIComponent(v);
    }
    function viewUpdate() {
      var U = S.upd || {};
      var box = h("div", { cls: "card col" }, h("b", null, L.upd));
      if (U.busy) {
        add(box, h("span", { cls: "s", role: "status" }, U.msg));
        return box;
      }
      if (U.err) add(box, h("div", { cls: "warn" }, U.err));
      if (!U.state) add(box, h("span", { cls: "s" }, L.updHint));
      else
        add(
          box,
          h(
            "span",
            null,
            U.state === "current"
              ? tr(L.updCurrent, U.inst)
              : U.state === "newer"
                ? tr(L.updNewer, U.v, U.inst)
                : U.state === "onbeta"
                  ? tr(L.updOnBeta, U.inst)
                  : tr(L.updDev, U.inst, U.v)
          )
        );
      var btns = h("div", { cls: "line wrap" });
      if (U.state === "newer" || U.state === "dev")
        add(btns, h("button", { cls: "btn pri", onclick: installUpdate }, tr(L.updInstall, U.v)));
      if (U.state === "onbeta")
        add(btns, h("button", { cls: "btn", onclick: installUpdate }, tr(L.updStable, U.v)));
      add(btns, h("button", { cls: "btn", onclick: checkUpdate }, L.updCheck));
      if (U.v)
        add(
          btns,
          h(
            "a",
            {
              cls: "lnk",
              href: relUrl(U.v),
              target: "_blank",
              rel: "noopener"
            },
            L.updNotes
          )
        );
      add(box, btns);
      add(box, [
        h("hr"),
        h(
          "div",
          { cls: "row" },
          h(
            "div",
            { cls: "col0" },
            h("b", null, L.updBeta),
            h("span", { cls: "s" }, L.updBetaHint)
          ),
          sw(!!S.beta, L.updBeta, function () {
            setBeta(!S.beta);
          })
        )
      ]);
      return box;
    }
    function loadTable() {
      if (S.tbl || S.tblLoading) return;
      if (S.did < 0) {
        S.tbl = [];
        return;
      }
      S.tblLoading = true;
      readCode(S.did)
        .then(function (code) {
          S.tbl = sdParse(code).w;
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
      if (!S.tbl.length) return h("div", { cls: "warn" }, L.locNone);
      var rows = S.tbl.filter(function (w) {
        return (S.tblPast || w.e > now) && (!S.tblHol || w.k !== 1);
      });
      // the coming year, unless asked for all (5 years are hundreds of rows)
      var more = 0;
      if (!S.tblAll)
        rows = rows.filter(function (w) {
          if (w.s < now + 366 * 86400) return true;
          more++;
          return false;
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
      if (more)
        out.push(
          h(
            "button",
            {
              cls: "btn",
              onclick: function () {
                S.tblAll = true;
                render();
              }
            },
            tr(L.showAll, more)
          )
        );
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
            !w.skip && !w.on.length && !(w.rp || []).length
              ? h("span", { cls: "s" }, L.pvNone)
              : null,
            // rp: a repeating timer in short, [first start, last end, label, every, duration]
            w.on
              .concat(w.rp || [])
              .sort(function (a, b) {
                return a[0] - b[0];
              })
              .map(function (o) {
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
                  h(
                    "span",
                    { cls: "grow" },
                    day(o[0]) +
                      " · " +
                      (o[3]
                        ? tr(L.pulseEvery, mm(o[4]), mm(o[3]))
                        : mm(Math.round((o[1] - o[0]) / 60)))
                  ),
                  h("span", { cls: "who" }, names.join(" + "))
                );
              })
          );
        })
      ];
    }

    // ---------- tabs ----------
    // The tab is kept in the address (#settings), so a reload - also the one after an update -
    // comes back to it. Each tab asks the device only for what it shows: the forecast when
    // Timers opens, the beta choice and the public page when Settings first opens.
    var TABS = ["status", "timers", "table", "settings"];
    function openTab(t) {
      S.tab = t;
      try {
        history.replaceState(null, "", t === "status" ? location.pathname : "#" + t);
      } catch (e) {}
      if (t === "timers") preview();
      if (t === "settings" && !S.setUp) {
        S.setUp = true;
        loadBeta();
        loadPub();
      }
    }

    // ---------- render ----------
    var root = document.getElementById("app");
    function render() {
      var st = S.st;
      var tabs = [
        ["status", L.tabs[0]],
        ["timers", L.tabs[1]],
        ["table", L.tabs[2]],
        ["settings", L.tabs[3]]
      ];
      var relay = !st ? "…" : (st.relay ? L.relayOn : L.relayOff) + (st.test ? L.testTag : "");
      var body =
        S.tab === "status"
          ? viewStatus()
          : S.tab === "timers"
            ? viewTimers()
            : S.tab === "table"
              ? viewTable()
              : viewSettings();
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
                    openTab(t[0]);
                    render();
                    window.scrollTo(0, 0); // a tab starts at its top
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
                      S.timers = fromCfg(JSON.parse(S.saved));
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
                      rpc("ShabbatSet", draft(), function (j) {
                        S.saved = JSON.stringify(draft());
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
      var y = window.scrollY,
        f = document.activeElement,
        fid = f && f.id,
        sel = fid && f.selectionStart;
      root.replaceChildren(app);
      window.scrollTo(0, y);
      // keep the field being typed in (a new status from the device re-renders the page)
      f = fid && document.getElementById(fid);
      if (f && f.focus) {
        f.focus();
        try {
          f.setSelectionRange(sel, sel);
        } catch (e) {}
      }
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
      .wrap { flex-wrap: wrap }
      .lnk { font-size: 14px; color: #1D4ED8; padding: 0 4px }
      .grow { flex: 1; min-width: 0 }
      .qr { align-self: center; line-height: 0 }
      .qr img { border-radius: 8px; border: 1px solid #E2E6EC }
      button:focus-visible, input:focus-visible { outline: 2px solid #1D4ED8; outline-offset: 2px }
    `;
    document.head.appendChild(h("style", null, css));
    openTab(TABS.indexOf(location.hash.slice(1)) > 0 ? location.hash.slice(1) : "status");
    render();
    refresh();
    // Every open page shares the device's few connections (docs/device/network.md): a page in
    // a hidden tab or a minimised window does not ask, and catches up when it is shown again.
    function poll() {
      refresh();
      if (S.tab === "settings" && S.pub && S.pub.on) loadPub();
    }
    setInterval(function () {
      if (!document.hidden) poll();
    }, 15000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) poll();
    });
  })();
