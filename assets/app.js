
/* =====================================================================
   CONFIG — links shown on the home page. Leave a URL empty to hide it.
   Twitch Client ID is only needed for "Connect Twitch" (see setup panel).
   ===================================================================== */
const CONFIG = {
  channel: "badge_db",
  socials: {
    twitch:  "https://twitch.tv/badge_db",
    x:       "https://x.com/BadgeDatabase",
    discord: "https://discord.gg/QkuRDXcZH5",
    reddit:  "",
  },
  clientId: "",
  repo: "davidpzsny/badgedb",        // used by the #admin page to save events.json
};

/* =====================================================================
   EVENTS — edit when a new drop is announced.
   img = Twitch CDN id (between /badges/v1/ and /3). start/end UTC ISO.
   cost: "free" | "paid" | "na"
   ===================================================================== */
const cdn = id => id ? `https://static-cdn.jtvnw.net/badges/v1/${id}/3` : "";
const SUB = "Subscribe (Tier 1) or gift a Tier 1 sub in the category.";
let EVENTS = [];

/* =====================================================================
   BADGES — snapshot of every Twitch global badge set.
   Format per row: [title, image id, added (YYYY-MM-DD or ""), free (1/0), users]
   ===================================================================== */
let BADGES = [];

/* ---------- helpers ---------- */
if(location.protocol==="http:" && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) location.replace("https://"+location.host+location.pathname+location.hash);
const PARENTS = () => [location.hostname, location.hostname.replace(/^www\./,''), 'www.'+location.hostname.replace(/^www\./,'')].filter((v,i,a)=>a.indexOf(v)===i).map(x=>'parent='+x).join('&');
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const initials = n => n.split(/\s+/).slice(0,2).map(w=>w[0]||"").join("").toUpperCase();
const tile = b => `<span class="tile">${b.img ? `<img src="${esc(b.img)}" alt="${esc(b.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'${esc(initials(b.name))}'}))">` : `<span class="ph">${esc(initials(b.name))}</span>`}</span>`;
const fmt = iso => iso ? new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : "";
const fmtFull = iso => iso ? new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : "Not announced";
const num = n => n.toLocaleString();
const toast = m => { const t=$('#toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); };
const status = ev => { if(!ev.start) return "tba"; const n=Date.now(); if(n<Date.parse(ev.start)) return "soon"; if(n>Date.parse(ev.end)) return "ended"; return "live"; };
function countdown(iso){ let d=Math.max(0,Date.parse(iso)-Date.now()); const days=Math.floor(d/864e5); d-=days*864e5; const h=Math.floor(d/36e5); d-=h*36e5; const m=Math.floor(d/6e4), s=Math.floor((d%6e4)/1e3); return days?`${days}d ${h}h ${m}m`:`${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`; }
const evCost = ev => ev.badges.some(b=>b.cost==="free")?"free":ev.badges.some(b=>b.cost==="paid")?"paid":"na";

// event lookup by image id → objective + status for the archive drawer
let EV_BY_IMG = {};
function indexEvents(){ EV_BY_IMG = {}; EVENTS.forEach(ev => ev.badges.forEach(b => { if(b.img) EV_BY_IMG[b.img] = {ev, b}; })); }
indexEvents();

// normalized archive rows
// rows: [title, img, added, free, users, set?] — several rows can belong to one set (versions); group them
const JUNK = /beta_title|_beta$|^beta$|placeholder|default-creator-campaign/i;
function normalize(rows){
  const groups = new Map();
  rows = rows.filter(r => !JUNK.test(r[0]) && !JUNK.test(r[5]||""));
  rows.forEach(r => { const key = r[5] || r[1]; if(!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
  return [...groups.entries()].map(([key, rs]) => {
    const p = rs[rs.length-1];                       // the bot prepends new rows, so the original set row is last
    const vs = [...rs].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}));  // natural order (cheer 1, 100, 1000…)
    const dated = rs.map(x=>x[2]).filter(Boolean);
    return { set:key, name:p[0], img:cdn(p[1]), imgId:p[1], added:p[2] || (dated.length && dated.length===rs.length ? dated.sort()[0] : ""),
             free:rs.some(x=>x[3]===1), users:Math.max(...rs.map(x=>x[4]||0)), how:p[6]||"",
             versions: vs.map((x,i)=>({ id:String(i+1), title:x[0], img:cdn(x[1]) })) };
  });
}
let globalBadges = normalize(BADGES);
let READY = false, CH_READY = false;   // true once badges.json + events.json are loaded
let channelBadges = [], lookupBadges = [], token = null;
const CTYPE = {sub:"Sub badge", watch:"Watch badge", ranking:"Top supporter", other:"Campaign"};
// channel-badges.json rows: [title, img, first_seen, login, display, set_id, type]
const normChannel = rows => rows.map(r => ({ set:r[1], name:r[0], img:cdn(r[1]), imgId:r[1], added:r[2], login:r[3], display:r[4], setId:r[5], type:r[6], versions:[{id:"1",title:r[0],img:cdn(r[1])}] }));
try{ CONFIG.clientId = CONFIG.clientId || localStorage.getItem("badgedb_client_id") || ""; }catch(_){}
const isFile = location.protocol === "file:";
const redirectUri = () => location.origin + location.pathname;

/* ---------- routing (real URLs, no #) ---------- */
const PATHS = {"/":"home","/timeline/":"timeline","/badges/":"global","/channel/":"channel","/faq/":"faq","/privacy/":"privacy","/terms/":"terms","/admin/":"admin"};
const LEGACY = {home:"/",timeline:"/timeline/",global:"/badges/",channel:"/channel/",faq:"/faq/",privacy:"/privacy/",terms:"/terms/",admin:"/admin/"};
function pathKey(){ let p = location.pathname.replace(/index\.html$/,''); if(!p.endsWith('/')) p += '/'; return p; }
// old #links keep working: /#global -> /badges/, /#badge/x -> /badges/x/
(function legacyRedirect(){
  const h = decodeURIComponent(location.hash.slice(1)); if(!h || h === 'main') return;
  const p = LEGACY[h] || (h.startsWith('badge/') ? '/badges/'+encodeURIComponent(h.slice(6))+'/' : h.startsWith('channel-badge/') ? '/channel/'+encodeURIComponent(h.slice(14))+'/' : null);
  if(p) history.replaceState(null, '', p);
})();
function navigate(url){ if(url !== location.pathname) history.pushState(null, '', url); route(); }
function route(){
  const p = pathKey(); let h = PATHS[p], m, set = null;
  if(!h && (m = p.match(/^\/badges\/([^/]+)\/$/))){ set = decodeURIComponent(m[1]); if(READY) renderBadgePage(set); h = "badge"; }
  else if(!h && (m = p.match(/^\/channel\/([^/]+)\/$/))){ if(channelBadges.length) renderChannelBadgePage(decodeURIComponent(m[1])); h = "badge"; }
  if(!h) h = "home";
  if(h==="admin"){ renderAdmin(); if(ADM.token && !ADM.events.length) admLoad(); }
  $$('[data-page]').forEach(s => s.hidden = s.dataset.page !== h);
  const TITLES = {home:"Badge Database – Every Twitch Badge & When to Get It", timeline:"Timeline – Twitch Badges Available Now | Badge Database",
    global:"All Twitch Global Badges | Badge Database", channel:"Twitch Channel Badges | Badge Database", faq:"FAQ – Twitch Badges | Badge Database",
    privacy:"Privacy Policy | Badge Database", terms:"Terms of Service | Badge Database", admin:"Admin | Badge Database"};
  if(h==="badge"){ const bb = set && globalBadges.find(x=>x.set===set); if(bb) document.title = bb.name+" – Twitch Badge | Badge Database"; }
  else document.title = TITLES[h] || TITLES.home;
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.route === h));
  closeDrawer();
}
window.addEventListener('popstate', route);
// in-site links: no full page reload
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="/"]');
  if(!a || a.target === '_blank' || a.hasAttribute('download') || e.defaultPrevented) return;
  if(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
  if(a.closest('[data-ver]') || a.hasAttribute('data-ver')) return;          // version switcher handles itself
  e.preventDefault(); if(typeof setMenu === 'function') setMenu(false);
  navigate(a.getAttribute('href')); window.scrollTo({top:0});
});

