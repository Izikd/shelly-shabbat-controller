// Shabbat Elevator - built by tools/build.py
let CFG={
switchId:0,
tickMs:15000,
failState:false,
kvsKey:"shabbat_elev_cfg",
logKey:"shabbat_elev_log",
logMax:15,
tag:"shabbat",
maxTimers:12,
debug:false,
diag:false
};
let DEFAULT_TIMERS=[[0,15,30,0,0,1],[1,720,60,0,0,1],[2,-40,40,0,0,1]];
let TBL_BASE=1735689600;
let TBL_T=["Shabbat","Pesach + Shabbat","Pesach VII + Shabbat","Shavuot","Rosh Hashana","Yom Kippur","Sukkot","Simchat Torah","Pesach","Pesach VII","Shavuot + Shabbat","Rosh Hashana + Shabbat","Sukkot + Shabbat","Simchat Torah + Shabbat","Yom Kippur + Shabbat"];
let TBL="AA6kAXaAADYJAXbAAF1vAXaAAITWAXZAAKw8AXZAANOjAXYAAPsJAXYAASJvAXYAAUnVAXYAAXE7AXXAAZigAXXAAcAFAXXAAedqAXXAAg7OAXYAAjYzAt4BAl2YAXYCAoT8AXZAAqxhAXaAAtPGAXbAAvsrAXbAAyKQAXcAA0n1AXcAA1U2AXcDA3FZAXcAA5i8AXdAA8AeAXdAA+eAAXcABA7gAXcABDY-AXcABF2dAXbABIT6AXaABKxVAXZABNOvAXZABPsJAXXABSJhAXXABUm5AXWABXEQAXWABZhnAXVABb++AXVABdCaAtzEBecUAXVABgMuAXUFBg5rAXVABh9HAXVGBjXCAXVABkaeAXWHBl0aAXVABoRyAXWABqvLAXWABtMlAXXABvqAAXYAByHdAXYAB0k7AXYAB3CaAXZAB5f6AXaAB79cAXaAB+a-AXbACA4jAXbACDWJAXaACFzuAXaACIRVAXZACKu7AXZACNMiAXZACPqIAXZACSHvAXXACUlVAXXACXC6AXXACZgfAXXACb+EAXXACebpAXXACgMMAXYICg5OAXXACiTQAXYJCjWyAXYACl0XAXYACoR8AXYACqvhAXZACtNGAXaACvqrAXaACxxvAt8KC0l0AXcAC3DYAXdAC5g7AXdAC7+eAXdAC+cAAXcADA5gAXcADDW-AXcADF0dAXbADIR6AXaADKvWAXZADNMwAXZADPqKAXXADSHiAXXADUk6AXWADXCRAXWADZfoAt0LDb8-AXVADcp8AXVFDeaWAXUMDg3sAXVNDjVDAXVADlybAXVADoPzAXWADqtMAXWADtKmAXXADvoBAXXADyFdAXYAD0i7AXZAD3AaAXZAD5d6AXaAD77cAXaAD+Y-AXaAEA2jAXaAEDUIAXaAEFxuAXaAEIPUAXZAEKs6AXaAENKhAXZAEPoIAXYAESFuAXXAEUjUAXXAEXA5AXXAEZefAXWAEb8EAXWAEeZoAXXAEg3NAXXAEjUyAXXAElyWAXYAEni6AXYIEoP7AXZAEpp+AXZJEqtgAXZAEtLFAXaAEvoqAXbAEyGPAXbAE0jzAXcAE3BXAXdAE5IbAt9KE78eAXdAE+aAAXcAFA3gAXcAFDVAAXbAFFyeAXbAFIP7AXaAFKtXAXZAFNKxAXZAFPoLAXYAFSFjAXXAFUi7AXXAFXATAXWAFZdqAXVAFb7AAXVAFeYXAXVAFg1uAtzLFjTFAXVAFkACAXVFFlwcAXVMFoN0AXWNFqrNAXWAFtInAXWAFvmCAXXAFyDeAXYAF0g7AXZAF2+aAXZAF5b6AXaAF75bAXbAF+W+AXbAGA0iAXaAGDSHAXaAGFvtAXaAGINTAXaAGKq5AXaAGNIgAXZAGPmHAXYAGSDtAXYAGUhTAXXAGW+5AXXAGZceAXXAGb6DAXXAGeXoAXXAGg1MAXYAGjSxAXXAGkWTAXYIGlwWAXYAGmdXAXYJGoN6AXZAGqrfAXZAGtJEAXaAGvmpAXbAGyEOAXbAG0hzAXcAG171AXcDG2-XAXcAG5c7AXcAG76dAXdAG+X-AXdAHA1gAXdAHDTAAXcAHFweAXbAHIN7AXbAHKrXAXaAHNIyAXZAHPmMAXYAHSDlAXXAHUg9AXWAHW+UAXWAHZbrAXVAHb5CAXVAHdpbBESLHgzvAXVOHikIAXVGHjRGAXVAHlBgAXVHHludAXVAHoL1AXWAHqpOAXWAHtGnAXXAHvkCAXYAHyBeAXYAH0e7AXZAH28aAXZAH5Z6AXaAH73bAXaAH+U+AXaAIAyhAXbAIDQFAXbAIFtrAXaAIILRAXaAIKo4AXZAINGeAXZAIPkFAXYAISBrAXYAIUfRAXYAIW83AXXAIZacAXXAIb4BAXXAIeVmAXXAIgzLAXXBIi6PAt4CIluUAXYAIoL5AXYAIqpeAXZAItHDAXZAIvkoAXaAIyCNAt8KI0fxAXcAI29WAXcAI5a6AXcAI74dAXcAI+V-AXdAJAzgAXdAJDRAAXcAJFufAXbAJIL8AXbAJKpYAXaAJNG0AXZAJPkOAXYAJSBnAXXAJUe-AXXAJW8XAXWAJZZuAXVAJaGrAt0EJb3EAXWAJdQ-AXVFJeUbAXVAJfBYAXVGJgxyAXUAJhevAXVHJjPIAXVAJlsgAXVAJoJ3AXWAJqnQAXWAJtEpAXXAJviEAXXAJx-fAXYAJ0c8AXYAJ26aAXZAJ5X6AXZAJ71bAXaAJ+S9AXaAKAwgAXbAKDOFAXaAKFrqAXaAKIJQAXaAKKm3AXZAKNEdAXZAKPiEAXYAKR-qAXYAKUdQAXYAKW62AXXAKZYcAXXAKb2BAXXAKeTmAXXAKgxKAXXAKjOvAXXAKlsUAXXAKnc3AXYIKoJ4AXZAKpj7AXZJKqndAXZAKtFCAXaAKvinAXaAKyAMAXbAK0dxAXbAK27VAXcAK5CZAt9KK72cAXdAK+T-AXcALAxgAXcALDPAAXcALFsfAXbALIJ9AXaALKnZAXaALNE0AXZALPiPAXYALR-oAXXALUdAAXXALW6YAXWALZXvAXVALb1GAXVALeScAXVALgvzAtzLLjNKAXVALj6HAXVFLlqhAXVMLoH4AXWNLqlRAXWALtCqAXWALvgEAXXALx9gAXXAL0a8AXZAL24aAXZAL5V6AXZAL7zaAXaAL+Q8AXbAMAugAXaA";
let TBL_STD=7200;
let TBL_DST=[1743120000,1761433200,1774569600,1792882800,1806019200,1824937200,1837468800,1856386800,1868918400,1887836400,1900972800,1919286000,1932422400,1950735600];
let ALPHA="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-";
let TBL_N=TBL.length/8;
let cfg=null;
let testTime=0;
let saving=false,saveDirty=false;
let lastWanted=null;
let lastWindowIdx=-2;
let status={};
let manualHold=null;
let lastOut=null;
let lastUntil=0;
let logArr=[];
let logSaving=false,logDirty=false;
function dbg(a,b){
if(CFG.debug)console.log("[dbg]",a,b===undefined?"":b);
}
let sysOffset=7200;
function tzOffset(t){
if(t<TBL_BASE||t>=TBL_DST[TBL_DST.length-1]+86400*150)return sysOffset;
for(let i=0;i<TBL_DST.length;i+=2){
if(t>=TBL_DST[i]&&t<TBL_DST[i+1])return TBL_STD+3600;
}
return TBL_STD;
}
function localToUtc(localSecs){
let u=localSecs-TBL_STD;
if(u<TBL_BASE||u>=TBL_DST[TBL_DST.length-1]+86400*150)return localSecs-sysOffset;
for(let i=0;i<TBL_DST.length;i+=2){
if(u-3600>=TBL_DST[i]&&u-3600<TBL_DST[i+1])return u-3600;
}
return u;
}
function pad2(n){return(n<10?"0":"")+n;}
function fmtTime(t){
let l=t+tzOffset(t);
let mins=Math.floor((l%86400)/60);
return pad2(Math.floor(mins/60))+":"+pad2(mins%60);
}
function dec(pos,width){
let n=0;
for(let i=0;i<width;i++)n=n*64+ALPHA.indexOf(TBL.charAt(pos+i));
return n;
}
function getWin(i){
if(i<0||i>=TBL_N)return null;
let p=i*8;
let s=TBL_BASE+dec(p,4)*60;
let title=TBL_T[ALPHA.indexOf(TBL.charAt(p+7))];
let k=2;
if(title==="Shabbat")k=1;
else if(title.indexOf("Shabbat")>=0)k=3;
return{i:i,s:s,e:s+dec(p+4,3)*60,title:title,k:k};
}
function findWin(t){
let lo=0,hi=TBL_N;
while(lo<hi){
let mid=(lo+hi)>>1;
let w=getWin(mid);
if(w.e<=t)lo=mid+1;else hi=mid;
}
return lo;
}
function pushClipped(list,s,e,w,label){
if(s<w.s)s=w.s;
if(e>w.e)e=w.e;
if(e<=s)return;
let i=list.length;
list.push(null);
while(i>0&&list[i-1].s>s){list[i]=list[i-1];i--;}
list[i]={s:s,e:e,l:label};
}
function windowPlan(w,tl){
let list=[];
let ls=w.s+tzOffset(w.s);
let le=w.e+tzOffset(w.e);
let d0=Math.floor(ls/86400);
let d1=Math.floor(le/86400);
let nDays=d1-d0;
for(let i=0;i<tl.length;i++){
let v=tl[i];
if(!v[5]||v[2]<=0)continue;
if(v[3]===1&&w.k===2)continue;
if(v[3]===2&&w.k===1)continue;
let lab=""+(i+1);
let a=w.s;
if(v[0]===0){a=w.s+v[1]*60;pushClipped(list,a,a+v[2]*60,w,lab);continue;}
if(v[0]===2){a=w.e+v[1]*60;pushClipped(list,a,a+v[2]*60,w,lab);continue;}
for(let d=d0-1;d<=d1;d++){
let k=d-d0;
if(v[4]===1&&k>1)continue;
if(v[4]===2&&k!==nDays)continue;
a=localToUtc(d*86400+v[1]*60);
pushClipped(list,a,a+v[2]*60,w,lab);
}
}
let out=[];
for(let j=0;j<list.length;j++){
let x=list[j];
let last=out.length?out[out.length-1]:null;
if(last&&x.s<=last.e){
if(x.e>last.e)last.e=x.e;
if(("+"+last.l+"+").indexOf("+"+x.l+"+")<0)last.l+="+"+x.l;
}else{
out.push({s:x.s,e:x.e,l:x.l});
}
}
return out;
}
function validTimer(v){
if(!v||v.length!==6)return false;
for(let i=0;i<6;i++)if(typeof v[i]!=="number"||v[i]!==Math.floor(v[i]))return false;
if(v[0]<0||v[0]>2||v[2]<0||v[2]>240||v[3]<0||v[3]>2||v[4]<0||v[4]>2)return false;
if(v[0]===0&&(v[1]<0||v[1]>180))return false;
if(v[0]===1&&(v[1]<0||v[1]>1439))return false;
if(v[0]===2&&(v[1]<-180||v[1]>0))return false;
return v[5]===0||v[5]===1;
}
function validTimers(tl){
if(!tl||typeof tl.length!=="number"||tl.length>CFG.maxTimers)return false;
for(let i=0;i<tl.length;i++)if(!validTimer(tl[i]))return false;
return true;
}
function onKvsSaved(res,err,msg){
saving=false;
if(err)console.log("KVS save failed:",err,msg);
if(saveDirty)saveCfg();
}
function saveCfg(){
if(saving){saveDirty=true;return;}
saving=true;saveDirty=false;
Shelly.call("KVS.Set",{key:CFG.kvsKey,value:JSON.stringify(cfg)},onKvsSaved);
}
let tickQueued=false;
let replyQ=[];
function tickFromTimer(){
tickQueued=false;
tick();
let q=replyQ;
replyQ=[];
for(let i=0;i<q.length;i++)q[i].result(snapshot());
}
function kickTick(){
if(tickQueued)return;
tickQueued=true;
Timer.set(50,false,tickFromTimer);
}
function getNow(){
let sys=Shelly.getComponentStatus("sys");
if(sys&&typeof sys.utc_offset==="number")sysOffset=sys.utc_offset;
if(testTime)return testTime;
if(!sys||!sys.unixtime)return 0;
return Math.floor(sys.unixtime);
}
function onSwitchSet(res,err,msg){
if(err){console.log("Switch.Set failed:",err,msg);lastWanted=null;}
}
function onLogSaved(res,err){
logSaving=false;
if(logDirty)saveLog();
}
function saveLog(){
if(logSaving){logDirty=true;return;}
logSaving=true;logDirty=false;
let str="";
for(let i=0;i<logArr.length;i++)str+=(i?",":"")+logArr[i];
Shelly.call("KVS.Set",{key:CFG.logKey,value:str},onLogSaved);
}
function addLog(on,cause){
let sys=Shelly.getComponentStatus("sys");
let ts=sys&&sys.unixtime?Math.floor((sys.unixtime-TBL_BASE)/60):0;
logArr.push(""+ts+(on?"1":"0")+cause);
if(logArr.length>CFG.logMax)logArr=logArr.slice(logArr.length-CFG.logMax);
saveLog();
}
function applyRelay(on,until,cause){
let st=Shelly.getComponentStatus("switch",CFG.switchId);
if(!st)return;
if(lastOut!==null&&st.output!==lastOut){
let byTimer=st.source==="timer";
addLog(st.output,byTimer?"t":"m");
if(!byTimer&&st.output!==on&&manualHold===null){
manualHold=on;
console.log("Manual switch detected - holding until the next timer event");
}
}
lastOut=st.output;
if(manualHold!==null){
if(on===manualHold)return;
manualHold=null;
}
let p={id:CFG.switchId,on:on,tag:CFG.tag};
let auto=on&&until>0&&!testTime;
if(auto)p.toggle_after=until-getNow()+5;
let needSet=st.output!==on||(auto&&until!==lastUntil);
if(lastWanted!==on)console.log("Relay ->",on?"ON":"OFF");
lastWanted=on;
lastUntil=auto?until:0;
if(!needSet)return;
if(st.output!==on){addLog(on,cause);lastOut=on;}
Shelly.call("Switch.Set",p,onSwitchSet);
}
function winInfo(w){return w?{t:w.title,k:w.k,s:w.s,e:w.e}:null;}
function tick(){
if(!cfg)return;
let t=getNow();
let auto=cfg.a!==0;
let sw=Shelly.getComponentStatus("switch",CFG.switchId);
status={now:t,test:testTime,synced:t>0,auto:auto,relay:sw?sw.output:null,
on:null,cur:null,next:null,nextOn:null,end:getWin(TBL_N-1).e};
if(!t){
if(auto){applyRelay(CFG.failState,0,"f");status.relay=CFG.failState;}
return;
}
let idx=findWin(t);
let w=getWin(idx);
let cur=(w&&w.s<=t)?w:null;
let nxt=cur?getWin(idx+1):w;
status.cur=winInfo(cur);
status.next=winInfo(nxt);
if((cur?cur.i:-1)!==lastWindowIdx){
lastWindowIdx=cur?cur.i:-1;
console.log(cur?"Entered window: "+cur.title:"No Shabbat/Yom Tov window",testTime?"[TEST TIME]":"");
}
let on=null,upcoming=null;
let pw=[cur,nxt,getWin(idx+(cur?2:1))];
for(let k=0;k<3&&!upcoming&&!on;k++){
if(!pw[k]||pw[k].s===cfg.s)continue;
let plan=windowPlan(pw[k],cfg.t);
for(let i=0;i<plan.length;i++){
let p=plan[i];
if(p.s<=t&&t<p.e){on=p;break;}
if(p.s>t){upcoming=p;break;}
}
}
if(on)status.on=[on.s,on.e,on.l];
if(upcoming)status.nextOn=[upcoming.s,upcoming.e,upcoming.l];
dbg("tick "+fmtTime(t),!!on);
if(auto){
applyRelay(!!on,on?on.e:0,testTime?"x":"a");
status.relay=manualHold!==null?lastOut:!!on;
}else lastWanted=null;
status.manual=manualHold!==null;
}
function snapshot(){
let lg="";
for(let i=0;i<logArr.length;i++)lg+=(i?",":"")+logArr[i];
return{cfg:{timers:cfg.t,auto:cfg.a!==0,skip:cfg.s},st:status,log:lg,base:TBL_BASE};
}
function doGet(req,params){
params=params||{};
if(!cfg){req.error(-1,"starting");return;}
req.result(snapshot());
}
function doSet(req,params){
params=params||{};
if(!cfg){req.error(-1,"starting");return;}
let changed=false;
if(params.timers!==undefined){
if(!validTimers(params.timers)){req.error(-1,"invalid timers");return;}
cfg.t=params.timers;changed=true;
}
if(params.auto!==undefined){cfg.a=params.auto?1:0;changed=true;}
if(params.skip!==undefined){
let w=getWin(findWin(getNow()||TBL_BASE));
cfg.s=params.skip&&w?w.s:0;
changed=true;
}
if(params.resume){manualHold=null;lastWanted=null;lastOut=null;}
if(params.test!==undefined){
let tt=Math.floor(params.test||0);
testTime=tt>0?tt:0;
lastWanted=null;
}
if(changed){
let js=JSON.stringify(cfg);
if(js.length>250){req.error(-1,"too many timers");return;}
saveCfg();
}
replyQ.push(req);
kickTick();
}
function doPreview(req,params){
params=params||{};
if(!cfg){req.error(-1,"starting");return;}
let tl=cfg.t;
if(params.timers!==undefined){
if(!validTimers(params.timers)){req.error(-1,"invalid timers");return;}
tl=params.timers;
}
let n=Math.floor(params.n||6);
if(n<1)n=1;
if(n>8)n=8;
let t=getNow()||TBL_BASE;
let from=params.from?Math.floor(params.from):t;
let idx=findWin(from);
let out=[];
for(let k=0;k<n;k++){
let w=getWin(idx+k);
if(!w)break;
let skip=w.s===cfg.s;
let on=[];
if(!skip){
let plan=windowPlan(w,tl);
for(let i=0;i<plan.length;i++)on.push([plan[i].s,plan[i].e,plan[i].l]);
}
out.push({t:w.title,k:w.k,s:w.s,e:w.e,skip:skip,on:on});
}
req.result({w:out,now:t});
}
let rq=[];
function runQueue(){
let x=rq[0];
rq=rq.slice(1);
try{x[0](x[1],x[2]);}catch(e){x[1].error(-1,""+e);}
if(rq.length)Timer.set(20,false,runQueue);
}
function enqueue(fn,req,params){
if(rq.length>=4){req.error(-1,"busy");return;}
rq.push([fn,req,params||{}]);
if(rq.length===1)Timer.set(20,false,runQueue);
}
function onRpcGet(req,params){enqueue(doGet,req,params);}
function onRpcSet(req,params){enqueue(doSet,req,params);}
function onRpcPreview(req,params){enqueue(doPreview,req,params);}
let UI_A='<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">'+
'<meta name="viewport" content="width=device-width,initial-scale=1"><title>מעלית שבת</title></head>'+
'<body style="font-family:system-ui,sans-serif"><div id="app">טוען…</div><script>window.SE_ID=';
let UI_B=';(async function(){try{'+
'let l=await (await fetch("/rpc/Script.List")).json();'+
'let u=l.scripts.find(function(s){return s.name==="shabbat_ui"});'+
'if(!u)throw new Error("script shabbat_ui not found");'+
'let c="",o=0,te=new TextEncoder();for(;;){let r=await (await fetch("/rpc/Script.GetCode?id="+u.id+"&offset="+o)).json();'+
'c+=r.data;o+=te.encode(r.data).length;if(!r.left||!r.data.length)break;}'+
'new Function(c)();}catch(e){document.getElementById("app").textContent="UI load failed: "+e.message;}})();'+
'</script></body></html>';
let UI_HTML="";
function onUi(req,res){
res.code=200;
res.headers=[["Content-Type","text/html; charset=utf-8"],["Cache-Control","no-store"]];
res.body=UI_HTML;
res.send();
}
function mem(stage){
if(!CFG.diag)return;
let s=Shelly.getComponentStatus("script",Shelly.getCurrentScriptId());
console.log("[diag]",stage,s?"mem_used="+s.mem_used+" mem_peak="+s.mem_peak+" mem_free="+s.mem_free:"");
}
let bootLoaded=null;
let bootStep=0;
let BOOT=[
function(){
let c=bootLoaded;
if(c&&validTimers(c.t))cfg={t:c.t,a:c.a===0?0:1,s:c.s||0};
else{cfg={t:DEFAULT_TIMERS,a:1,s:0};console.log("Using default timers");}
},
function(){
let id=Shelly.getCurrentScriptId();
UI_HTML=UI_A+id+UI_B;
HTTPServer.registerEndpoint("ui",onUi);
Script.addRpcHandler("ShabbatGet",onRpcGet);
Script.addRpcHandler("ShabbatSet",onRpcSet);
Script.addRpcHandler("ShabbatPreview",onRpcPreview);
},
tick,
function(){
Timer.set(CFG.tickMs,true,tick);
console.log("Shabbat Elevator started. Windows:",TBL_N,"UI: /script/"+Shelly.getCurrentScriptId()+"/ui");
}
];
function bootNext(){
if(bootStep>=BOOT.length){mem("boot done");return;}
if(CFG.diag)console.log("[diag] boot step",bootStep);
BOOT[bootStep]();
bootStep++;
mem("after step "+(bootStep-1));
Timer.set(CFG.diag?1000:50,false,bootNext);
}
function onKvsLoaded(res,err,msg){
mem("kvs loaded");
if(!err&&res&&typeof res.value==="string"){
try{bootLoaded=JSON.parse(res.value);}catch(e){console.log("Bad saved config, using defaults");}
}
Shelly.call("KVS.Get",{key:CFG.logKey},onLogLoaded);
}
function onLogLoaded(res,err){
if(!err&&res&&typeof res.value==="string"&&res.value.length)logArr=res.value.split(",");
Timer.set(50,false,bootNext);
}
let VC_TYPES=["enum","number","text","boolean","button","group"];
let toDelete=[];
function scanComponents(){
for(let t=0;t<VC_TYPES.length;t++){
for(let id=200;id<230;id++){
if(Shelly.getComponentConfig(VC_TYPES[t],id))toDelete.push(VC_TYPES[t]+":"+id);
}
}
if(toDelete.length)console.log("Removing virtual components:",toDelete.length);
Timer.set(50,false,cleanNext);
}
function onVcDeleted(res,err,msg){
if(err)console.log("Virtual.Delete failed:",msg);
Timer.set(50,false,cleanNext);
}
function cleanNext(){
if(toDelete.length){Shelly.call("Virtual.Delete",{key:toDelete.pop()},onVcDeleted);return;}
Shelly.call("KVS.Get",{key:CFG.kvsKey},onKvsLoaded);
}
mem("parsed");
scanComponents();
