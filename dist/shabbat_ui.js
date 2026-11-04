// shabbat_ui - DO NOT START this script. It only stores the settings page code, loaded by the browser from /script/<id>/ui
if(typeof document!=="undefined")(function(){
var ID=window.SE_ID,TZ="Asia/Jerusalem";
var S={tab:"status",timers:[],saved:"[]",editing:-1,cfg:null,st:null,prev:null,err:"",flash:"",
tbl:null,tblErr:"",tblHol:false,tblPast:false};
function rpc(method,params,cb){
params=params||{};params.id=ID;
fetch("/rpc/Script."+method,{method:"POST",body:JSON.stringify(params)})
.then(function(r){return r.json();})
.then(function(j){
if(j&&j.code!==undefined&&j.message!==undefined&&!j.cfg&&!j.w){S.err=j.message;render();return;}
S.err="";cb(j);
})
.catch(function(e){S.err="אין חיבור למכשיר";render();});
}
function toArr(t){return[t.a,t.a===1?t.m:t.o,t.d,t.p,t.y,t.e?1:0];}
function toObj(v){return{a:v[0],o:v[0]===1?(v[0]===2?-40:15):v[1],m:v[0]===1?v[1]:720,d:v[2],p:v[3],y:v[4],e:!!v[5]};}
function draft(){return S.timers.map(toArr);}
function load(j){
S.cfg=j.cfg;S.st=j.st;S.log=j.log||"";S.base=j.base;
if(!dirty()){S.timers=j.cfg.timers.map(toObj);S.saved=JSON.stringify(j.cfg.timers);}
render();
}
function dirty(){return JSON.stringify(draft())!==S.saved;}
var pvTimer=null;
function preview(){
clearTimeout(pvTimer);
pvTimer=setTimeout(function(){
rpc("ShabbatPreview",{timers:draft(),n:6},function(j){S.prev=j.w;render();});
},250);
}
function refresh(){rpc("ShabbatGet",{},load);}
var DF=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,weekday:"short",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
var WD={Sun:"א׳",Mon:"ב׳",Tue:"ג׳",Wed:"ד׳",Thu:"ה׳",Fri:"ו׳",Sat:"ש׳"};
function parts(t){var o={};DF.formatToParts(new Date(t*1000)).forEach(function(p){o[p.type]=p.value;});return o;}
function hm(t){var p=parts(t);return p.hour+":"+p.minute;}
function day(t){var p=parts(t);return WD[p.weekday]+" "+p.day+"/"+p.month;}
function full(t){return day(t)+" "+hm(t);}
function jOffset(t){var p=parts(t);return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)/1000-Math.floor(t/60)*60;}
function fromLocalInput(v){
var g=Date.UTC(+v.substr(0,4),+v.substr(5,2)-1,+v.substr(8,2),+v.substr(11,2),+v.substr(14,2))/1000;
var u=g-jOffset(g);return g-jOffset(u);
}
function toLocalInput(t){var p=parts(t);return p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute;}
var HE={"Shabbat":"שבת","Pesach":"פסח","Pesach VII":"שביעי של פסח","Shavuot":"שבועות","Rosh Hashana":"ראש השנה",
"Yom Kippur":"יום כיפור","Sukkot":"סוכות","Simchat Torah":"שמחת תורה"};
var HDF=new Intl.DateTimeFormat("he-u-ca-hebrew",{timeZone:TZ,day:"numeric",month:"long"});
function gem(n){
if(n===15)return "ט״ו";if(n===16)return "ט״ז";
var t=["","י","כ","ל"][Math.floor(n/10)],o=["","א","ב","ג","ד","ה","ו","ז","ח","ט"][n%10],g=t+o;
return g.length>1?g.slice(0,-1)+"״"+g.slice(-1):g+"׳";
}
function hdate(t){
var o={};HDF.formatToParts(new Date(t*1000)).forEach(function(p){o[p.type]=p.value;});
return gem(+o.day)+" ב"+o.month;
}
function wdate(w){return hdate(w.s+43200);}
function title(t){return t.split(" + ").map(function(x){return HE[x]||x;}).join(" + ");}
var KIND={1:"שבת",2:"יום טוב",3:"שבת + יו״ט"};
function mm(n){return n+" דק׳";}
function hhmm(m){return("0"+Math.floor(m/60)).slice(-2)+":"+("0"+(m%60)).slice(-2);}
function h(tag,attrs){
var el=document.createElement(tag);
for(var k in attrs||{}){
var v=attrs[k];
if(v===null||v===undefined||v===false)continue;
if(k.slice(0,2)==="on")el.addEventListener(k.slice(2),v);
else if(k==="cls")el.className=v;
else el.setAttribute(k,v===true?"":v);
}
for(var i=2;i<arguments.length;i++)add(el,arguments[i]);
return el;
}
function add(el,c){
if(c===null||c===undefined||c===false)return;
if(c instanceof Array){c.forEach(function(x){add(el,x);});return;}
el.appendChild(typeof c==="object"?c:document.createTextNode(String(c)));
}
function sw(on,label,fn){
return h("button",{cls:"sw"+(on?" on":""),"aria-pressed":on?"true":"false","aria-label":label,onclick:fn},h("span"));
}
function pills(opts,cur,fn){
return h("div",{cls:"pills"},opts.map(function(o){
return h("button",{cls:"pill"+(o[0]===cur?" sel":""),"aria-pressed":o[0]===cur?"true":"false",onclick:function(){fn(o[0]);}},o[1]);
}));
}
function stepper(text,dec,inc){
return h("div",{cls:"step"},h("button",{"aria-label":"הפחת 5 דקות",onclick:dec},"−"),h("span",null,text),
h("button",{"aria-label":"הוסף 5 דקות",onclick:inc},"+"));
}
function clamp(v,a,b){return v<a?a:(v>b?b:v);}
function upd(i,patch){for(var k in patch)S.timers[i][k]=patch[k];render();preview();}
function viewStatus(){
var st=S.st,cfg=S.cfg;
if(!st)return h("div",{cls:"card"},"טוען…");
var cur=st.cur?title(st.cur.t)+" · עד "+full(st.cur.e):"אין";
var nx=st.next;
var nextOn=!st.auto?"האוטומציה כבויה":(st.on?"פועל עכשיו עד "+hm(st.on[1]):(st.nextOn?full(st.nextOn[0])+" · "+mm(Math.round((st.nextOn[1]-st.nextOn[0])/60)):"אין הפעלות בחלון הקרוב"));
var warn=st.end-st.now<180*86400?h("div",{cls:"warn"},"טבלת הזמנים מסתיימת ב-"+day(st.end)+" – יש לעדכן את הסקריפט"):null;
return[
!st.synced?h("div",{cls:"warn"},"השעון לא מסונכרן – הממסר כבוי ליתר ביטחון"):null,warn,
st.manual?h("div",{cls:"warn col"},h("b",null,"הממסר הופעל/כובה ידנית"),
h("span",null,"האוטומציה לא תשנה את מצבו עד האירוע הבא בלוח הזמנים."),
h("button",{cls:"btn",onclick:function(){rpc("ShabbatSet",{resume:true},load);}},"חזור לאוטומטי עכשיו")):null,
h("div",{cls:"card col"},
h("div",{cls:"kv"},h("span",{cls:"k"},"איסור מלאכה עכשיו"),h("span",{cls:"v big"},cur)),
h("hr"),
h("div",{cls:"kv"},h("span",{cls:"k"},"החלון הבא"),h("span",{cls:"v"},nx?title(nx.t)+" · "+wdate(nx)+(cfg.skip===nx.s?" (מדולג)":""):"—"),
nx?h("span",{cls:"s"},full(nx.s)+" ← "+full(nx.e)):null),
h("hr"),
h("div",{cls:"kv"},h("span",{cls:"k"},"הפעלה הבאה של הממסר"),h("span",{cls:"v"},nextOn))),
h("div",{cls:"card rows"},
h("div",{cls:"row"},h("div",{cls:"col0"},h("b",null,"אוטומציה פעילה"),h("span",{cls:"s"},"כבוי = הממסר בשליטה ידנית")),
sw(st.auto,"אוטומציה פעילה",function(){rpc("ShabbatSet",{auto:!st.auto},load);})),
h("hr"),
h("div",{cls:"row"},h("div",{cls:"col0"},h("b",null,"דלג על החלון הקרוב"),h("span",{cls:"s"},"חד-פעמי, חוזר לפעול אחריו")),
sw(!!cfg.skip,"דלג על החלון הקרוב",function(){rpc("ShabbatSet",{skip:!cfg.skip},function(j){load(j);preview();});}))),
h("div",{cls:"card col"},
h("label",{"for":"tt"},h("b",null,"זמן בדיקה")),
h("span",{cls:"s"},"מדמה שעה אחרת (שעון ישראל) כדי לבדוק את הממסר. לא נשמר אחרי הפעלה מחדש."),
h("div",{cls:"line"},
h("input",{id:"tt",type:"datetime-local",value:st.test?toLocalInput(st.test):"",
onchange:function(e){if(e.target.value)rpc("ShabbatSet",{test:fromLocalInput(e.target.value)},load);}}),
h("button",{cls:"btn",onclick:function(){rpc("ShabbatSet",{test:0},load);}},"נקה")),
st.test?h("div",{cls:"warn"},"מצב בדיקה פעיל – הממסר פועל לפי "+full(st.test)):null),
viewLog(),viewDiag()
];
}
var CAUSE={a:"אוטומטי",m:"ידני",t:"כיבוי אוטומטי של המכשיר",f:"ביטחון (שעון לא מסונכרן)",x:"זמן בדיקה"};
function viewLog(){
var ev=(S.log?S.log.split(","):[]).map(function(e){
var m=e.match(/^(\d+)([01])([a-z])$/);
return m?{t:+m[1]?S.base+ +m[1]*60:0,on:m[2]==="1",c:m[3]}:null;
}).filter(Boolean).reverse();
return h("div",{cls:"card col"},h("b",null,"יומן הממסר"),
h("span",{cls:"s"},"15 ההפעלות והכיבויים האחרונים (נשמר במכשיר)."),
!ev.length?h("span",{cls:"s"},"אין עדיין אירועים"):ev.map(function(e){
return h("div",{cls:"slot"+(e.on?"":" offev")},h("span",{cls:"tm"},e.t?hm(e.t):"--:--"),
h("span",{cls:"grow"},(e.t?day(e.t):"זמן לא ידוע")+" · "+(e.on?"הופעל":"כובה")),h("span",{cls:"who"},CAUSE[e.c]||e.c));
}));
}
function viewDiag(){
var d=S.diag;
var box=h("div",{cls:"card col"},
h("button",{cls:"tname","aria-expanded":S.diagOpen?"true":"false",onclick:function(){
S.diagOpen=!S.diagOpen;if(S.diagOpen)loadDiag();render();}},h("b",null,(S.diagOpen?"▾ ":"◂ ")+"מידע טכני")));
if(!S.diagOpen)return box;
if(!d){add(box,h("span",{cls:"s"},"טוען…"));return box;}
function up(sec){var dd=Math.floor(sec/86400),hh=Math.floor(sec%86400/3600),mi=Math.floor(sec%3600/60);return(dd?dd+" ימים ":"")+hh+" שע׳ "+mi+" דק׳";}
var rows=[
["מכשיר",d.info.model+" · "+d.info.id],["קושחה",d.info.ver],
["זמן פעולה",up(d.sys.uptime)],["סנכרון שעון אחרון",d.sys.last_sync_ts?full(d.sys.last_sync_ts):"לא סונכרן"],
["זיכרון פנוי במכשיר",Math.round(d.sys.ram_free/1024)+" KB"],
["זיכרון הסקריפט",d.scr.mem_used+" בשימוש · שיא "+d.scr.mem_peak+" · פנוי "+d.scr.mem_free],
["מצב הסקריפט",d.scr.running?"רץ":"עצור"],["שגיאות",d.scr.error_msg||(d.scr.errors&&d.scr.errors.join(", "))||"אין"],
["מקור פקודה אחרונה לממסר",d.sw.source+(d.sw.tag?" ("+d.sw.tag+")":"")],
["טמפרטורה",d.sw.temperature?d.sw.temperature.tC+"°C":"—"]];
add(box,rows.map(function(r){return h("div",{cls:"line sb drow"},h("span",{cls:"s"},r[0]),h("span",{cls:"dv"},String(r[1])));}));
add(box,h("button",{cls:"btn",onclick:function(){S.diag=null;loadDiag();render();}},"רענן"));
return box;
}
function loadDiag(){
function g(u){return fetch(u).then(function(r){return r.json();});}
Promise.all([g("/rpc/Shelly.GetDeviceInfo"),g("/rpc/Sys.GetStatus"),g("/rpc/Script.GetStatus?id="+ID),g("/rpc/Switch.GetStatus?id=0")])
.then(function(r){S.diag={info:r[0],sys:r[1],scr:r[2],sw:r[3]};render();})
.catch(function(e){S.err="מידע טכני: "+e.message;render();});
}
function viewTimers(){
var list=S.timers.map(function(t,i){
var ed=S.editing===i,isC=t.a===1;
var ap=t.p===1?" · שבת בלבד":(t.p===2?" · יו״ט בלבד":"");
var nm,badge,sum;
if(t.a===0){nm="אחרי הדלקת נרות";badge="נרות";sum="מתחיל "+mm(t.o)+" אחרי · פועל "+mm(t.d)+ap;}
else if(t.a===2){nm="לפני הבדלה";badge="הבדלה";sum="מתחיל "+mm(-t.o)+" לפני · פועל "+mm(t.d)+ap;}
else{nm="בשעה "+hhmm(t.m);badge="שעה";sum=["כל הימים","יום ראשון","יום אחרון"][t.y]+" · פועל "+mm(t.d)+ap;}
if(t.d<=0)sum="משך 0 – לא פועל";
var lim=t.a===2?[-180,0]:[0,180];
var editor=!ed?null:h("div",{cls:"ed"},
h("span",{cls:"lab"},"נקודת התחלה"),
pills([[0,"הדלקת נרות"],[1,"שעה קבועה"],[2,"הבדלה"]],t.a,function(v){upd(i,{a:v,o:v===2?-40:15});}),
isC?[h("label",{cls:"lab","for":"tm"+i},"שעה"),
h("input",{id:"tm"+i,type:"time",value:hhmm(t.m),onchange:function(e){
var p=e.target.value.split(":");if(p.length===2)upd(i,{m:+p[0]*60+ +p[1]});}})]
:[h("span",{cls:"lab"},t.a===2?"כמה דקות לפני ההבדלה":"כמה דקות אחרי הדלקת הנרות"),
stepper(mm(Math.abs(t.o)),
function(){upd(i,{o:clamp(t.a===2?t.o+5:t.o-5,lim[0],lim[1])});},
function(){upd(i,{o:clamp(t.a===2?t.o-5:t.o+5,lim[0],lim[1])});})],
h("span",{cls:"lab"},"משך"),
stepper(mm(t.d),function(){upd(i,{d:clamp(t.d-5,0,240)});},function(){upd(i,{d:clamp(t.d+5,0,240)});}),
h("span",{cls:"lab"},"חל על"),
pills([[0,"שבת ויו״ט"],[1,"שבת בלבד"],[2,"יו״ט בלבד"]],t.p,function(v){upd(i,{p:v});}),
isC?[h("span",{cls:"lab"},"באילו ימים"),
pills([[0,"כל הימים"],[1,"יום ראשון"],[2,"יום אחרון"]],t.y,function(v){upd(i,{y:v});}),
h("span",{cls:"s"},"בחג של יומיים או שבת צמודה לחג – יום ראשון / אחרון / כל הימים.")]:null,
h("div",{cls:"line sb"},
h("button",{cls:"btn danger",onclick:function(){S.timers.splice(i,1);S.editing=-1;render();preview();}},"מחק טיימר"),
h("button",{cls:"btn pri",onclick:function(){S.editing=-1;render();}},"סיום")));
return h("div",{cls:"card t"+(ed?" edit":"")+(t.e?"":" off")},
h("div",{cls:"row"},
h("span",{cls:"badge b"+t.a},badge),
h("button",{cls:"tname","aria-expanded":ed?"true":"false",onclick:function(){S.editing=ed?-1:i;render();}},
h("b",null,nm),h("span",{cls:"s"},sum)),
sw(t.e,(t.e?"כבה ":"הפעל ")+nm,function(){upd(i,{e:!t.e});})),
editor);
});
return[h("span",{cls:"s"},"כל טיימר פועל רק בתוך חלון איסור מלאכה (שבת ויום טוב)."),list,
S.timers.length<12?h("button",{cls:"addbtn",onclick:function(){
S.timers.push({a:1,o:15,m:540,d:30,p:0,y:0,e:true});S.editing=S.timers.length-1;render();preview();}},"+ הוסף טיימר")
:h("span",{cls:"s"},"הגעת למקסימום של 12 טיימרים.")];
}
var A64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-";
function loadTable(){
if(S.tbl||S.tblLoading)return;
S.tblLoading=true;
var code="",off=0,te=new TextEncoder();
function next(){
fetch("/rpc/Script.GetCode?id="+ID+"&offset="+off).then(function(r){return r.json();}).then(function(j){
if(j.data===undefined)throw new Error(j.message||"GetCode");
code+=j.data;off+=te.encode(j.data).length;
if(j.left&&j.data.length){next();return;}
var b=code.match(/TBL_BASE\s*=\s*(\d+)/),t=code.match(/TBL_T\s*=\s*(\[[^\]]*\])/),d=code.match(/TBL\s*=\s*"([A-Za-z0-9+\-]*)"/);
if(!b||!t||!d)throw new Error("table not found in controller code");
var base=+b[1],titles=JSON.parse(t[1]),data=d[1],out=[];
function dec(p,w){var n=0;for(var i=0;i<w;i++)n=n*64+A64.indexOf(data.charAt(p+i));return n;}
for(var p=0;p+8<=data.length;p+=8){
var st=base+dec(p,4)*60,ti=titles[A64.indexOf(data.charAt(p+7))];
out.push({s:st,e:st+dec(p+4,3)*60,t:ti,k:ti==="Shabbat"?1:(ti.indexOf("Shabbat")>=0?3:2)});
}
S.tbl=out;S.tblLoading=false;render();
}).catch(function(e){S.tblErr=e.message;S.tblLoading=false;render();});
}
next();
}
function dur(sec){
var h=Math.round(sec/3600);
return h+" שעות";
}
function viewTable(){
if(S.tblErr)return h("div",{cls:"warn"},"לא ניתן לקרוא את הטבלה: "+S.tblErr);
if(!S.tbl){loadTable();return h("div",{cls:"card"},"טוען…");}
var now=(S.st&&S.st.now)||Date.now()/1000;
var rows=S.tbl.filter(function(w){return(S.tblPast||w.e>now)&&(!S.tblHol||w.k!==1);});
var first=S.tbl[0],last=S.tbl[S.tbl.length-1];
var out=[h("span",{cls:"s"},S.tbl.length+" חלונות בטבלה, מ-"+day(first.s)+"/"+parts(first.s).year+" עד "+day(last.e)+"/"+parts(last.e).year+". שעות לפי הדלקת נרות והבדלה."),
h("div",{cls:"pills two"},
h("button",{cls:"pill"+(S.tblHol?"":" sel"),"aria-pressed":S.tblHol?"false":"true",onclick:function(){S.tblHol=false;render();}},"שבתות וחגים"),
h("button",{cls:"pill"+(S.tblHol?" sel":""),"aria-pressed":S.tblHol?"true":"false",onclick:function(){S.tblHol=true;render();}},"חגים בלבד")),
h("div",{cls:"row"},h("div",{cls:"col0"},h("b",null,"הצג גם חלונות שעברו")),
sw(S.tblPast,"הצג גם חלונות שעברו",function(){S.tblPast=!S.tblPast;render();}))];
var year="";
var list=null;
rows.forEach(function(w){
var y=parts(w.s).year;
if(y!==year){year=y;out.push(h("h2",{cls:"yr"},y));list=h("div",{cls:"card tl"});out.push(list);}
var cur=w.s<=now&&now<w.e,skip=S.cfg&&S.cfg.skip===w.s;
list.appendChild(h("div",{cls:"tr"+(cur?" cur":"")+(w.k!==1?" hol":"")},
h("div",{cls:"col0 grow"},h("b",null,title(w.t)+" · "+wdate(w)+(cur?" · עכשיו":"")+(skip?" · מדולג":"")),
h("span",{cls:"s"},full(w.s)+" ← "+full(w.e))),
h("span",{cls:"s nowrap"},dur(w.e-w.s))));
});
if(!rows.length)out.push(h("span",{cls:"s"},"אין חלונות להצגה"));
return out;
}
function viewPreview(){
if(!S.prev)return h("div",{cls:"card"},"טוען…");
return[h("span",{cls:"s"},"כך הממסר יפעל בחלונות הקרובים, לפי ההגדרות הנוכחיות (גם לפני שמירה)."),
S.prev.map(function(w){
return h("div",{cls:"card col"},
h("div",{cls:"line sb"},h("b",null,title(w.t)+" · "+wdate(w)),h("span",{cls:"s"},KIND[w.k])),
h("span",{cls:"s"},full(w.s)+" ← "+full(w.e)),
w.skip?h("div",{cls:"warn"},"מדולג – הממסר לא יופעל בחלון זה"):null,
!w.skip&&!w.on.length?h("span",{cls:"s"},"אין הפעלות בחלון זה"):null,
w.on.map(function(o){
var names=o[2].split("+").map(function(n){var t=S.timers[+n-1];return!t?"#"+n:(t.a===0?"נרות":(t.a===2?"הבדלה":hhmm(t.m)));});
return h("div",{cls:"slot"},h("span",{cls:"tm"},hm(o[0])+"–"+hm(o[1])),
h("span",{cls:"grow"},day(o[0])+" · "+mm(Math.round((o[1]-o[0])/60))),h("span",{cls:"who"},names.join(" + ")));
}));
})];
}
var root=document.getElementById("app");
function render(){
var st=S.st;
var tabs=[["status","מצב"],["timers","טיימרים"],["preview","תחזית"],["table","לוח זמנים"]];
var relay=!st?"…":(st.relay?"ממסר: פועל":"ממסר: כבוי")+(st.test?" · בדיקה":"");
var body=S.tab==="status"?viewStatus():(S.tab==="timers"?viewTimers():(S.tab==="preview"?viewPreview():viewTable()));
var d=dirty();
var app=h("div",{cls:"app"},
h("header",null,
h("div",{cls:"line sb"},h("div",{cls:"col0"},h("h1",null,"מעלית שבת"),h("span",{cls:"s"},"Shelly · סקריפט "+ID)),
h("span",{cls:"relay"+(st&&st.relay?" on":"")},relay)),
h("div",{cls:"tabs",role:"tablist"},tabs.map(function(t){
return h("button",{role:"tab","aria-selected":S.tab===t[0]?"true":"false",cls:S.tab===t[0]?"sel":"",
onclick:function(){S.tab=t[0];if(t[0]==="preview")preview();render();}},t[1]);
}))),
S.err?h("div",{cls:"warn m"},"שגיאה: "+S.err):null,
h("main",null,body),
d?h("div",{cls:"bar"},h("span",null,"יש שינויים שלא נשמרו"),
h("div",{cls:"line"},
h("button",{cls:"btn ghost",onclick:function(){S.timers=JSON.parse(S.saved).map(toObj);S.editing=-1;render();preview();}},"בטל"),
h("button",{cls:"btn pri",onclick:function(){
rpc("ShabbatSet",{timers:draft()},function(j){S.saved=JSON.stringify(j.cfg.timers);S.editing=-1;S.flash="נשמר במכשיר ✓";load(j);preview();
setTimeout(function(){S.flash="";render();},2500);});}},"שמור במכשיר")))
:(S.flash?h("div",{cls:"bar ok",role:"status"},S.flash):null));
var y=window.scrollY;
root.replaceChildren(app);
window.scrollTo(0,y);
}
var css="body{margin:0;background:#F3F5F8;color:#16202A;font-family:Heebo,system-ui,-apple-system,'Segoe UI',Arial,sans-serif}"+
".app{max-width:560px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}"+
"header{background:#fff;border-bottom:1px solid #E2E6EC;padding:16px;display:flex;flex-direction:column;gap:12px;position:sticky;top:0;z-index:2}"+
"h1{margin:0;font-size:20px}main{flex:1;padding:16px 16px 96px;display:flex;flex-direction:column;gap:12px}"+
".s{font-size:13px;color:#4B5563}.line{display:flex;gap:8px;align-items:center}.sb{justify-content:space-between}.col0{display:flex;flex-direction:column;gap:2px;min-width:0}"+
".relay{font-size:13px;font-weight:500;border-radius:999px;padding:6px 12px;background:#EEF1F5;color:#374151;white-space:nowrap}.relay.on{background:#0F5132;color:#fff}"+
".tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;background:#EEF1F5;border-radius:10px;padding:4px}"+
".tabs button{height:38px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:13px;font-weight:500;color:#374151;cursor:pointer;padding:0 2px}"+
".tabs .sel{background:#fff;color:#16202A;font-weight:700;box-shadow:0 1px 2px rgba(22,32,42,.15)}"+
".card{background:#fff;border:1px solid #E2E6EC;border-radius:14px;padding:14px}.col{display:flex;flex-direction:column;gap:8px}.rows{padding:2px 14px}"+
".kv{display:flex;flex-direction:column;gap:2px}.k{font-size:13px;color:#4B5563}.v{font-size:16px;font-weight:500}.big{font-size:18px;font-weight:700}"+
"hr{border:0;border-top:1px solid #E2E6EC;margin:4px 0;width:100%}.row{display:flex;align-items:center;gap:12px;min-height:56px}.row .col0{flex:1}"+
".sw{width:52px;height:32px;flex-shrink:0;border-radius:16px;border:0;padding:3px;cursor:pointer;display:flex;justify-content:flex-end;align-items:center;background:#AEB7C4}"+
".sw.on{justify-content:flex-start;background:#1D4ED8}.sw span{width:26px;height:26px;border-radius:13px;background:#fff;display:block}"+
"input{font:inherit;font-size:16px;height:44px;box-sizing:border-box;border:1px solid #C9D0DA;border-radius:10px;padding:0 10px;background:#fff;color:#16202A}#tt{flex:1;min-width:0}"+
".btn{font:inherit;height:44px;padding:0 16px;border:1px solid #C9D0DA;border-radius:10px;background:#fff;color:#16202A;font-size:14px;cursor:pointer}"+
".btn.pri{background:#1D4ED8;border-color:#1D4ED8;color:#fff;font-weight:500}.btn.danger{border-color:#F1C4C4;color:#B42318}.btn.ghost{background:transparent;color:#fff;border-color:#5B6675}"+
".warn{font-size:13px;color:#92400E;background:#FEF3C7;border-radius:8px;padding:8px 10px}.m{margin:12px 16px 0}"+
".t{padding:0}.t>.row{padding:10px 14px}.t.edit{border-color:#1D4ED8}.t.off{opacity:.65}"+
".badge{flex-shrink:0;min-width:52px;text-align:center;font-size:12px;font-weight:700;border-radius:8px;padding:6px 8px}.b0{background:#FFF4E5;color:#8A4B00}.b1{background:#E6F0FF;color:#1E3A8A}.b2{background:#EFEAFE;color:#4C2A9E}"+
".tname{flex:1;min-width:0;text-align:right;background:none;border:0;padding:4px 0;cursor:pointer;display:flex;flex-direction:column;gap:2px;font:inherit;color:#16202A}"+
".ed{border-top:1px solid #E2E6EC;padding:14px;display:flex;flex-direction:column;gap:8px;background:#FAFBFC;border-radius:0 0 14px 14px}"+
".lab{font-size:13px;font-weight:500;color:#374151;margin-top:4px}.pills{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}"+
".pill{font:inherit;height:40px;border:1px solid #C9D0DA;border-radius:10px;background:#fff;color:#16202A;font-size:14px;cursor:pointer}.pill.sel{background:#1D4ED8;border-color:#1D4ED8;color:#fff;font-weight:500}"+
".step{display:flex;align-items:center;gap:8px}.step button{width:44px;height:44px;border:1px solid #C9D0DA;border-radius:10px;background:#fff;font-size:20px;color:#16202A;cursor:pointer}.step span{min-width:88px;text-align:center;font-size:16px;font-weight:500}"+
".addbtn{font:inherit;height:48px;border:1.5px dashed #9AA5B4;border-radius:14px;background:transparent;color:#1D4ED8;font-size:15px;font-weight:500;cursor:pointer}"+
".slot{display:flex;align-items:center;gap:10px;background:#EEF4FF;border-radius:8px;padding:8px 10px;font-size:13px}.slot .tm{font-size:14px;font-weight:500;color:#1E3A8A;direction:ltr;unicode-bidi:isolate}.slot .grow{flex:1;color:#374151}.slot .who{font-size:12px;color:#1E3A8A}"+
".bar{position:fixed;bottom:0;left:0;right:0;max-width:560px;margin:0 auto;box-sizing:border-box;background:#16202A;color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px}.bar.ok{background:#0F5132}"+
".pills.two{grid-template-columns:repeat(2,1fr)}.yr{font-size:15px;margin:8px 4px 0;color:#374151}"+
".tl{padding:0 14px}.tr{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #EEF1F5}.tr:first-child{border-top:0}"+
".tr .grow{flex:1}.tr b{font-size:14px;font-weight:500}.tr.hol b{color:#4C2A9E;font-weight:700}.tr.cur{background:#EEF4FF;margin:0 -14px;padding:10px 14px}.nowrap{white-space:nowrap}"+
".slot.offev{background:#F3F4F6}.slot.offev .tm{color:#374151}.drow{padding:4px 0;border-top:1px solid #EEF1F5}.dv{font-size:13px;text-align:left;direction:ltr;unicode-bidi:isolate;word-break:break-all}.warn.col{display:flex;flex-direction:column;gap:6px}"+
"button:focus-visible,input:focus-visible{outline:2px solid #1D4ED8;outline-offset:2px}";
document.head.appendChild(h("style",null,css));
document.title="מעלית שבת";
render();
refresh();
preview();
setInterval(refresh,15000);
})();