/* ---------- home ---------- */
function renderHome(){
  const S = CONFIG.socials;
  const defs = [
    ["TWITCH",S.twitch,"#9146FF",'<svg viewBox="0 0 24 24"><path d="M4 2 2 6v14h5v3h3l3-3h4l5-5V2H4zm16 12-3 3h-5l-3 3v-3H6V4h14v10zm-4-7h-2v5h2V7zm-5 0H9v5h2V7z"/></svg>'],
    ["DISCORD",S.discord,"#5865F2",'<svg viewBox="0 0 24 24"><path d="M19.5 5.5A16 16 0 0 0 15.6 4l-.5 1a15 15 0 0 0-6.2 0l-.5-1a16 16 0 0 0-3.9 1.5C2 9.3 1.3 13 1.6 16.6A16 16 0 0 0 6.5 19l1-1.6a10 10 0 0 1-1.6-.8l.4-.3a11.5 11.5 0 0 0 11.4 0l.4.3-1.6.8 1 1.6a16 16 0 0 0 4.9-2.4c.4-4.2-.7-7.8-2.9-11.1zM8.7 14.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>'],
    ["X",S.x,"#E5E7EB",'<svg viewBox="0 0 24 24"><path d="M17.5 3h3l-7 8 8 10h-6l-4.7-6.2L5.5 21h-3l7.5-8.6L2.5 3h6l4.3 5.7z"/></svg>'],
  ].filter(d=>d[1]);
  $('#socials').innerHTML = defs.map(([n,u,c,svg])=>`<a class="social" style="--c:${c}" href="${esc(u)}" target="_blank" rel="noopener"><span class="ic" ${n==='X'?'style="color:#111"':''}>${svg}</span><span><b>${n}</b><small>${esc(u.replace(/^https?:\/\/(www\.)?/,''))}</small></span><span class="go">↗</span></a>`).join('');

  const live = EVENTS.filter(e=>status(e)==="live");
  const soon = allEvents().filter(e=>["soon","tba"].includes(status(e)) && !isStale(e));
  $('#sLive').textContent = live.reduce((n,e)=>n+e.badges.length,0);
  $('#sSoon').textContent = soon.length;
  $('#sFree').textContent = live.reduce((n,e)=>n+e.badges.filter(b=>b.cost==="free").length,0);
  $('#cEvents').textContent = live.length; $('#cGlobal').textContent = globalBadges.length; $('#hArchive').textContent = globalBadges.length;


  // embedded stream (Twitch only allows the player on http(s) with a matching parent)
  if(!$('#homeStream').dataset.done){ $('#homeStream').dataset.done=1;
    $('#homeStream').innerHTML = isFile
      ? `<div class="sc-off"><img src="/logo-192.png" alt="">The player appears here once the site is hosted (http/https).<a class="btn" href="https://twitch.tv/${CONFIG.channel}" target="_blank" rel="noopener">Watch on Twitch ↗</a></div>`
      : `<iframe src="https://player.twitch.tv/?channel=${CONFIG.channel}&${PARENTS()}&muted=true&autoplay=true" allowfullscreen allow="autoplay; fullscreen"></iframe>`; }

  // recently added badges from the archive
  const recent = [...globalBadges].filter(b=>b.added).sort((a,b)=>b.added.localeCompare(a.added)).slice(0,8);
  $('#recent').innerHTML = recent.map(b=>`<a class="rc" href="/badges/${encodeURIComponent(b.set)}/" data-badge="${esc(b.set)}" data-type="global">${tile(b)}<span class="n">${esc(b.name)}</span><span class="d">${fmt(b.added)}</span></a>`).join('');

  const strip = list => list.slice(0,6).map(b=>`<img src="${esc(b.img)}" alt="" loading="lazy">`).join('') + (list.length>6?`<span class="more">+${list.length-6}</span>`:'');
  const evBadges = live.flatMap(e=>e.badges.filter(b=>b.img).map(b=>({img:cdn(b.img)})));
  $('#tools').innerHTML = `
    <a class="tool" href="/badges/"><h3>Twitch Global Badges</h3><p>Badges that look the same in every channel — ${globalBadges.length} sets.</p><div class="strip">${strip(globalBadges)}</div><span class="arrow">→</span></a>
    <a class="tool" href="/timeline/"><h3>Timeline</h3><p>Current and upcoming Twitch badge events with countdowns.</p><div class="strip">${strip(evBadges)}</div><span class="arrow">→</span></a>
    <a class="tool" href="/channel/"><h3>Twitch Channel Badges</h3><p>Campaign badges from live channels — sub, watch-time and top-supporter.</p><div class="strip"><img src="${cdn('5d9f2208-5dd8-11e7-8513-2ff4adfae661')}" alt=""><img src="${cdn('73b5c3fb-24f9-4a82-a852-2f475b59411c')}" alt=""><img src="${cdn('511b78a9-ab37-472f-9569-457753bbe7d3')}" alt=""></div><span class="arrow">→</span></a>`;
}

/* ---------- timeline page ---------- */
let evQuery = "", evFilter = "all";
function progress(ev){ const s=Date.parse(ev.start), e=Date.parse(ev.end); return Math.min(100,Math.max(0,(Date.now()-s)/(e-s)*100)); }
function eventCard(ev, st){
  const target = st==="live"?ev.end:ev.start, hoursLeft = st==="live"?(Date.parse(ev.end)-Date.now())/36e5:99, urgent = hoursLeft<48, cost = evCost(ev);
  const imgs = ev.badges.length>1 ? `<span class="tile multi">${ev.badges.slice(0,3).map(b=>tile({...b,img:cdn(b.img)})).join('')}</span>` : tile({...ev.badges[0],img:cdn(ev.badges[0].img)});
  const foot = st==="live"?`<span class="st live"></span><span class="lbl">Ends in</span><span class="${urgent?'urgent':''}" data-cd="${target}">${countdown(target)}</span>`
    : st==="soon"?`<span class="st soon"></span><span class="lbl">Starts in</span><span data-cd="${target}">${countdown(target)}</span>`
    : st==="ended"?`<span class="st ended"></span><span class="lbl">Ended ${fmt(ev.end)}</span>`:`<span class="st tba"></span><span class="lbl">Dates not announced</span>`;
  return `<button class="ev ${st}" data-ev="${ev.id}"><span class="top">${imgs}<span><span class="title">${esc(ev.name)}</span><span class="cat">${esc(ev.category)}${ev.badges.length>1?` · ${ev.badges.length} badges`:''}</span></span></span><span class="obj">${esc(ev.badges[0].how)}${ev.badges.length>1?' …':''}</span>${st==="live"?`<span class="bar ${urgent?'urgent':''}"><i style="width:${progress(ev).toFixed(1)}%"></i></span>`:''}<span class="foot">${foot}<span class="pill ${cost}">${{free:"Free",paid:"Sub / paid",na:"TBA"}[cost]}</span></span></button>`;
}
// badges in the archive that no event covers yet — so nothing is ever missing from the timeline
const STALE_DAYS = 21;
function evAdded(ev){
  const ds = ev.badges.map(b => (globalBadges.find(g => g.imgId === b.img || g.versions.some(v => v.img.includes(b.img))) || {}).added).filter(Boolean).sort();
  return ds[0] ? Date.parse(ds[0]) : null;
}
function isStale(ev){ if(ev.start) return false; const a = evAdded(ev); return !!a && (Date.now() - a) > STALE_DAYS*864e5; }
function orphanEvents(){
  const seen = new Set(Object.keys(EV_BY_IMG));
  return globalBadges.filter(b => !seen.has(b.imgId) && b.added && (Date.now() - Date.parse(b.added)) < STALE_DAYS*864e5)
    .map(b => ({ id:"orphan-"+b.set, name:b.name, category:"Unknown", start:"", end:"",
                 badges:[{ name:b.name, img:b.imgId, how:b.how || "Objective not confirmed yet.", cost: b.free ? "free" : "na" }] }));
}
function allEvents(){ return EVENTS.concat(orphanEvents()); }
function renderEvents(){
  const buckets = {live:[],soon:[],tba:[],ended:[]};
  allEvents().forEach(ev => {
    const hay = (ev.name+" "+ev.category+" "+ev.badges.map(b=>b.name+" "+b.how).join(" ")).toLowerCase();
    if(evQuery && !hay.includes(evQuery)) return;
    if(evFilter==="free" && !ev.badges.some(b=>b.cost==="free")) return;
    if(evFilter==="paid" && !ev.badges.some(b=>b.cost==="paid")) return;
    if(isStale(ev)) return;               // undated for 3+ weeks: treat as over, keep it off the timeline
    buckets[status(ev)].push(ev);
  });
  buckets.live.sort((a,b)=>Date.parse(a.end)-Date.parse(b.end)); buckets.soon.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)); buckets.ended.sort((a,b)=>Date.parse(b.end)-Date.parse(a.end));
  buckets.ended = buckets.ended.filter(ev => Date.now() - Date.parse(ev.end) <= 3*864e5).slice(0, 6);
  for(const k of Object.keys(buckets)){ const K=k[0].toUpperCase()+k.slice(1); $('#ev'+K).innerHTML = buckets[k].length?buckets[k].map(ev=>eventCard(ev,k)).join(''):`<div class="empty">${evQuery?'No events match your search.':READY?'Nothing here right now.':'Loading…'}</div>`; $('#n'+K).textContent = buckets[k].length||''; }
}
const DAY=864e5, COLW=46;
/* ---------- mobile menu ---------- */
function setMenu(open){ const s=document.querySelector('.side'); s.classList.toggle('open',open); document.body.classList.toggle('menu-open',open);
  const b=$('#menuBtn'); b.setAttribute('aria-expanded',open); b.setAttribute('aria-label',open?'Close menu':'Open menu'); }
document.addEventListener('click', e=>{
  if(e.target.closest('#menuBtn')){ setMenu(!document.querySelector('.side').classList.contains('open')); return; }
  if(e.target.closest('.side-menu a')) setMenu(false);
});
window.addEventListener('popstate', ()=>setMenu(false));
document.addEventListener('keydown', e=>{ if(e.key==='Escape') setMenu(false); });

/* ---------- badge calendar (one row per badge, BadgeBase-style) ---------- */
const CAL = { calHome:{offset:0,span:7,limit:10}, calTimeline:{offset:0,span:7,limit:0} };
function calRange(st){
  const d=new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate() - ((d.getDay()+6)%7));               // Monday of the current week
  d.setDate(d.getDate() + (st.span===7 ? st.offset*7 : st.offset*28 - 7));
  const a0=d.getTime(); return [a0, a0 + st.span*DAY];
}
function calRows(a0,a1){
  const out=[];
  EVENTS.forEach(ev=>{ if(!ev.start||!ev.end) return; const s=Date.parse(ev.start), e=Date.parse(ev.end);
    if(!(s<a1 && e>a0)) return;
    ev.badges.forEach(b=>out.push({ev,b,s,e,st:status(ev)})); });
  const rank={live:0,soon:1,ended:2};
  return out.sort((x,y)=> rank[x.st]-rank[y.st] || (x.st==="soon" ? x.s-y.s : x.e-y.e) || x.b.name.localeCompare(y.b.name));
}
const fmtShort = t => new Date(t).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
function leftText(r){
  const now=Date.now(), fmtD = ms => { const d=Math.floor(ms/DAY), hh=Math.floor(ms%DAY/36e5); return d ? `${d}d ${hh}h` : `${hh}h ${Math.floor(ms%36e5/6e4)}m`; };
  if(r.st==="soon") return "starts in "+fmtD(r.s-now);
  if(r.st==="live") return fmtD(r.e-now)+" left";
  return "ended";
}
function renderCalendar(id){
  const el=document.getElementById(id); if(!el) return; const st=CAL[id];
  const [a0,a1]=calRange(st), n=st.span, now=Date.now(), rows=calRows(a0,a1).filter(r => id!=='calHome' || r.st!=='ended');
  const compact = window.matchMedia('(max-width:640px)').matches;
  const cols = compact && n===28 ? 4 : n;                           // phones: 4 week columns instead of 28 day columns
  const days=Array.from({length:cols},(_,i)=>{ const step = cols===n ? DAY : 7*DAY, d=new Date(a0+i*step);
    const t = cols===n ? d.toDateString()===new Date().toDateString() : (now>=d.getTime() && now<d.getTime()+step);
    if(compact) return `<div class="cal-day ${t?'today':''} ${cols===n&&[0,6].includes(d.getDay())?'wk':''}">${cols===n?d.toLocaleDateString(undefined,{weekday:'narrow'}):'Week of'}<b>${cols===n?d.getDate():d.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</b></div>`;
    return `<div class="cal-day ${t?'today':''} ${[0,6].includes(d.getDay())?'wk':''}">${d.toLocaleDateString(undefined,{weekday:'short'})}<b>${d.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</b></div>`; }).join('');
  const shown = st.limit && !st.all ? rows.slice(0, st.limit) : rows;
  const bars=shown.map((r,k)=>{
    const s=Math.max(r.s,a0), e=Math.min(r.e,a1);
    const left=(s-a0)/(a1-a0)*100, width=Math.max((e-s)/(a1-a0)*100, 1.2), w=Math.min(width,100-left);
    const narrow = w < (n===7 ? 16 : 7);
    const g=globalBadges.find(x=>x.imgId===r.b.img)||{}, set=g.set||"", nm=g.name||r.b.name;
    const icon = r.b.img ? `<img src="${esc(cdn(r.b.img))}" alt="" loading="lazy">` : `<span class="ph">?</span>`;
    const label = `<span class="nm">${esc(nm)}</span><span class="lft">${leftText(r)}</span>`;
    const inLabel = w < (n===7 ? 30 : 12) ? `<span class="nm">${esc(nm)}</span>` : label;
    const bar = `<button class="cal-bar ${r.b.cost||'na'} ${r.st==='soon'?'soon':''} ${r.st==='ended'?'ended':''} ${r.s<a0?'cut-l':''} ${r.e>a1?'cut-r':''}"
      style="left:${left}%;width:${narrow?`max(${w}%,34px)`:w+'%'}" data-k="${k}" ${set?`data-set="${esc(set)}"`:`data-ev="${esc(r.ev.id)}"`}>${icon}${narrow?'':inLabel}</button>`;
    // short bars: put the name next to the bar instead of inside it (or before it, near the right edge)
    const out = !narrow ? '' : (left + w > 70
      ? `<span class="cal-out" style="right:calc(${100-left}% + 4px);flex-direction:row-reverse;padding:0 8px 0 0">${label}</span>`
      : `<span class="cal-out" style="left:calc(${left}% + max(${w}%, 34px) + 4px)">${label}</span>`);
    const pctL=(s-a0)/(a1-a0)*100, pctW=Math.max((e-s)/(a1-a0)*100,1.5), urgent=r.st==="live" && r.e-now<48*36e5;
    const nowTick = now>=a0 && now<a1 ? `<span class="nowt" style="left:${(now-a0)/(a1-a0)*100}%"></span>` : '';
    const mrow = `<button class="cal-m ${r.b.cost||'na'} ${r.st==='soon'?'soon':''} ${r.st==='ended'?'ended':''}" data-k="${k}" ${set?`data-set="${esc(set)}"`:`data-ev="${esc(r.ev.id)}"`}>
      <span class="cal-mtop">${icon}<span class="nm">${esc(nm)}</span><span class="lft ${urgent?'urgent':''}">${leftText(r)}</span></span>
      <span class="cal-mtrack"><i style="left:${pctL}%;width:${Math.min(pctW,100-pctL)}%"></i>${nowTick}</span></button>`;
    return compact ? mrow : `<div class="cal-row">${bar}${out}</div>`;
  }).join('') + (st.limit && rows.length > st.limit ? `<div class="cal-more"><button class="btn ghost" data-calall="${id}">${st.all?'Show less':`Show all ${rows.length} badges`}</button></div>` : '');
  const nowX = now>=a0 && now<a1 ? `<div class="cal-now" style="left:${(now-a0)/(a1-a0)*100}%"></div>` : '';
  const label = `${new Date(a0).toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${new Date(a1-1).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`;
  const liveCount = rows.filter(r=>r.st==="live").length;
  el.innerHTML = `
    <div class="cal-head"><h3><span class="st live"></span>${id==="calHome"?"Badges available right now":"Schedule"} <span class="pill live">${liveCount} active</span></h3>
      <span class="cal-range">${label}</span>
      <div class="seg mini" data-calview="${id}"><button data-span="7" class="${n===7?'on':''}">Week</button><button data-span="28" class="${n===28?'on':''}">4 weeks</button></div>
      <div class="cal-nav" data-calnav="${id}"><button data-d="-1" aria-label="Previous">‹</button><button class="today" data-d="0">Today</button><button data-d="1" aria-label="Next">›</button></div>
    </div>
    <div class="cal-scroll"><div class="cal-inner" style="--n:${cols};--g:${cols};${n===28&&!compact?'min-width:1400px':''}">
      <div class="cal-days">${days}</div>
      <div class="cal-body">${rows.length?bars:`<div class="cal-empty">${READY?'No badges with known dates in this range.':'Loading…'}</div>`}${nowX}</div>
    </div></div>
    <div class="cal-foot"><span><i style="background:rgba(52,211,153,.5)"></i>Free</span><span><i style="background:rgba(139,92,246,.6)"></i>Sub / paid</span><span><i style="border:1px dashed var(--line-2)"></i>Starts later</span>
      <span class="sp">* Shown in your local time (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone||'')}). Hover a badge for details, click to open it.</span></div>`;
  el._rows = rows;
  if(n===28 && !compact){ const sc=el.querySelector('.cal-scroll'); if(sc && now>=a0 && now<a1) sc.scrollLeft = Math.max(0,(now-a0)/(a1-a0)*sc.scrollWidth - sc.clientWidth/3); }
}
function renderCalendars(){ renderCalendar('calHome'); renderCalendar('calTimeline'); }
document.addEventListener('click', e=>{
  const nv=e.target.closest('[data-calnav] button'); if(nv){ const id=nv.parentElement.dataset.calnav, d=+nv.dataset.d; CAL[id].offset = d===0?0:CAL[id].offset+d; renderCalendar(id); return; }
  const ca=e.target.closest('[data-calall]'); if(ca){ const id=ca.dataset.calall; CAL[id].all=!CAL[id].all; renderCalendar(id); return; }
  const vw=e.target.closest('[data-calview] button'); if(vw){ const id=vw.parentElement.dataset.calview; CAL[id].span=+vw.dataset.span; CAL[id].offset=0; renderCalendar(id); return; }
  const cb=e.target.closest('.cal-bar[data-set], .cal-m[data-set]'); if(cb){ hideTip(); navigate('/badges/'+encodeURIComponent(cb.dataset.set)+'/'); }
});
const calTip = document.createElement('div'); calTip.id='calTip'; document.body.appendChild(calTip);
function hideTip(){ calTip.classList.remove('show'); }
document.addEventListener('mouseover', e=>{
  const b=e.target.closest('.cal-bar'); if(!b || window.matchMedia('(hover:none)').matches){ hideTip(); return; }
  const cal=b.closest('.cal'), r=cal && cal._rows && cal._rows[+b.dataset.k]; if(!r) return;
  const gt=(globalBadges.find(x=>x.imgId===r.b.img)||{}).name||r.b.name;
  calTip.innerHTML = `<b>${esc(gt)}</b><div style="color:var(--muted)">${esc(r.ev.name)}${r.ev.category&&r.ev.category!=="Unknown"?` · ${esc(r.ev.category)}`:''}</div>
    <div class="r"><span>Starts</span><span>${fmtShort(r.s)}</span></div><div class="r"><span>Ends</span><span>${fmtShort(r.e)}</span></div>
    <div class="r"><span>Cost</span><span>${{free:'Free',paid:'Sub / paid',na:'Unknown'}[r.b.cost||'na']}</span></div>
    <div class="r"><span>Status</span><span>${leftText(r)}</span></div>
    ${r.b.how?`<div style="margin-top:6px;color:var(--text)">${esc(r.b.how)}</div>`:''}`;
  calTip.classList.add('show');
});
document.addEventListener('mousemove', e=>{ if(!calTip.classList.contains('show')) return;
  const w=calTip.offsetWidth, hh=calTip.offsetHeight; let x=e.clientX+14, y=e.clientY+14;
  if(x+w>innerWidth-8) x=e.clientX-w-14; if(y+hh>innerHeight-8) y=e.clientY-hh-14; calTip.style.left=x+'px'; calTip.style.top=y+'px'; });
setInterval(renderCalendars, 60000);
window.matchMedia('(max-width:640px)').addEventListener('change', renderCalendars);

/* ---------- FAQ ---------- */

function renderFAQ(){}

function renderTimeline(){ renderCalendars(); }
function tick(){ $$('[data-cd]').forEach(el=>el.textContent=countdown(el.dataset.cd)); }

/* ---------- global badges page ---------- */
let gQuery="", gSort="added", gDir="desc", gFilter="all", gShown=90;
function badgeRow(b, type){
  const ev = EV_BY_IMG[b.imgId]; const st = ev ? status(ev.ev) : null;
  const meta = type==='global'
    ? [ b.added?`Added ${fmt(b.added)}`:'', b.users?`${num(b.users)} users`:'' ].filter(Boolean).join(' · ')
    : (b.versions.length>1 ? `${b.versions.length} versions` : 'Details');
  const tag = type==='global' ? `a href="/badges/${encodeURIComponent(b.set)}/"` : 'button';
  return `<${tag} class="brow" data-badge="${esc(b.set)}" data-type="${type}">${tile(b)}<span class="t"><span class="n">${esc(b.name)}</span><span class="m">${b.free?'<span class="pill free">Free</span>':''}${st==="live"?'<span class="pill live">Active</span>':st==="soon"?'<span class="pill soon">Upcoming</span>':''}<span>${meta}</span></span></span></${type==='global'?'a':'button'}>`;
}
function renderGlobal(){
  let list = globalBadges.filter(b => !gQuery || (b.name+" "+b.set).toLowerCase().includes(gQuery));
  if(gFilter==="free") list = list.filter(b=>b.free);
  if(gFilter==="paid") list = list.filter(b=>!b.free);
  if(gFilter==="active") list = list.filter(b=>EV_BY_IMG[b.imgId] && status(EV_BY_IMG[b.imgId].ev)==="live");
  const cmp = {added:(a,b)=>(a.added||"").localeCompare(b.added||""), users:(a,b)=>a.users-b.users, title:(a,b)=>a.name.localeCompare(b.name)}[gSort];
  list = [...list].sort(cmp); if(gDir==="desc") list.reverse();
  if(gSort==="added"){ const dated=list.filter(b=>b.added), undated=list.filter(b=>!b.added); list=[...dated,...undated]; }
  const versions = globalBadges.reduce((n,b)=>n+b.versions.length,0);
  $('#gCount').textContent = `${list.length} of ${globalBadges.length} badge sets${versions>globalBadges.length?` (${versions} versions)`:''}`;
  $('#gridGlobal').innerHTML = list.length ? list.slice(0,gShown).map(b=>badgeRow(b,'global')).join('') : `<div class="empty">${READY?`No badges match “${esc(gQuery)}”.`:'Loading…'}</div>`;
  $('#gMore').innerHTML = list.length>gShown ? `<button class="btn ghost" id="btnMore">Show ${Math.min(90,list.length-gShown)} more</button>` : '';
}
let cQuery="", cFilter="all", cShown=90;
function channelRow(b){
  return `<button class="brow" data-cbadge="${esc(b.imgId)}">${tile(b)}<span class="t"><span class="n">${esc(b.name)}</span><span class="m"><span class="pill ${b.type}">${CTYPE[b.type]||b.type}</span><span class="ch">${esc(b.display||b.login)}</span>${b.added?`<span>· ${fmt(b.added)}</span>`:''}</span></span></button>`;
}
function renderChannel(){
  let list = channelBadges.filter(b => !cQuery || (b.name+" "+b.login+" "+(b.display||"")).toLowerCase().includes(cQuery));
  if(cFilter!=="all") list = list.filter(b=>b.type===cFilter);
  $('#gridChannel').innerHTML = list.length ? list.slice(0,cShown).map(channelRow).join('') : `<div class="empty">${channelBadges.length?'No badges match.':(CH_READY?'The bot is still collecting channel badges — check back soon.':'Loading…')}</div>`;
  $('#chCount').textContent = channelBadges.length ? `${list.length} of ${channelBadges.length} campaign badges from ${new Set(channelBadges.map(b=>b.login)).size} channels` : '';
  $('#cMore').innerHTML = list.length>cShown ? `<button class="btn ghost" id="btnCMore">Show ${Math.min(90,list.length-cShown)} more</button>` : '';
  $('#cChannel').textContent = channelBadges.length || '';
}
function renderAll(){ renderHome(); renderEvents(); renderTimeline(); renderGlobal(); renderChannel(); }

/* ---------- Twitch API helpers (used by the channel badge drawer) ---------- */
const prettify = s => s.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

/* ---------- drawer ---------- */
function open(html){ $('#drawerBody').innerHTML=html; $('#drawer').classList.add('open'); $('#scrim').classList.add('show'); $('#drawer').setAttribute('aria-hidden','false'); $('#closeDrawer').focus(); }
function closeDrawer(){ $('#drawer').classList.remove('open'); $('#scrim').classList.remove('show'); $('#drawer').setAttribute('aria-hidden','true'); }
const catUrl = c => `https://www.twitch.tv/directory/category/${encodeURIComponent(c.toLowerCase().replace(/[:'’]/g,'').replace(/\s+/g,'-'))}`;
function openEvent(id){
  const ev=allEvents().find(e=>e.id===id); if(!ev) return; const st=status(ev);
  const cd = st==="live"?`<div class="cd" data-cd="${ev.end}">${countdown(ev.end)}<small>until it ends</small></div>`:st==="soon"?`<div class="cd" data-cd="${ev.start}">${countdown(ev.start)}<small>until it starts</small></div>`:"";
  open(`<div class="hero-img">${ev.badges.map(b=>tile({...b,img:cdn(b.img)})).join('')}</div><h3>${esc(ev.name)}</h3><div class="sub">${esc(ev.category)}</div>${cd}
    <dl class="kv"><dt>Status</dt><dd>${{live:"Active now",soon:"Upcoming",ended:"Ended",tba:"Date not announced"}[st]}</dd><dt>Starts</dt><dd>${fmtFull(ev.start)}</dd><dt>Ends</dt><dd>${fmtFull(ev.end)}</dd></dl>
    ${ev.note?`<p class="hint">${esc(ev.note)}</p>`:''}
    <div class="badgelist">${ev.badges.map(b=>`<div>${tile({...b,img:cdn(b.img)})}<span><b>${esc(b.name)}</b><span>${esc(b.how)}</span></span><span class="pill ${b.cost}" style="margin-left:auto;flex:none">${{free:"Free",paid:"Paid",na:"TBA"}[b.cost]}</span></div>`).join('')}</div>
    <div class="actions">${!/any|unknown|twitch|eligible/i.test(ev.category)?`<a class="btn" target="_blank" rel="noopener" href="${catUrl(ev.category)}">Open category on Twitch</a>`:''}<button class="btn ghost" data-copy="${esc(ev.name)} — ${esc(ev.badges.map(b=>b.name+': '+b.how).join(' | '))} (${fmt(ev.start)} – ${fmt(ev.end)})">Copy summary</button></div>`);
}
function openBadge(set,type){
  const b=(type==='global'?globalBadges:lookupBadges).find(x=>x.set===set); if(!b) return;
  const ev = EV_BY_IMG[b.imgId]; const st = ev?status(ev.ev):null;
  const how = b.how || (ev ? ev.b.how : "") || "No public description for this badge.";
  open(`<div class="hero-img">${tile(b)}</div><h3>${esc(b.name)}</h3><div class="sub">${type==='global'?'Twitch global badge':'Channel badge'}${b.free?' · <span class="pill free">Free</span>':''}${st==="live"?' · <span class="pill live">Active now</span>':st==="soon"?' · <span class="pill soon">Upcoming</span>':''}</div>
    ${ev&&st==="live"?`<div class="cd" data-cd="${ev.ev.end}">${countdown(ev.ev.end)}<small>until it ends</small></div>`:''}
    <dl class="kv"><dt>How to get it</dt><dd>${esc(how)}</dd>${ev?`<dt>Event</dt><dd>${esc(ev.ev.name)}<br><span style="color:var(--muted)">${fmtFull(ev.ev.start)} – ${fmtFull(ev.ev.end)}</span></dd>`:''}${b.added?`<dt>Added</dt><dd>${fmt(b.added)}</dd>`:''}${b.users?`<dt>Users</dt><dd>${num(b.users)}</dd>`:''}<dt>Versions</dt><dd>${b.versions.length}</dd>${type==='global'?`<dt>Set ID</dt><dd><code>${esc(b.set)}</code></dd>`:''}</dl>
    ${b.versions.length>1?`<div class="versions">${b.versions.map(v=>`<span class="v">${tile({name:v.title||v.id,img:v.img})}<span>${esc(v.title&&v.title!==b.name?v.title.replace(b.name,'').trim()||v.id:v.id)}</span></span>`).join('')}</div>`:''}
    <div class="actions">${ev?`<button class="btn" data-openev="${ev.ev.id}">Open event</button>`:''}<a class="btn ghost" href="${esc(b.img)}" target="_blank" rel="noopener">Open image</a><button class="btn ghost" data-copy="${esc(b.img)}">Copy image URL</button></div>`);
}

/* ---------- badge detail page ---------- */
let bpVersion = 0, bpTheme = "dark";
let bpLastSet = null;
function renderBadgePage(set){
  if(set !== bpLastSet){ bpVersion = 0; bpLastSet = set; }
  const box=$('#badgePage'); $('.back').setAttribute('href','/badges/'); $('.back').textContent='← All Twitch Global Badges';
  const b = globalBadges.find(x=>x.set===set) || globalBadges.find(x=>x.imgId===set) || globalBadges.find(x=>x.versions.some(v=>v.img.includes(set)));
  if(!b){ box.innerHTML = `<div class="page-head"><div><h1>Badge not found</h1><p class="lead">This badge is not in the archive (yet).</p></div></div>`; return; }
  if(bpVersion >= b.versions.length) bpVersion = 0;
  const v = b.versions[bpVersion]; const vid = v.img.match(/badges\/v1\/([0-9a-f-]+)\//)?.[1] || b.imgId;
  const ev = EV_BY_IMG[vid] || EV_BY_IMG[b.imgId]; const st = ev ? status(ev.ev) : null;
  const cat = ev ? ev.ev.category.split(" · ")[0] : "";
  const chan = ev && /channel:\s*(\S+)/i.exec(ev.ev.category)?.[1];
  const twitchDesc = (b.how && b.how.toLowerCase()!==b.name.toLowerCase() ? b.how : "") || (ev && ev.b.desc) || "";
  const desc = twitchDesc || (ev ? `This badge is earned during the ${ev.ev.name} event: ${ev.b.how}` : "Twitch does not provide a description for this badge.");
  const context = ev ? (ev.ev.about || ev.ev.note || `This badge was added to promote ${ev.ev.name}${cat && !/any|unknown|twitch/i.test(cat) ? ` in the ${cat} category` : ""} on Twitch.`) : "";
  const cd = st==="live" ? `<div class="bp-cd" data-cd="${ev.ev.end}">${countdown(ev.ev.end)}<small>until it ends</small></div>` : st==="soon" ? `<div class="bp-cd" data-cd="${ev.ev.start}">${countdown(ev.ev.start)}<small>until it starts</small></div>` : "";
  const bg = bpTheme==="dark" ? "#18181b" : "#f7f7f8";
  box.innerHTML = `
    <div class="page-head"><div><h1>${esc(v.title||b.name)}</h1><p class="lead">Everything you need to know about this Twitch global badge.</p></div>
      <div>${b.free?'<span class="pill free">Free</span> ':''}${st==="live"?'<span class="pill live">Active</span>':st==="soon"?'<span class="pill soon">Upcoming</span>':st==="ended"?'<span class="pill na">Ended</span>':''}</div></div>
    <div class="bp-grid">
      <div class="card2"><h3>Images <span class="seg mini" id="bpTheme"><button data-t="dark" class="${bpTheme==='dark'?'on':''}">Dark</button><button data-t="light" class="${bpTheme==='light'?'on':''}">Light</button></span></h3>
        <div class="sizes" style="--bp-bg:${bg}">
          ${[1,2,3].map((s,i)=>`<a href="${esc(v.img.replace(/\/3$/,'/'+s))}" target="_blank" rel="noopener"><span class="box"><img src="${esc(v.img.replace(/\/3$/,'/'+s))}" width="${18*(i===2?4:i+1)}" height="${18*(i===2?4:i+1)}" alt=""></span>${['1x','2x','4x'][i]}</a>`).join('')}
        </div>
        ${b.versions.length>1?`<h3 style="margin-top:18px">Versions</h3><div class="vers">${b.versions.map((x,i)=>`<a href="/badges/${encodeURIComponent(b.set)}/" data-ver="${i}" class="${i===bpVersion?'on':''}"><img src="${esc(x.img)}" alt="">${esc(x.title||('Version '+(i+1)))}</a>`).join('')}</div>`:''}
      </div>
      <div class="card2"><h3>Details</h3>
        <dl class="kv2">
          <dt>Title</dt><dd>${esc(v.title||b.name)}</dd>
          <dt>Description</dt><dd>${esc(desc)}</dd>
          <dt>Set ID</dt><dd><code>${esc(b.set)}</code></dd>
          <dt>Version ID</dt><dd><code>${esc(String(bpVersion+1))}</code>${b.versions.length>1?` of ${b.versions.length}`:''}</dd>
          ${b.added?`<dt>Added</dt><dd>${fmt(b.added)}</dd>`:''}
          ${b.users?`<dt>Users</dt><dd>${num(b.users)}</dd>`:''}
          <dt>Cost</dt><dd>${b.free?'Free':(ev&&ev.b.cost==='paid')?'Paid (subscription / gift sub)':'—'}</dd>
        </dl>
      </div>
      <div class="card2"><h3>Availability</h3>
        ${cd}
        <dl class="kv2">
          <dt>Status</dt><dd>${st?(st==="tba"&&isStale(ev.ev)?"Ended (dates were never announced)":{live:"Active",soon:"Upcoming",ended:"Ended",tba:"Date not announced"}[st]):"Unknown / not a timed event"}</dd>
          <dt>Objective</dt><dd>${ev?esc(ev.b.how):"—"}</dd>
          <dt>Category</dt><dd>${cat && !/any|unknown|twitch/i.test(cat)?`<a href="${catUrl(cat)}?filter=drops" target="_blank" rel="noopener">${esc(cat)}</a>`:esc(cat||"—")}</dd>
          <dt>Channels</dt><dd>${chan?`<a href="https://twitch.tv/${esc(chan)}" target="_blank" rel="noopener">${esc(chan)}</a>`:"Any"}</dd>
          <dt>Started</dt><dd>${ev?fmtFull(ev.ev.start):"—"}</dd>
          <dt>Ends</dt><dd>${ev?fmtFull(ev.ev.end):"—"}</dd>
        </dl>
        ${ev?`<div class="actions" style="margin-top:16px;display:flex;gap:8px"><button class="btn" data-ev="${ev.ev.id}">Open event</button></div>`:''}
      </div>
      <div class="card2"><h3>Context</h3><p class="ctx">${context?esc(context):"No additional context yet. Follow twitch.tv/badge_db for updates."}</p>
        <h3 style="margin-top:18px">History</h3><dl class="kv2"><dt>Added</dt><dd>${b.added?fmt(b.added):"Before tracking started"}</dd></dl>
        <div class="actions" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost" href="${esc(v.img)}" target="_blank" rel="noopener">Open image</a><button class="btn ghost" data-copy="${esc(v.img)}">Copy image URL</button><button class="btn ghost" data-copy="${esc(location.origin+'/badges/'+encodeURIComponent(b.set)+'/')}">Copy page link</button></div>
      </div>
    </div>`;
}
document.addEventListener('click', e => {
  const t=e.target.closest('#bpTheme button'); if(t){ bpTheme=t.dataset.t; route(); e.preventDefault(); return; }
  const vv=e.target.closest('[data-ver]'); if(vv){ e.preventDefault(); bpVersion=+vv.dataset.ver; route(); }
});

function renderChannelBadgePage(imgId){
  const box=$('#badgePage'); const b = channelBadges.find(x=>x.imgId===imgId);
  $('.back').setAttribute('href','/channel/'); $('.back').textContent='← All Twitch Channel Badges';
  if(!b){ box.innerHTML = `<div class="page-head"><div><h1>Badge not found</h1><p class="lead">This channel badge is not in the archive.</p></div></div>`; return; }
  const bg = bpTheme==="dark" ? "#18181b" : "#f7f7f8";
  const siblings = channelBadges.filter(x=>x.setId.replace(/-(sub|mw|ranking)$/,'')===b.setId.replace(/-(sub|mw|ranking)$/,'') && x.imgId!==b.imgId);
  const how = {sub:"Subscribe (or gift a sub) to the channel while the campaign is running.", watch:"Watch the channel for the required time while the campaign is running.", ranking:"Be one of the top supporters of the campaign.", other:"See the channel for details."}[b.type];
  box.innerHTML = `
    <div class="page-head"><div><h1>${esc(b.name)}</h1><p class="lead">Channel badge from <a href="https://twitch.tv/${esc(b.login)}" target="_blank" rel="noopener" style="color:var(--purple-2);font-weight:700">${esc(b.display||b.login)}</a></p></div><div><span class="pill ${b.type}">${CTYPE[b.type]||b.type}</span></div></div>
    <div class="bp-grid">
      <div class="card2"><h3>Images <span class="seg mini" id="bpTheme"><button data-t="dark" class="${bpTheme==='dark'?'on':''}">Dark</button><button data-t="light" class="${bpTheme==='light'?'on':''}">Light</button></span></h3>
        <div class="sizes" style="--bp-bg:${bg}">${[1,2,3].map((s,i)=>`<a href="${esc(b.img.replace(/\/3$/,'/'+s))}" target="_blank" rel="noopener"><span class="box"><img src="${esc(b.img.replace(/\/3$/,'/'+s))}" width="${18*(i===2?4:i+1)}" height="${18*(i===2?4:i+1)}" alt=""></span>${['1x','2x','4x'][i]}</a>`).join('')}</div>
        ${siblings.length?`<h3 style="margin-top:18px">Same campaign</h3><div class="vers">${siblings.map(x=>`<a href="/channel/${esc(x.imgId)}/"><img src="${esc(x.img)}" alt="">${esc(x.name)}</a>`).join('')}</div>`:''}
      </div>
      <div class="card2"><h3>Details</h3>
        <dl class="kv2">
          <dt>Title</dt><dd>${esc(b.name)}</dd>
          <dt>Channel</dt><dd><a href="https://twitch.tv/${esc(b.login)}" target="_blank" rel="noopener">${esc(b.display||b.login)}</a></dd>
          <dt>Type</dt><dd>${CTYPE[b.type]||b.type}</dd>
          <dt>How to get it</dt><dd>${how}</dd>
          <dt>Set ID</dt><dd><code>${esc(b.setId)}</code></dd>
          <dt>First seen</dt><dd>${fmt(b.added)}</dd>
        </dl>
        <div class="actions" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="https://twitch.tv/${esc(b.login)}" target="_blank" rel="noopener">Open channel</a><a class="btn ghost" href="${esc(b.img)}" target="_blank" rel="noopener">Open image</a><button class="btn ghost" data-copy="${esc(b.img)}">Copy image URL</button></div>
      </div>
    </div>`;
}

/* ---------- admin: edit events.json through the GitHub API ---------- */
const ADM = { token:"", sha:"", events:[], dirty:false, filter:"needs", status:"" };
try{ ADM.token = localStorage.getItem("badgedb_gh_token") || ""; }catch(_){}
const b64encode = str => { const bytes = new TextEncoder().encode(str); let bin=""; for(let i=0;i<bytes.length;i+=0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i,i+0x8000)); return btoa(bin); };
const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g,"")), c=>c.charCodeAt(0)));
async function gh(path, opts={}){
  const r = await fetch(`https://api.github.com/repos/${CONFIG.repo}/${path}`, { ...opts, headers:{ "Accept":"application/vnd.github+json", "Authorization":`Bearer ${ADM.token}`, ...(opts.headers||{}) } });
  if(!r.ok){ const t = await r.text(); const e = new Error(`GitHub ${r.status}`); e.status=r.status; e.body=t; throw e; }
  return r.json();
}
const toLocalInput = iso => { if(!iso) return ""; const d=new Date(iso); if(isNaN(d)) return ""; return new Date(d - d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
const fromLocalInput = v => v ? new Date(v).toISOString().replace(/\.\d{3}Z$/,"Z") : "";
function admSetStatus(msg, cls=""){ ADM.status = msg; const el=$('#admStatus'); if(el){ el.textContent=msg; el.className='adm-status '+cls; } }
function admMarkDirty(){ ADM.dirty=true; admSetStatus("Unsaved changes","dirty"); }

async function admLoad(){
  admSetStatus("Loading…");
  try{
    const f = await gh("contents/events.json?ref=main");
    ADM.sha = f.sha; ADM.events = JSON.parse(b64decode(f.content)); ADM.dirty=false;
    admSetStatus(`Loaded ${ADM.events.length} events`, "ok"); renderAdmin();
  }catch(e){
    if(e.status===401||e.status===403||e.status===404){ admSetStatus("Token rejected — check it has Contents: Read and write on this repo.","err"); }
    else admSetStatus("Could not load: "+e.message,"err");
  }
}
async function admSave(){
  admSetStatus("Saving…");
  try{
    const body = { message:"Update events via admin", content:b64encode(JSON.stringify(ADM.events,null,1)), sha:ADM.sha, branch:"main" };
    const r = await gh("contents/events.json", { method:"PUT", body:JSON.stringify(body) });
    ADM.sha = r.content.sha; ADM.dirty=false;
    EVENTS = JSON.parse(JSON.stringify(ADM.events)); indexEvents(); renderEvents(); renderTimeline(); renderHome();
    admSetStatus("Saved — the public site updates in about a minute","ok");
  }catch(e){
    if(e.status===409) admSetStatus("The bot changed events.json meanwhile. Click Reload, then redo your edit.","err");
    else admSetStatus("Save failed: "+e.message,"err");
  }
}
function admNeeds(ev){ if(isStale(ev)) return false; return !ev.start || ev.badges.some(b=>b.cost==="na" || is_ph(b.how)) || !ev.category || ev.category==="Unknown"; }
const is_ph = h => { h=(h||"").trim().toLowerCase(); return !h || h==="objective not announced yet." || h==="objective not confirmed yet." || h.startsWith("watch in the category (exact time"); };

function renderAdmin(){
  const top=$('#admTop'), body=$('#admBody');
  if(!ADM.token){
    top.innerHTML="";
    body.innerHTML = `<div class="card2 adm-login"><h3>Sign in with a GitHub token</h3>
      <p class="ctx">The editor saves straight into your repository, so it needs a key that can write only this one repo. It is stored in this browser only.</p>
      <ol>
        <li>Open <b>github.com/settings/personal-access-tokens/new</b> (Fine-grained token).</li>
        <li>Token name: <b>BadgeDB admin</b>, Expiration: as long as you like.</li>
        <li>Repository access: <b>Only select repositories</b> → <b>${esc(CONFIG.repo)}</b>.</li>
        <li>Permissions → Repository permissions → <b>Contents: Read and write</b>.</li>
        <li><b>Generate token</b>, copy it and paste it below.</li>
      </ol>
      <div class="adm-row"><label class="search" style="flex:1;min-width:260px"><input id="admTok" type="password" placeholder="github_pat_…" autocomplete="off"></label><button class="btn" id="admLogin">Sign in</button></div>
      <p class="adm-status" id="admStatus">${esc(ADM.status)}</p></div>`;
    return;
  }
  top.innerHTML = `<span class="adm-status" id="admStatus">${esc(ADM.status)}</span>
    <button class="btn ghost" id="admReload">Reload</button><button class="btn ghost" id="admNew">+ New event</button><button class="btn" id="admSave">Save changes</button>
    <button class="btn ghost" id="admLogout" title="Forget token on this device">Sign out</button>`;
  if(!ADM.events.length){ body.innerHTML = `<div class="empty">Loading events…</div>`; return; }
  const list = ADM.events.map((ev,i)=>({ev,i})).filter(({ev})=> ADM.filter==="all" ? true : ADM.filter==="needs" ? admNeeds(ev) : ["live","soon"].includes(status(ev)));
  const covered = new Set(ADM.events.flatMap(e=>e.badges.map(b=>b.img)));
  const spare = globalBadges.filter(b=>!covered.has(b.imgId) && b.added && (Date.now()-Date.parse(b.added)) < 90*864e5);
  const counts = { needs: ADM.events.filter(admNeeds).length, active: ADM.events.filter(e=>["live","soon"].includes(status(e))).length, all: ADM.events.length };
  body.innerHTML = `
    <div class="seg adm-tabs" id="admFilter">
      <button data-f="needs" class="${ADM.filter==='needs'?'on':''}">Needs info (${counts.needs})</button>
      <button data-f="active" class="${ADM.filter==='active'?'on':''}">Active &amp; upcoming (${counts.active})</button>
      <button data-f="all" class="${ADM.filter==='all'?'on':''}">All (${counts.all})</button>
    </div>
    ${list.length ? list.map(({ev,i})=>admEventCard(ev,i,spare)).join('') : `<div class="empty">Nothing here — every event has its info filled in.</div>`}`;
}
function admEventCard(ev,i,spare){
  const st = status(ev), needs = admNeeds(ev);
  const pill = st==="live"?'<span class="pill live">Active</span>':st==="soon"?'<span class="pill soon">Upcoming</span>':st==="ended"?'<span class="pill na">Ended</span>':'<span class="pill na">No dates</span>';
  const utc = iso => iso ? new Date(iso).toUTCString().replace(" GMT"," UTC").slice(5,22)+" UTC" : "";
  return `<details class="adm-ev ${needs?'needs':''}" data-i="${i}" ${needs && ADM.filter==='needs'?'open':''}>
    <summary><span class="imgs">${ev.badges.slice(0,4).map(b=>`<img src="${esc(cdn(b.img))}" alt="">`).join('')}</span>
      <span><b>${esc(ev.name)}</b><small>${esc(ev.category||'Unknown category')} · ${ev.badges.length} badge${ev.badges.length>1?'s':''}${ev.start?` · ${fmt(ev.start)} – ${fmt(ev.end)}`:''}</small></span>${pill}</summary>
    <div class="adm-form">
      <label>Event name<input data-k="name" value="${esc(ev.name)}"></label>
      <label>Twitch category<input data-k="category" value="${esc(ev.category||'')}" placeholder="e.g. Minecraft"></label>
      <label>Starts <span class="hint">your local time${ev.start?` · ${utc(ev.start)}`:''}${ev.dates_src==='twitch'?' · auto from Twitch':ev.dates_src==='manual'?' · set by you':''}</span><input type="datetime-local" data-k="start" value="${toLocalInput(ev.start)}"></label>
      <label>Ends <span class="hint">your local time${ev.end?` · ${utc(ev.end)}`:''}</span><input type="datetime-local" data-k="end" value="${toLocalInput(ev.end)}"></label>
      <label>Only on channel <span class="hint">optional, for single-channel events</span><input data-k="channel" value="${esc(ev.channel||'')}" placeholder="e.g. ironmouse"></label>
      <label>Note <span class="hint">optional, shown as a highlighted hint</span><input data-k="note" value="${esc(ev.note||'')}"></label>
      <div class="adm-badges">${ev.badges.map((b,j)=>`
        <div class="adm-b" data-j="${j}"><img src="${esc(cdn(b.img))}" alt="">
          <span class="nm">${esc(b.name)}</span>
          <input data-bk="how" value="${esc(b.how||'')}" placeholder="How to get it, e.g. Watch 60 minutes in the category.">
          <select data-bk="cost"><option value="free" ${b.cost==='free'?'selected':''}>Free</option><option value="paid" ${b.cost==='paid'?'selected':''}>Sub / paid</option><option value="na" ${(!b.cost||b.cost==='na')?'selected':''}>Unknown</option></select>
          <button data-rmb="${j}" title="Remove badge from this event">×</button>
          ${b.desc?`<span class="ds">Twitch: ${esc(b.desc)}</span>`:''}
        </div>`).join('')}</div>
      <div class="adm-row">
        ${spare.length?`<select data-addb><option value="">+ Add a recent badge to this event…</option>${spare.map(s=>`<option value="${esc(s.imgId)}">${esc(s.name)} (${fmt(s.added)})</option>`).join('')}</select>`:''}
        <span style="flex:1"></span><button class="btn ghost" data-del="${i}">Delete event</button>
      </div>
    </div></details>`;
}
function admFromBadge(img){ const g = globalBadges.find(b=>b.imgId===img); return g ? { name:g.name, img:g.imgId, how:g.how||"Objective not announced yet.", cost:g.free?"free":"na" } : null; }

document.addEventListener('input', e=>{
  const card = e.target.closest('.adm-ev'); if(!card) return;
  const ev = ADM.events[+card.dataset.i];
  if(e.target.dataset.k){ const k=e.target.dataset.k, v=e.target.value.trim();
    if(k==="start"||k==="end"){ ev[k]=fromLocalInput(e.target.value); ev.dates_src="manual"; }
    else if(v || k==="name" || k==="category") ev[k]=e.target.value; else delete ev[k];
    if(k==="name") ev.name_src="manual";
    admMarkDirty(); }
  if(e.target.dataset.bk){ const j=+e.target.closest('.adm-b').dataset.j; ev.badges[j][e.target.dataset.bk]=e.target.value; if(e.target.dataset.bk==="how") ev.badges[j].how_src="manual"; admMarkDirty(); }
});
document.addEventListener('change', e=>{
  if(e.target.matches('[data-bk="cost"]')){ const card=e.target.closest('.adm-ev'); ADM.events[+card.dataset.i].badges[+e.target.closest('.adm-b').dataset.j].cost=e.target.value; admMarkDirty(); }
  if(e.target.matches('[data-addb]') && e.target.value){ const card=e.target.closest('.adm-ev'); const nb=admFromBadge(e.target.value);
    if(nb){ ADM.events[+card.dataset.i].badges.push(nb); admMarkDirty(); renderAdmin(); document.querySelector(`.adm-ev[data-i="${card.dataset.i}"]`)?.setAttribute('open',''); } }
});
document.addEventListener('click', e=>{
  if(e.target.id==='admLogin'){ const t=$('#admTok').value.trim(); if(!t) return; ADM.token=t; try{localStorage.setItem("badgedb_gh_token",t);}catch(_){} renderAdmin(); admLoad(); return; }
  if(e.target.id==='admLogout'){ ADM.token=""; ADM.events=[]; try{localStorage.removeItem("badgedb_gh_token");}catch(_){} admSetStatus(""); renderAdmin(); return; }
  if(e.target.id==='admReload'){ if(!ADM.dirty || confirm("Discard unsaved changes?")) admLoad(); return; }
  if(e.target.id==='admSave'){ admSave(); return; }
  if(e.target.id==='admNew'){ ADM.events.unshift({id:"event-"+Date.now().toString(36),name:"New event",category:"",start:"",end:"",badges:[]}); ADM.filter="all"; admMarkDirty(); renderAdmin(); document.querySelector('.adm-ev[data-i="0"]')?.setAttribute('open',''); return; }
  const f=e.target.closest('#admFilter button'); if(f){ ADM.filter=f.dataset.f; renderAdmin(); return; }
  const rm=e.target.closest('[data-rmb]'); if(rm){ e.preventDefault(); const card=rm.closest('.adm-ev'); ADM.events[+card.dataset.i].badges.splice(+rm.dataset.rmb,1); admMarkDirty(); renderAdmin(); document.querySelector(`.adm-ev[data-i="${card.dataset.i}"]`)?.setAttribute('open',''); return; }
  const del=e.target.closest('[data-del]'); if(del){ if(confirm("Delete this event from the timeline? (The badges stay in the archive.)")){ ADM.events.splice(+del.dataset.del,1); admMarkDirty(); renderAdmin(); } return; }
});
window.addEventListener('beforeunload', e=>{ if(ADM.dirty){ e.preventDefault(); e.returnValue=""; } });

/* ---------- "data updated" line in the footer ---------- */
fetch(`https://api.github.com/repos/${CONFIG.repo}/commits?per_page=1`).then(r=>r.ok?r.json():null).then(c=>{
  if(!c||!c[0]) return; const t=Date.parse(c[0].commit.committer.date); const m=Math.round((Date.now()-t)/60000);
  $('#dataAge').textContent = `Data last updated ${m<1?'just now':m<60?m+' min ago':Math.round(m/60)+' h ago'}.`;
}).catch(()=>{});

/* ---------- stream bar ---------- */
function togglePlayer(){
  const p=$('#player'); if(!p.hidden){ p.hidden=true; $('#playerBody').innerHTML=''; $('#btnPlayer').innerHTML='<span class="lg">Load stream &amp; chat</span><span class="sm">Watch live</span>'; return; }
  const ch=CONFIG.channel;
  $('#playerBody').innerHTML = isFile ? `<div class="ph2">The embedded player only works when the site is hosted over http(s).<br><a class="btn" style="margin-top:12px" href="https://twitch.tv/${ch}" target="_blank" rel="noopener">Open twitch.tv/${ch} ↗</a></div>`
    : `<iframe src="https://player.twitch.tv/?channel=${ch}&${PARENTS()}&muted=true" allowfullscreen></iframe><iframe src="https://www.twitch.tv/embed/${ch}/chat?${PARENTS()}&darkpopout" style="height:300px"></iframe>`;
  p.hidden=false; $('#btnPlayer').innerHTML='Hide stream';
}

/* ---------- wiring ---------- */
document.addEventListener('click', e => {
  const seg=e.target.closest('.seg button'); if(seg){ const id=seg.parentElement.id; seg.parentElement.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===seg)); const v=seg.dataset.v;
    if(id==='evFilter') evFilter=v; if(id==='gSort') gSort=v; if(id==='gDir') gDir=v; if(id==='gFilter') gFilter=v; if(id==='cFilter') cFilter=v; gShown=90; renderEvents(); renderGlobal(); renderChannel(); return; }
  if(e.target.id==='btnMore'){ gShown+=90; renderGlobal(); return; }
  if(e.target.id==='btnCMore'){ cShown+=90; renderChannel(); return; }
  const cb=e.target.closest('[data-cbadge]'); if(cb){ navigate('/channel/'+cb.dataset.cbadge+'/'); return; }
  const ev=e.target.closest('[data-ev]'); if(ev){ openEvent(ev.dataset.ev); return; }
  const oe=e.target.closest('[data-openev]'); if(oe){ openEvent(oe.dataset.openev); return; }
  const bd=e.target.closest('[data-badge]'); if(bd && bd.tagName!=='A'){ if(bd.dataset.type==='global') navigate('/badges/'+encodeURIComponent(bd.dataset.badge)+'/'); else openBadge(bd.dataset.badge,bd.dataset.type); return; }
  const cp=e.target.closest('[data-copy]'); if(cp){ navigator.clipboard?.writeText(cp.dataset.copy).then(()=>toast('Copied')); return; }
});
$('#qEv').addEventListener('input',e=>{evQuery=e.target.value.trim().toLowerCase();renderEvents();});
$('#qG').addEventListener('input',e=>{gQuery=e.target.value.trim().toLowerCase();gShown=90;renderGlobal();});
$('#qC').addEventListener('input',e=>{cQuery=e.target.value.trim().toLowerCase();cShown=90;renderChannel();});
$('#scrim').addEventListener('click',closeDrawer); $('#closeDrawer').addEventListener('click',closeDrawer);
$('#btnPlayer').addEventListener('click',togglePlayer); $('#btnPlayerX').addEventListener('click',togglePlayer);
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeDrawer(); });

// Pages built by the bot arrive pre-filled (data-ssr): keep that content until live data is loaded.
if(!document.body.dataset.ssr) renderAll();
route(); setInterval(tick,1000);
const getJSON = u => fetch(u, {cache:'no-store'}).then(r => r.ok ? r.json() : null);
Promise.allSettled([getJSON('/badges.json'), getJSON('/events.json')]).then(([b, e]) => {
  if(b.status === 'fulfilled' && Array.isArray(b.value) && b.value.length) globalBadges = normalize(b.value);
  if(e.status === 'fulfilled' && Array.isArray(e.value) && e.value.length){ EVENTS = e.value; indexEvents(); }
  READY = true; renderAll(); route();
});
getJSON('/channel-badges.json').then(rows => {
  if(!Array.isArray(rows)) return;
  channelBadges = normChannel(rows); CH_READY = true; renderChannel();
  if(/^\/channel\/[^/]+\/$/.test(pathKey())) route();
}).catch(()=>{});
