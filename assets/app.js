/* ---------- "Log in with Twitch" (badge preview with your own name) ----------
   Implicit OAuth without scopes: the token can only read public profile info. Everything stays in this browser. */
const TW_CID = (document.querySelector('meta[name="twitch-client-id"]') || {}).content || "";
let TW_USER = null;
try{ TW_USER = JSON.parse(localStorage.getItem("badgedb_tw_user") || "null"); }catch(_){}
(function twitchReturn(){
  if(!/access_token=/.test(location.hash)) return;
  const q = new URLSearchParams(location.hash.slice(1));
  const [back, nonce] = (q.get("state") || "/|").split("|");
  let ok = false; try{ ok = nonce && nonce === sessionStorage.getItem("badgedb_tw_nonce"); }catch(_){}
  history.replaceState(null, "", back && back.startsWith("/") ? back : "/");
  if(ok && q.get("access_token")){ try{ localStorage.setItem("badgedb_tw_token", q.get("access_token")); }catch(_){} twFetchUser(); }
})();
function twLogin(){
  const nonce = Math.random().toString(36).slice(2);
  try{ sessionStorage.setItem("badgedb_tw_nonce", nonce); }catch(_){}
  location.href = "https://id.twitch.tv/oauth2/authorize?" + new URLSearchParams({ client_id: TW_CID, redirect_uri: location.origin + "/",
    response_type: "token", scope: "", state: location.pathname + "|" + nonce, force_verify: "false" });
}
async function twFetchUser(){
  let token; try{ token = localStorage.getItem("badgedb_tw_token"); }catch(_){}
  if(!token || !TW_CID) return;
  const h = { "Client-Id": TW_CID, "Authorization": "Bearer " + token };
  try{
    const u = await fetch("https://api.twitch.tv/helix/users", {headers: h});
    if(u.status === 401){ twLogout(); return; }
    const me = ((await u.json()).data || [])[0]; if(!me) return;
    let color = "";
    try{ color = (((await (await fetch("https://api.twitch.tv/helix/chat/color?user_id=" + me.id, {headers: h})).json()).data || [])[0] || {}).color || ""; }catch(_){}
    const before = JSON.stringify(TW_USER);
    TW_USER = { login: me.login, name: me.display_name || me.login, color, avatar: me.profile_image_url };
    try{ localStorage.setItem("badgedb_tw_user", JSON.stringify(TW_USER)); }catch(_){}
    if(JSON.stringify(TW_USER) !== before){ renderSideUser(); if(typeof route === "function") route(); }
  }catch(_){}
}
function twLogout(){
  let token; try{ token = localStorage.getItem("badgedb_tw_token"); localStorage.removeItem("badgedb_tw_token"); localStorage.removeItem("badgedb_tw_user"); }catch(_){}
  if(token && TW_CID) fetch("https://id.twitch.tv/oauth2/revoke", {method: "POST", body: new URLSearchParams({client_id: TW_CID, token})}).catch(()=>{});
  TW_USER = null; renderSideUser(); if(typeof route === "function") route();
}
function renderSideUser(){
  const el = document.getElementById("sideUser"); if(!el) return;
  if(!TW_CID){ el.innerHTML = ""; return; }
  const tw = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 2 2 6v14h5v3h3l3-3h4l5-5V2H4zm16 12-3 3h-5l-3 3v-3H6V4h14v10zm-4-7h-2v5h2V7zm-5 0H9v5h2V7z"/></svg>';
  el.innerHTML = TW_USER
    ? `<div class="su-in">${TW_USER.avatar ? `<img src="${esc(TW_USER.avatar)}" alt="">` : `<span class="su-av">${esc((TW_USER.name||"?")[0])}</span>`}
         <span class="su-t"><b style="color:${esc(TW_USER.color || "inherit")}">${esc(TW_USER.name)}</b><small>Badge previews use your name</small></span>
         <button class="linkish" data-twlogout title="Log out">Log out</button></div>`
    : `<button class="su-login" data-twlogin>${tw}<span><b>Log in with Twitch</b><small>See badges next to your name</small></span></button>`;
}
function chatPreview(imgHtml, text){
  const name = TW_USER ? TW_USER.name : "YourName", color = (TW_USER && TW_USER.color) || "#9146FF";
  const line = `<span class="pv-line">${imgHtml}<b style="color:${esc(color)}">${esc(name)}</b><span>${text}</span></span>`;
  return `<div class="pv-chats"><div class="pv dark">${line}</div><div class="pv light">${line}</div></div>`;
}
function previewCard(img){
  const name = TW_USER ? TW_USER.name : "YourName", color = (TW_USER && TW_USER.color) || "#9146FF";
  const line = `<span class="pv-line"><img src="${esc(img.replace(/\/3$/, "/1"))}" srcset="${esc(img.replace(/\/3$/, "/2"))} 2x" width="18" height="18" alt="">`
             + `<b style="color:${esc(color)}">${esc(name)}</b><span>: gg, just got this badge!</span></span>`;
  const tw = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 2 2 6v14h5v3h3l3-3h4l5-5V2H4zm16 12-3 3h-5l-3 3v-3H6V4h14v10zm-4-7h-2v5h2V7zm-5 0H9v5h2V7z"/></svg>';
  return `<div class="card2 pv-card"><div class="pv-head"><h3>See it next to your name</h3>
      ${TW_USER ? `<span class="pv-who">${TW_USER.avatar ? `<img src="${esc(TW_USER.avatar)}" alt="">` : ""}Logged in as <b>${esc(TW_USER.name)}</b> · <button class="linkish" data-twlogout>Log out</button></span>`
                : (TW_CID ? `<button class="btn tw" data-twlogin>${tw}Log in with Twitch</button>` : "")}</div>
    <div class="pv-chats"><div class="pv dark">${line}</div><div class="pv light">${line}</div></div>
    ${TW_USER ? "" : (TW_CID ? `<p class="pv-note">Log in to see the badge with your own name and chat color. Only your public display name and color are read — nothing is posted, and it stays in this browser.</p>` : "")}
  </div>`;
}

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
const PATHS = {"/":"home","/timeline/":"timeline","/badges/":"global","/channel/":"channel","/stats/":"stats","/emotes/":"emotes","/popularity/":"popularity","/faq/":"faq","/legal/":"legal","/privacy/":"privacy","/terms/":"terms","/admin/":"admin"};
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
  if(!h && (m = p.match(/^\/badges\/([^/]+)\/$/))){ set = decodeURIComponent(m[1]);
    const known = globalBadges.find(x => x.set === set) || globalBadges.find(x => x.imgId === set);
    if(READY && !known) h = "notfound"; else { if(READY) renderBadgePage(set); h = "badge"; } }
  else if(!h && (m = p.match(/^\/channel\/([^/]+)\/$/))){ const id = decodeURIComponent(m[1]);
    if(CH_READY && !channelBadges.find(x => x.imgId === id)) h = "notfound"; else { if(channelBadges.length) renderChannelBadgePage(id); h = "badge"; } }
  if(!h) h = p === "/" ? "home" : "notfound";
  if(h === "notfound") renderNotFound();
  if(h==="admin"){ renderAdmin(); if(ADM.token && !ADM.events.length) admLoad(); }
  if(h==="popularity") maybeLivePopularity();
  $$('[data-page]').forEach(s => s.hidden = s.dataset.page !== h);
  const TITLES = {notfound:"Page not found | Badge Database", legal:"Legal Notice | Badge Database", stats:"Twitch Badge Statistics | Badge Database", emotes:"Twitch Global Emotes – Full List | Badge Database", popularity:"Twitch Badge Popularity – Most Used Badges | Badge Database", home:"Badge Database – Every Twitch Badge & When to Get It", timeline:"Timeline – Twitch Badges Available Now | Badge Database",
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
      : `<button class="sc-play" data-playhome style="background-image:url('https://static-cdn.jtvnw.net/previews-ttv/live_user_${esc(CONFIG.channel)}-640x360.jpg')">
           <span class="sc-play-btn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
           <span class="sc-play-t"><b>Watch the 24/7 stream</b><small>Click to load the Twitch player (Twitch may set cookies)</small></span></button>`; }

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
  delete buckets.ended;                              // finished events stay in the archive, not on the timeline
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
  const [a0,a1]=calRange(st), n=st.span, now=Date.now(), rows=calRows(a0,a1).filter(r => r.st!=='ended');
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
function isFree(b){ const ev = EV_BY_IMG[b.imgId]; return ev && ev.b.cost && ev.b.cost !== "na" ? ev.b.cost === "free" : !!b.free; }
function badgeState(b){
  const ev = EV_BY_IMG[b.imgId] || (b.versions||[]).map(v => EV_BY_IMG[(v.img.match(/badges\/v1\/([0-9a-f-]+)\//)||[])[1]]).find(Boolean);
  if(!ev) return null;
  const st = status(ev.ev);
  if(st === "live") return (Date.parse(ev.ev.end) - Date.now() < 48*36e5) ? "ending" : "live";
  if(st === "tba") return isStale(ev.ev) ? "ended" : "tba";
  return st;                                   // "soon" | "ended"
}
const STATE_PILL = { live:'<span class="pill live">Active</span>', ending:'<span class="pill ending">Ends soon</span>',
  soon:'<span class="pill soon">Upcoming</span>', tba:'<span class="pill tba">Date not announced</span>', ended:'<span class="pill ended">Ended</span>' };
function badgeRow(b, type){
  const bs = badgeState(b);
  const meta = type==='global'
    ? [ b.added?`Added ${fmt(b.added)}`:'', b.users?`${num(b.users)} users`:'' ].filter(Boolean).join(' · ')
    : (b.versions.length>1 ? `${b.versions.length} versions` : 'Details');
  const tag = type==='global' ? `a href="/badges/${encodeURIComponent(b.set)}/"` : 'button';
  return `<${tag} class="brow" data-badge="${esc(b.set)}" data-type="${type}">${tile(b)}<span class="t"><span class="n">${esc(b.name)}</span><span class="m">${isFree(b)?'<span class="pill free">Free</span>':''}${bs?STATE_PILL[bs]:''}<span>${meta}</span></span></span></${type==='global'?'a':'button'}>`;
}
function renderGlobal(){
  let list = globalBadges.filter(b => !gQuery || (b.name+" "+b.set).toLowerCase().includes(gQuery));
  if(gFilter==="free") list = list.filter(b=>b.free);
  if(gFilter==="paid") list = list.filter(b=>!b.free);
  if(gFilter==="active") list = list.filter(b=>["live","ending"].includes(badgeState(b)));
  if(gFilter==="ending") list = list.filter(b=>badgeState(b)==="ending");
  if(gFilter==="upcoming") list = list.filter(b=>badgeState(b)==="soon");
  if(gFilter==="tba") list = list.filter(b=>badgeState(b)==="tba");
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
function renderAll(){ renderHome(); renderEvents(); renderTimeline(); renderGlobal(); renderChannel(); renderEmotes(); renderPopularity(); renderStats(); }


/* ---------- "Add to calendar": .ics file (Apple / Outlook / most apps) and Google Calendar links ---------- */
const icsTime = iso => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = t => String(t || "").replace(/\\/g, "\\\\").replace(/[;,]/g, m => "\\" + m).replace(/\r?\n/g, "\\n");
function icsFold(line){ const out = []; while(line.length > 74){ out.push(line.slice(0, 74)); line = " " + line.slice(74); } out.push(line); return out.join("\r\n"); }
function calInfo(ev){
  const names = ev.badges.map(b => (globalBadges.find(g => g.imgId === b.img) || {}).name || b.name);
  const first = globalBadges.find(g => g.imgId === (ev.badges[0] || {}).img);
  const url = location.origin + (first ? `/badges/${encodeURIComponent(first.set)}/` : "/timeline/");
  const how = ev.badges.map((b, i) => `${names[i]}: ${b.how || "see the badge page"}`).join("\n");
  return { title: names.length > 2 ? `${ev.name} (${names.length} badges)` : names.join(" & "), how, url };
}
function downloadIcs(ev){
  const { title, how, url } = calInfo(ev), now = icsTime(new Date().toISOString()), lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Badge Database//badgedatabase.com//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  const add = (uid, start, end, summary, alarms) => {
    lines.push("BEGIN:VEVENT", `UID:${uid}@badgedatabase.com`, `DTSTAMP:${now}`, `DTSTART:${icsTime(start)}`, `DTEND:${icsTime(end)}`,
      icsFold(`SUMMARY:${icsText(summary)}`), icsFold(`DESCRIPTION:${icsText(how + "\n\nDetails: " + url)}`), icsFold(`URL:${url}`));
    alarms.forEach(t => lines.push("BEGIN:VALARM", "ACTION:DISPLAY", icsFold(`DESCRIPTION:${icsText(summary)}`), `TRIGGER:${t}`, "END:VALARM"));
    lines.push("END:VEVENT");
  };
  if(Date.parse(ev.start) > Date.now()) add(`start-${ev.id}`, ev.start, new Date(Date.parse(ev.start) + 30*6e4).toISOString(), `Twitch badge available: ${title}`, ["PT0M"]);
  add(`end-${ev.id}`, new Date(Date.parse(ev.end) - 60*6e4).toISOString(), ev.end, `Last chance: ${title} (Twitch badge ends)`, ["-P1D", "PT0M"]);
  lines.push("END:VCALENDAR");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\r\n") + "\r\n"], {type: "text/calendar;charset=utf-8"}));
  a.download = `${ev.id}.ics`; document.body.appendChild(a); a.click(); a.remove();
}
function calendarMenu(ev){
  if(!ev || !ev.start || !ev.end || Date.parse(ev.end) < Date.now()) return "";
  const { title, how, url } = calInfo(ev);
  const g = (text, start, end) => "https://calendar.google.com/calendar/render?" + new URLSearchParams({ action: "TEMPLATE", text,
    dates: `${icsTime(start)}/${icsTime(end)}`, details: `${how}\n\nDetails: ${url}`, location: "Twitch" });
  const startsLater = Date.parse(ev.start) > Date.now();
  return `<details class="cal-add"><summary class="btn ghost"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>Add to calendar</summary>
    <div class="cal-menu">
      <button data-ics="${esc(ev.id)}"><b>Apple / Outlook / other</b><small>${startsLater ? "Reminder when it starts + " : ""}last-chance reminder a day before it ends (.ics)</small></button>
      ${startsLater ? `<a href="${g("Twitch badge available: " + title, ev.start, new Date(Date.parse(ev.start) + 30*6e4).toISOString())}" target="_blank" rel="noopener"><b>Google Calendar — when it starts</b><small>${esc(fmtFull(ev.start))}</small></a>` : ""}
      <a href="${g("Last chance: " + title + " (Twitch badge ends)", new Date(Date.parse(ev.end) - 60*6e4).toISOString(), ev.end)}" target="_blank" rel="noopener"><b>Google Calendar — before it ends</b><small>${esc(fmtFull(ev.end))}</small></a>
    </div></details>`;
}

/* ---------- quick search (Ctrl+K / "/") ---------- */
const QS_PAGES = [["Home","/"],["Timeline","/timeline/"],["Global Badges","/badges/"],["Channel Badges","/channel/"],["Global Emotes","/emotes/"],
  ["Badge Popularity","/popularity/"],["Statistics","/stats/"],["FAQ","/faq/"],["Privacy Policy","/privacy/"],["Terms of Service","/terms/"]];
let qsItems = [], qsActive = 0;
const qsNorm = t => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function qsScore(title, extra, q){
  const t = qsNorm(title); if(!q) return 0;
  if(t === q) return 100; if(t.startsWith(q)) return 80;
  if(new RegExp("(^|[^a-z0-9])" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(t)) return 60;
  if(t.includes(q)) return 40;
  return qsNorm(extra).includes(q) ? 15 : -1;
}
const STATE_TXT = {live: "Active now", ending: "Ends soon", soon: "Upcoming", tba: "Date not announced", ended: "Ended"};
function qsSearch(raw){
  const res = qsSearchOne(raw);
  if(res.length || !/\s/.test(raw.trim())) return res;
  // nothing for the whole phrase (e.g. a typo): try the words one by one, longest first
  for(const w of raw.trim().split(/\s+/).filter(x => x.length >= 3).sort((a, b) => b.length - a.length)){ const r = qsSearchOne(w); if(r.length) return r; }
  return [];
}
function qsSearchOne(raw){
  const q = qsNorm(raw.trim()), groups = [];
  const push = (group, limit, arr) => { const items = arr.filter(x => x.s >= 0).sort((a, b) => b.s - a.s || a.title.localeCompare(b.title)).slice(0, limit).map(x => ({...x, group}));
    if(items.length) groups.push(items); };
  const done = () => groups.sort((a, b) => q ? b[0].s - a[0].s : 0).flat();      // best match first
  if(!q){
    const live = globalBadges.filter(b => ["ending", "live"].includes(badgeState(b))).sort((a, b) => Date.parse(EV_BY_IMG[a.imgId].ev.end) - Date.parse(EV_BY_IMG[b.imgId].ev.end));
    push("Available now", 6, live.map(b => ({s: 1, title: b.name, sub: STATE_TXT[badgeState(b)], img: b.img, go: () => navigate(`/badges/${encodeURIComponent(b.set)}/`)})));
    push("Pages", 10, QS_PAGES.map(([t, u]) => ({s: 1, title: t, sub: u, go: () => navigate(u)})));
    return done();
  }
  push("Pages", 3, QS_PAGES.map(([t, u]) => ({s: qsScore(t, "", q), title: t, sub: u, go: () => navigate(u)})));
  push("Global badges", 8, globalBadges.map(b => { const st = badgeState(b), ev = EV_BY_IMG[b.imgId];
    const base = qsScore(b.name, [b.set, b.how, ev && ev.ev.name, ev && ev.ev.category].join(" "), q);
    return {s: base < 0 ? -1 : base + (st === "live" || st === "ending" ? 5 : 0),
            title: b.name, sub: [st ? STATE_TXT[st] : "", ev && ev.ev.category && !/unknown/i.test(ev.ev.category) ? ev.ev.category : "", b.added ? "added " + fmt(b.added) : ""].filter(Boolean).join(" · "),
            img: b.img, go: () => navigate(`/badges/${encodeURIComponent(b.set)}/`)}; }));
  push("Events", 4, EVENTS.filter(e => !(e.end && Date.parse(e.end) < Date.now() - 30*864e5)).map(e => ({s: qsScore(e.name, [e.category, ...e.badges.map(b => b.name)].join(" "), q),
    title: e.name, sub: [e.category && !/unknown/i.test(e.category) ? e.category : "", e.start ? `${fmt(e.start)} – ${fmt(e.end)}` : "dates not announced"].filter(Boolean).join(" · "),
    img: e.badges[0] && e.badges[0].img ? cdn(e.badges[0].img) : "", go: () => openEvent(e.id)})));
  push("Channel badges", 5, channelBadges.map(b => ({s: qsNorm(b.display || b.login) === q || qsNorm(b.login) === q ? 90 : qsScore(b.name, [b.login, b.display].join(" "), q),
    title: b.name, sub: `${b.display || b.login || ""}${b.type ? " · " + (b.type === "sub" ? "Sub badge" : b.type === "watch" ? "Watch badge" : b.type === "ranking" ? "Top supporter" : "Campaign") : ""}`,
    img: b.img, go: () => navigate(`/channel/${encodeURIComponent(b.imgId)}/`)})));
  push("Global emotes", 5, EMOTES.filter(e => e[4] !== 0).map(e => ({s: qsScore(e[1], "", q), title: e[1], sub: e[3] === 1 ? "Animated emote" : "Global emote",
    img: emoteUrl(e[0], "1.0"), go: () => { navigate("/emotes/"); openEmote(e[0]); }})));
  return done();
}
function qsRender(){
  const box = $('#qsRes'), q = $('#qsInput').value;
  qsItems = qsSearch(q); if(qsActive >= qsItems.length) qsActive = 0;
  if(!qsItems.length){ box.innerHTML = `<div class="qs-empty">No results for “${esc(q)}”.</div>`; return; }
  let last = "";
  box.innerHTML = qsItems.map((it, i) => { const head = it.group !== last ? `<div class="qs-g">${esc(it.group)}</div>` : ""; last = it.group;
    return head + `<button class="qs-it ${i === qsActive ? "on" : ""}" data-qs="${i}" role="option" aria-selected="${i === qsActive}">
      <span class="qs-ic">${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'}</span>
      <span class="qs-t"><b>${esc(it.title)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span></button>`; }).join("");
}
function qsOpen(){ const el = $('#qs'); if(!el.hidden) return; el.hidden = false; document.body.classList.add('qs-on'); if(typeof setMenu === "function") setMenu(false);
  $('#qsInput').value = ""; qsActive = 0; qsRender(); setTimeout(() => $('#qsInput').focus(), 0); }
function qsClose(){ $('#qs').hidden = true; document.body.classList.remove('qs-on'); }
function qsGo(i){ const it = qsItems[i]; if(!it) return; qsClose(); it.go(); window.scrollTo({top: 0}); }
document.addEventListener('keydown', e => {
  const open = !$('#qs').hidden;
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k"){ e.preventDefault(); open ? qsClose() : qsOpen(); return; }
  if(!open && e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable){ e.preventDefault(); qsOpen(); return; }
  if(!open) return;
  if(e.key === "Escape"){ e.preventDefault(); qsClose(); }
  else if(e.key === "ArrowDown" || e.key === "ArrowUp"){ e.preventDefault(); const n = qsItems.length; if(!n) return; qsActive = (qsActive + (e.key === "ArrowDown" ? 1 : n - 1)) % n; qsRender();
    $('#qsRes .qs-it.on')?.scrollIntoView({block: "nearest"}); }
  else if(e.key === "Enter"){ e.preventDefault(); qsGo(qsActive); }
});
document.addEventListener('input', e => { if(e.target.id === 'qsInput'){ qsActive = 0; qsRender(); } });
document.addEventListener('click', e => {
  if(e.target.closest('#qsBtn')){ qsOpen(); return; }
  const it = e.target.closest('[data-qs]'); if(it){ qsGo(+it.dataset.qs); return; }
  if(e.target.id === 'qs'){ qsClose(); }
});

/* ---------- 404 ---------- */
function renderNotFound(){
  const path = decodeURIComponent(location.pathname);
  $('#nfPath').textContent = path;
  const words = path.replace(/^\/|\/$/g, "").split("/").pop().replace(/[-_]+/g, " ").replace(/\b(badges?|channel|v\d+)\b/gi, "").trim();
  let sug = [];
  if(words && READY){
    const q = qsNorm(words);
    sug = globalBadges.map(b => { const t = qsNorm(b.name); const w = q.split(/\s+/).filter(x => x.length > 2);
      const hits = w.filter(x => t.includes(x) || qsNorm(b.set).includes(x)).length; return {b, s: hits / Math.max(1, w.length)}; })
      .filter(x => x.s > 0).sort((a, b) => b.s - a.s || (b.b.added || "").localeCompare(a.b.added || "")).slice(0, 4).map(x => x.b);
  }
  $('#nfSuggest').innerHTML = sug.length ? `<div class="nf-sug"><h3>Did you mean</h3><div class="blist">${sug.map(b => badgeRow(b, "global")).join("")}</div></div>` : "";
}
document.addEventListener('click', e => { if(e.target.closest('#nfSearch')){ qsOpen(); const w = decodeURIComponent(location.pathname).split("/").filter(Boolean).pop() || "";
  $('#qsInput').value = w.replace(/[-_]+/g, " "); qsActive = 0; qsRender(); } });

/* ---------- statistics ---------- */
function badgeFacts(b){
  const ev = EV_BY_IMG[b.imgId], info = descInfo(b.how || (ev && ev.b.desc) || "");
  const cat = ev && ev.ev.category && !/unknown|any/i.test(ev.ev.category) ? ev.ev.category.split(" · ")[0] : info.category || "";
  const cost = ev && ["free", "paid"].includes(ev.b.cost) ? ev.b.cost : info.cost || (b.free ? "free" : "");
  return { cat, cost };
}
function renderStats(){
  const box = $('#stCards'); if(!box) return;
  if(!READY){ box.innerHTML = '<div class="empty">Loading…</div>'; return; }
  const all = globalBadges, now = new Date(), yr = String(now.getFullYear());
  const dated = all.filter(b => b.added), d30 = new Date(Date.now() - 30*864e5).toISOString().slice(0,10);
  const active = all.filter(b => ["live", "ending"].includes(badgeState(b))).length;
  const emotes = EMOTES.filter(e => e[4] !== 0).length;
  const lens = EVENTS.filter(e => e.start && e.end).map(e => (Date.parse(e.end) - Date.parse(e.start)) / 864e5).filter(d => d > 0 && d < 120);
  const avgLen = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0;
  box.innerHTML = [[all.length, "global badge sets"], [all.filter(b => (b.added || "").startsWith(yr)).length, `added in ${yr}`], [all.filter(b => (b.added || "") >= d30).length, "added in the last 30 days"],
    [active, "available right now"], [avgLen ? avgLen + " days" : "—", "average event length"], [emotes || "—", "global emotes"]]
    .map(([n, l]) => `<div><b>${typeof n === "number" ? num(n) : n}</b><span>${l}</span></div>`).join("");
  // per month, last 18 months
  const months = []; const d = new Date(now.getFullYear(), now.getMonth(), 1);
  for(let i = 17; i >= 0; i--){ const m = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(m.getFullYear() + "-" + String(m.getMonth() + 1).padStart(2, "0")); }
  const per = Object.fromEntries(months.map(m => [m, 0])); dated.forEach(b => { const k = b.added.slice(0, 7); if(k in per) per[k]++; });
  const max = Math.max(1, ...Object.values(per));
  $('#stMonths').innerHTML = months.map(m => { const n = per[m], dt = new Date(m + "-01T12:00:00");
    return `<div class="st-bar" title="${n} new badge${n === 1 ? "" : "s"} in ${dt.toLocaleDateString(undefined, {month: "long", year: "numeric"})}">
      <span class="st-n">${n || ""}</span><i style="height:${(n / max * 100).toFixed(1)}%"></i><span class="st-m">${dt.toLocaleDateString(undefined, {month: "short"})}${dt.getMonth() === 0 ? `<br>${dt.getFullYear()}` : ""}</span></div>`; }).join("");
  $('#stMonthsNote').textContent = `${all.length - dated.length} older badges were added before tracking started and have no recorded date.`;
  // free vs paid (timed / event badges only)
  const facts = all.map(badgeFacts), free = facts.filter(f => f.cost === "free").length, paid = facts.filter(f => f.cost === "paid").length, tot = free + paid || 1;
  $('#stCost').innerHTML = `<div class="st-donut" style="--p:${(free / tot * 100).toFixed(1)}"><span><b>${Math.round(free / tot * 100)}%</b>free</span></div>
    <div class="st-legend"><span><i class="f"></i>Free (watch / view) — ${free}</span><span><i class="p"></i>Sub / paid — ${paid}</span><small>Event badges with a known requirement.</small></div>`;
  // top games
  const byCat = {}; facts.forEach(f => { if(f.cat && !/eligible|categories|any |various|multiple/i.test(f.cat)) byCat[f.cat] = (byCat[f.cat] || 0) + 1; });
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10), cmax = top.length ? top[0][1] : 1;
  $('#stCats').innerHTML = top.length ? top.map(([c, n]) => `<div class="st-row"><span class="st-c">${esc(c)}</span><span class="st-track"><i style="width:${(n / cmax * 100).toFixed(1)}%"></i></span><b>${n}</b></div>`).join("") : '<div class="empty">No data yet.</div>';
  // per year
  const years = {}; dated.forEach(b => { const y = b.added.slice(0, 4); years[y] = (years[y] || 0) + 1; });
  const ymax = Math.max(1, ...Object.values(years));
  $('#stYears').innerHTML = Object.entries(years).sort().reverse().map(([y, n]) => `<div class="st-row"><span class="st-c">${y}</span><span class="st-track"><i style="width:${(n / ymax * 100).toFixed(1)}%"></i></span><b>${n}</b></div>`).join("")
    + `<div class="st-row muted"><span class="st-c">Before tracking</span><span class="st-track"></span><b>${all.length - dated.length}</b></div>`;
}

/* ---------- global emotes ---------- */
let EMOTES = [], E_READY = false, eQuery = "", eSort = "added", eFilter = "all", eShown = 120;
const emoteUrl = (id, scale = "2.0", theme = "dark") => `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/${theme}/${scale}`;
function renderEmotes(){
  const grid = $('#gridEmotes'); if(!grid) return;
  const live = EMOTES.filter(e => e[4] !== 0);
  $('#cEmotes').textContent = live.length || '';
  // date filters only make sense once the bot has recorded at least one new emote
  const yr = String(new Date().getFullYear()), halfYear = new Date(Date.now() - 182*864e5).toISOString().slice(0,10);
  const hasYear = EMOTES.some(e => (e[2] || "").startsWith(yr)), hasHalf = EMOTES.some(e => (e[2] || "") >= halfYear);
  const fy = $('#eFilter [data-v="year"]'), fh = $('#eFilter [data-v="6m"]');
  if(fy) fy.hidden = !hasYear; if(fh) fh.hidden = !hasHalf;
  if((eFilter === "year" && !hasYear) || (eFilter === "6m" && !hasHalf)){
    eFilter = "all"; $$('#eFilter button').forEach(b => b.classList.toggle('on', b.dataset.v === 'all'));
  }
  let list = eFilter === "retired" ? EMOTES.filter(e => e[4] === 0) : live;
  if(eFilter === "animated") list = list.filter(e => e[3] === 1);
  if(eFilter === "year") list = list.filter(e => (e[2] || "").startsWith(yr));
  if(eFilter === "6m") list = list.filter(e => (e[2] || "") >= halfYear);
  if(eQuery) list = list.filter(e => e[1].toLowerCase().includes(eQuery));
  // Twitch doesn't publish emote dates. Tracked emotes use their first-seen date; the rest keep Twitch's own
  // list order, which is chronological (emotes.json stores it oldest → newest).
  const pos = e => EMOTES.indexOf(e);
  const newest = (a, b) => (b[2] || "").localeCompare(a[2] || "") || pos(b) - pos(a);
  const oldest = (a, b) => (a[2] || "0000").localeCompare(b[2] || "0000") || pos(a) - pos(b);
  list = [...list].sort(eSort === "name" ? (a, b) => a[1].localeCompare(b[1])
                      : eSort === "oldest" ? oldest
                      : eFilter === "retired" ? (a, b) => (b[5] || "").localeCompare(a[5] || "") || newest(a, b) : newest);
  $('#eCount').textContent = E_READY ? `${list.length} of ${live.length} global emotes · checked against Twitch every 15 minutes` : '';
  grid.innerHTML = list.length ? list.slice(0, eShown).map(e => `<button class="emo ${e[4]===0?'retired':''}" data-emote="${esc(e[0])}">
      <span class="pic"><img src="${emoteUrl(e[0])}" alt="${esc(e[1])}" loading="lazy"></span><b>${esc(e[1])}</b>
      <small>${e[3]===1?'<span class="pill anim">Animated</span>':''}${e[2]?`Added ${fmt(e[2])}`:''}${e[4]===0&&e[5]?`<span class="rm">Removed ${fmt(e[5])}</span>`:''}</small></button>`).join('')
    : `<div class="empty">${E_READY ? 'No emotes match.' : 'Loading…'}</div>`;
  $('#eMore').innerHTML = list.length > eShown ? `<button class="btn ghost" id="btnEMore">Show ${Math.min(120, list.length - eShown)} more</button>` : '';
}
function openEmote(id){
  const e = EMOTES.find(x => x[0] === id); if(!e) return;
  const sizes = t => [["1.0","1x"],["2.0","2x"],["3.0","4x"]].map(([sc,l]) => `<a href="${emoteUrl(e[0],sc,t)}" target="_blank" rel="noopener"><img src="${emoteUrl(e[0],sc,t)}" alt="">${l}</a>`).join('');
  open(`<h2 style="margin:0 0 4px">${esc(e[1])}</h2><p class="ctx" style="margin-bottom:16px">Twitch global emote${e[4]===0?' (no longer in the global set)':''}</p>
    <h3>In chat${TW_USER ? '' : ' <button class="linkish" data-twlogin style="margin-left:6px">Log in with Twitch to use your name</button>'}</h3>
    ${(() => { const name = TW_USER ? TW_USER.name : "YourName", color = (TW_USER && TW_USER.color) || "#9146FF";
       const line = `<span class="pv-line"><b style="color:${esc(color)}">${esc(name)}</b><span>:&nbsp;</span><img class="emo-inline" src="${emoteUrl(e[0],'1.0')}" srcset="${emoteUrl(e[0],'2.0')} 2x" alt="${esc(e[1])}"></span>`;
       return `<div class="pv-chats one"><div class="pv dark">${line}</div><div class="pv light">${line}</div></div>`; })()}
    <h3 style="margin-top:16px">Dark</h3><div class="emote-sizes">${sizes('dark')}</div><h3 style="margin-top:14px">Light</h3><div class="emote-sizes light">${sizes('light')}</div>
    <dl class="kv" style="margin-top:18px"><dt>Name</dt><dd><code>${esc(e[1])}</code></dd><dt>Emote ID</dt><dd><code>${esc(e[0])}</code></dd>
    <dt>Type</dt><dd>${e[3]===1?'Animated':'Static'}</dd><dt>First seen</dt><dd>${e[2]?fmt(e[2]):'Before tracking started'}</dd>${e[4]===0?`<dt>Removed</dt><dd>${e[5]?fmt(e[5]):'Yes'}</dd>`:''}</dl>
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="btn" data-copy="${esc(e[1])}">Copy name</button><a class="btn ghost" href="${emoteUrl(e[0],'3.0')}" target="_blank" rel="noopener">Open image</a></div>`);
}

/* ---------- badge popularity ---------- */
let POP = null, pQuery = "", pFilter = "all", pShown = 100;
const compact = n => n >= 1e6 ? (n/1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/,'') + 'M' : n >= 1e4 ? Math.round(n/1e3) + 'K' : num(n);
/* Live counts straight from potat.app in the visitor's browser (the bot's server requests are blocked by
   Cloudflare). Cached for 12 h per browser; if potat.app doesn't allow browser requests, nothing changes. */
const POTAT_URL = "https://api.potat.app/twitch/badges", POP_CACHE = "badgedb_pop_cache";
function potatList(j, depth = 0){
  if(Array.isArray(j)) return j;
  if(j && typeof j === "object" && depth < 4){
    for(const k of ["data","badges","results","items"]) if(k in j){ const r = potatList(j[k], depth+1); if(r.length) return r; }
    const vals = Object.values(j);
    if(vals.length > 1 && vals.every(v => typeof v === "number" || (v && typeof v === "object" && !Array.isArray(v))))
      return Object.entries(j).map(([k,v]) => typeof v === "number" ? {badge:k, user_count:v} : {...v, badge:k});
    for(const v of vals){ const r = potatList(v, depth+1); if(r.length && typeof r[0] === "object") return r; }
  }
  return [];
}
function parsePotat(j){
  const norm = t => String(t||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
  const sets = new Set(globalBadges.map(b => b.set)), byTitle = {}, byImg = {};
  globalBadges.forEach(b => { byTitle[norm(b.name)] = b.set; b.versions.forEach(v => { const m = v.img.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/); if(m) byImg[m[0]] = b.set; }); });
  const counts = {};
  for(const it of potatList(j)){
    if(!it || typeof it !== "object") continue;
    const flat = {...it};
    for(const [k,v] of Object.entries(it)) if(v && typeof v === "object" && !Array.isArray(v)) for(const [kk,vv] of Object.entries(v)) flat[k+"_"+kk] = vv;
    const nums = Object.entries(flat).filter(([k,v]) => typeof v === "number");
    const pref = nums.filter(([k]) => /user|count|total|amount|seen/i.test(k));
    const n = pref.length ? pref[0][1] : nums.length ? Math.max(...nums.map(x => x[1])) : null;
    if(n == null) continue;
    const strs = Object.values(flat).filter(v => typeof v === "string");
    let sid = strs.find(v => sets.has(v));
    if(!sid) for(const v of strs){ const m = v.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []; const hit = m.find(u => byImg[u]); if(hit){ sid = byImg[hit]; break; } }
    if(!sid) sid = strs.map(v => byTitle[norm(v)]).find(Boolean);
    if(sid) counts[sid] = Math.max(counts[sid] || 0, Math.round(n));
  }
  return counts;
}
async function livePopularity(force = false){
  if(!force){ try{ const c = JSON.parse(localStorage.getItem(POP_CACHE) || "null"); if(c && Date.now() - c.t < 12*36e5 && c.counts) return c; }catch(_){} }
  try{
    const r = await fetch(POTAT_URL, {headers:{Accept:"application/json"}});
    if(!r.ok) return null;
    const counts = parsePotat(await r.json());
    if(Object.keys(counts).length < 10) return null;
    const c = {t: Date.now(), updated: new Date().toISOString().slice(0,10), source: "PotatBotat (potat.app)", counts};
    try{ localStorage.setItem(POP_CACHE, JSON.stringify(c)); }catch(_){}
    return c;
  }catch(e){ return null; }          // blocked (CORS / network): keep whatever we already show
}
let liveTried = false;
function maybeLivePopularity(){
  if(liveTried || !READY) return; liveTried = true;
  const today = new Date().toISOString().slice(0,10);
  if(POP && POP.updated === today) return;                         // the repo already has today's numbers
  livePopularity().then(c => { if(!c) return; POP = c; applyPopularity(); renderPopularity(); renderGlobal(); });
}
function applyPopularity(){
  if(!POP || !POP.counts) return;
  globalBadges.forEach(b => { b.users = POP.counts[b.set] || 0; });   // one consistent source; old snapshot numbers are dropped
}
function renderPopularity(){
  const box = $('#popList'); if(!box) return;
  const ranked = globalBadges.filter(b => b.users > 0).sort((a, b) => b.users - a.users);
  ranked.forEach((b, i) => b._rank = i + 1);
  if(!ranked.length){ box.innerHTML = `<div class="empty">${READY ? 'No usage data yet — it is refreshed once a day.' : 'Loading…'}</div>`; $('#popStats').innerHTML=''; return; }
  const total = ranked.reduce((n, b) => n + b.users, 0), top = ranked[0], max = top.users;
  $('#popStats').innerHTML = `<div><b>${ranked.length}</b><span>badges ranked</span></div><div><b>${compact(total)}</b><span>badge users counted</span></div>
    <div><b>${esc(top.name)}</b><span>most used · ${compact(top.users)} users${POP && POP.updated ? ` · updated ${fmt(POP.updated)}` : ' · older snapshot, refresh pending'}</span></div>`;
  let list = ranked;
  if(pFilter === "event") list = list.filter(b => EV_BY_IMG[b.imgId]);
  if(pFilter === "2026") list = list.filter(b => (b.added || "").startsWith("2026"));
  if(pQuery) list = list.filter(b => b.name.toLowerCase().includes(pQuery));
  box.innerHTML = list.length ? list.slice(0, pShown).map(b => `<a class="prow ${b._rank<=3?'top':''}" href="/badges/${encodeURIComponent(b.set)}/">
      <span class="rank">${b._rank}</span><img src="${esc(b.img)}" alt="" loading="lazy">
      <span><span class="nm">${esc(b.name)}</span><span class="bar"><i style="width:${Math.max(0.6, b.users/max*100).toFixed(2)}%"></i></span></span>
      <span class="num">${num(b.users)}<small>${(b.users/total*100).toFixed(b.users/total>=.01?1:2)}%</small></span></a>`).join('')
    : `<div class="empty">No badges match.</div>`;
  $('#pMore').innerHTML = list.length > pShown ? `<button class="btn ghost" id="btnPMore">Show ${Math.min(100, list.length - pShown)} more</button>` : '';
}

/* ---------- Twitch API helpers (used by the channel badge drawer) ---------- */
const prettify = s => s.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

/* ---------- drawer ---------- */
function open(html){ $('#drawerBody').innerHTML=html; $('#drawer').classList.add('open'); $('#scrim').classList.add('show'); $('#drawer').setAttribute('aria-hidden','false'); $('#closeDrawer').focus(); }
function closeDrawer(){ $('#drawer').classList.remove('open'); $('#scrim').classList.remove('show'); $('#drawer').setAttribute('aria-hidden','true'); }
function evChannels(ev){
  const list = Array.isArray(ev.channels) ? ev.channels : [];
  const one = ev.channel || (/channel:\s*(\S+)/i.exec(ev.category || "") || [])[1];
  return [...new Set([...(one ? [one] : []), ...list].map(x => String(x).trim().replace(/^@/, "")).filter(Boolean))];
}
function channelsHtml(ev, cat){
  const ch = evChannels(ev), hasCat = cat && !/any|unknown|twitch/i.test(cat);
  const drops = hasCat ? `${catUrl(cat)}?filter=drops` : "";
  if(ch.length){
    const chips = ch.slice(0, 30).map(c => `<a class="chan" href="https://twitch.tv/${esc(c)}" target="_blank" rel="noopener">${esc(c)}</a>`).join("")
                + (ch.length > 30 ? `<span class="chan more">+${ch.length - 30} more</span>` : "");
    const note = ev.channels_partial ? `<div class="chan-note">${esc(ev.channels_note || "These are some of the participating channels.")}${drops ? ` <a href="${drops}" target="_blank" rel="noopener">See every live participating channel on Twitch ↗</a>` : ""}</div>` : "";
    return `<div class="chans">${chips}</div>${note}`;
  }
  return hasCat ? `Any channel in the category with Drops enabled — <a href="${drops}" target="_blank" rel="noopener">see live channels ↗</a>` : "Any";
}
const catUrl = c => `https://www.twitch.tv/directory/category/${encodeURIComponent(c.toLowerCase().replace(/[:'’]/g,'').replace(/\s+/g,'-'))}`;
function openEvent(id){
  const ev=allEvents().find(e=>e.id===id); if(!ev) return; const st=status(ev);
  const cd = st==="live"?`<div class="cd" data-cd="${ev.end}">${countdown(ev.end)}<small>until it ends</small></div>`:st==="soon"?`<div class="cd" data-cd="${ev.start}">${countdown(ev.start)}<small>until it starts</small></div>`:"";
  open(`<div class="hero-img">${ev.badges.map(b=>tile({...b,img:cdn(b.img)})).join('')}</div><h3>${esc(ev.name)}</h3><div class="sub">${esc(ev.category)}</div>${cd}
    <dl class="kv"><dt>Status</dt><dd>${{live:"Active now",soon:"Upcoming",ended:"Ended",tba:"Date not announced"}[st]}</dd><dt>Starts</dt><dd>${fmtFull(ev.start)}</dd><dt>Ends</dt><dd>${fmtFull(ev.end)}</dd></dl>
    ${ev.note?`<p class="hint">${esc(ev.note)}</p>`:''}
    <div class="badgelist">${ev.badges.map(b=>`<div>${tile({...b,img:cdn(b.img)})}<span><b>${esc(b.name)}</b><span>${esc(b.how)}</span></span><span class="pill ${b.cost}" style="margin-left:auto;flex:none">${{free:"Free",paid:"Paid",na:"TBA"}[b.cost]}</span></div>`).join('')}</div>
    <div class="actions">${!/any|unknown|twitch|eligible/i.test(ev.category)?`<a class="btn" target="_blank" rel="noopener" href="${catUrl(ev.category)}">Open category on Twitch</a>`:''}<button class="btn ghost" data-copy="${esc(ev.name)} — ${esc(ev.badges.map(b=>b.name+': '+b.how).join(' | '))} (${fmt(ev.start)} – ${fmt(ev.end)})">Copy summary</button>${calendarMenu(ev)}</div>`);
}
function openBadge(set,type){
  const b=(type==='global'?globalBadges:lookupBadges).find(x=>x.set===set); if(!b) return;
  const ev = EV_BY_IMG[b.imgId]; const st = ev?status(ev.ev):null;
  const how = b.how || (ev ? ev.b.how : "") || "No public description for this badge.";
  open(`<div class="hero-img">${tile(b)}</div><h3>${esc(b.name)}</h3><div class="sub">${type==='global'?'Twitch global badge':'Channel badge'}${(type==='global'?isFree(b):b.free)?' · <span class="pill free">Free</span>':''}${st==="live"?' · <span class="pill live">Active now</span>':st==="soon"?' · <span class="pill soon">Upcoming</span>':''}</div>
    ${ev&&st==="live"?`<div class="cd" data-cd="${ev.ev.end}">${countdown(ev.ev.end)}<small>until it ends</small></div>`:''}
    <dl class="kv"><dt>How to get it</dt><dd>${esc(how)}</dd>${ev?`<dt>Event</dt><dd>${esc(ev.ev.name)}<br><span style="color:var(--muted)">${fmtFull(ev.ev.start)} – ${fmtFull(ev.ev.end)}</span></dd>`:''}${b.added?`<dt>Added</dt><dd>${fmt(b.added)}</dd>`:''}${b.users?`<dt>Users</dt><dd>${num(b.users)}</dd>`:''}<dt>Versions</dt><dd>${b.versions.length}</dd>${type==='global'?`<dt>Set ID</dt><dd><code>${esc(b.set)}</code></dd>`:''}</dl>
    ${b.versions.length>1?`<div class="versions">${b.versions.map(v=>`<span class="v">${tile({name:v.title||v.id,img:v.img})}<span>${esc(v.title&&v.title!==b.name?v.title.replace(b.name,'').trim()||v.id:v.id)}</span></span>`).join('')}</div>`:''}
    <div class="actions">${ev?`<button class="btn" data-openev="${ev.ev.id}">Open event</button>${calendarMenu(ev.ev)}`:''}<a class="btn ghost" href="${esc(b.img)}" target="_blank" rel="noopener">Open image</a><button class="btn ghost" data-copy="${esc(b.img)}">Copy image URL</button></div>`);
}

/* ---------- badge detail page ---------- */
let bpVersion = 0, bpTheme = "dark";
/* Twitch's badge description ("This badge was earned by watching a ZEvent25 stream") -> objective, category, cost */
function descInfo(d){
  d = (d || "").trim(); const out = {}; if(!d) return out;
  const m = d.match(/in the (.+?) category/i); if(m) out.category = m[1].trim();
  const low = d.toLowerCase();
  if(/subscrib|gift(ed|ing)? (a )?sub/.test(low)) out.cost = "paid"; else if(/watch|view|tun(e|ing) in/.test(low)) out.cost = "free";
  let obj = d.replace(/^this (limited[- ]time )?(chat )?badge (was|is|will be|can be) (earned|awarded|given|granted|unlocked|obtained)( to (people|users|viewers|everyone|twitch users))?( who| by| for| to| when)?\s*/i, "")
             .replace(/\s*(It|This badge) was (added|created|made) to (promote|celebrate).*$/i, "").trim();
  if(obj && obj !== d){ obj = obj.charAt(0).toUpperCase() + obj.slice(1); if(!/[.!?]$/.test(obj)) obj += "."; out.objective = obj; }
  return out;
}
let bpLastSet = null;
function renderBadgePage(set){
  if(set !== bpLastSet){ bpVersion = 0; bpLastSet = set; }
  const box=$('#badgePage'); $('.back').setAttribute('href','/badges/'); $('.back').textContent='← All Twitch Global Badges';
  const b = globalBadges.find(x=>x.set===set) || globalBadges.find(x=>x.imgId===set) || globalBadges.find(x=>x.versions.some(v=>v.img.includes(set)));
  if(!b){ box.innerHTML = `<div class="page-head"><div><h1>Badge not found</h1><p class="lead">This badge is not in the archive (yet).</p></div></div>`; return; }
  if(bpVersion >= b.versions.length) bpVersion = 0;
  const v = b.versions[bpVersion]; const vid = v.img.match(/badges\/v1\/([0-9a-f-]+)\//)?.[1] || b.imgId;
  const ev = EV_BY_IMG[vid] || EV_BY_IMG[b.imgId]; const st = ev ? status(ev.ev) : null;
  const info = descInfo(b.how || (ev && ev.b.desc) || "");
  const cat = ev ? ev.ev.category.split(" · ")[0] : (info.category || "");
  const chan = ev && /channel:\s*(\S+)/i.exec(ev.ev.category)?.[1];
  const twitchDesc = (b.how && b.how.toLowerCase()!==b.name.toLowerCase() ? b.how : "") || (ev && ev.b.desc) || "";
  const desc = twitchDesc || (ev ? `This badge is earned during the ${ev.ev.name} event: ${ev.b.how}` : "Twitch does not provide a description for this badge.");
  const context = ev ? (ev.ev.about || ev.ev.note || `This badge was added to promote ${ev.ev.name}${cat && !/any|unknown|twitch/i.test(cat) ? ` in the ${cat} category` : ""} on Twitch.`) : "";
  const cd = st==="live" ? `<div class="bp-cd" data-cd="${ev.ev.end}">${countdown(ev.ev.end)}<small>until it ends</small></div>` : st==="soon" ? `<div class="bp-cd" data-cd="${ev.ev.start}">${countdown(ev.ev.start)}<small>until it starts</small></div>` : "";
  const bg = bpTheme==="dark" ? "#18181b" : "#f7f7f8";
  box.innerHTML = `
    <div class="page-head"><div><h1>${esc(v.title||b.name)}</h1><p class="lead">Everything you need to know about this Twitch global badge.</p></div>
      <div class="bp-side">${isFree(b)?'<span class="pill free">Free</span> ':''}${st==="live"?'<span class="pill live">Active</span>':st==="soon"?'<span class="pill soon">Upcoming</span>':st==="ended"?'<span class="pill na">Ended</span>':''}</div></div>
    ${previewCard(v.img)}
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
          <dt>Cost</dt><dd>${ev&&ev.b.cost==='paid'?'Paid (subscription / gift sub)':ev&&ev.b.cost==='free'?'Free':b.free||(!ev&&info.cost==='free')?'Free':(!ev&&info.cost==='paid')?'Paid (subscription / gift sub)':'—'}</dd>
        </dl>
      </div>
      <div class="card2"><h3>Availability</h3>
        ${cd}
        <dl class="kv2">
          <dt>Status</dt><dd>${st?(st==="tba"&&isStale(ev.ev)?"Ended (dates were never announced)":{live:"Active",soon:"Upcoming",ended:"Ended",tba:"Date not announced"}[st])
                                  :(info.objective||info.category)?"Ended — exact dates weren't recorded":"Not a timed event"}</dd>
          <dt>Objective</dt><dd>${ev&&ev.b.how&&!/^objective not/i.test(ev.b.how)?esc(ev.b.how):esc(info.objective||"—")}</dd>
          <dt>Category</dt><dd>${cat && !/any|unknown|twitch/i.test(cat)?`<a href="${catUrl(cat)}?filter=drops" target="_blank" rel="noopener">${esc(cat)}</a>`:esc(cat||"—")}</dd>
          <dt>Channels</dt><dd>${ev?channelsHtml(ev.ev, cat):"Any"}</dd>
          <dt>Started</dt><dd>${ev&&ev.ev.start?fmtFull(ev.ev.start):(info.objective||info.category)&&!ev?"Not recorded":"—"}</dd>
          <dt>Ends</dt><dd>${ev&&ev.ev.end?fmtFull(ev.ev.end):(info.objective||info.category)&&!ev?"Not recorded":"—"}</dd>
        </dl>
        ${ev?`<div class="actions" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-ev="${ev.ev.id}">Open event</button>${calendarMenu(ev.ev)}</div>`:''}
      </div>
      <div class="card2"><h3>Context</h3><p class="ctx">${context?esc(context):"No additional context yet. Follow twitch.tv/badge_db for updates."}</p>
        <h3 style="margin-top:18px">History</h3><dl class="kv2"><dt>Added</dt><dd>${b.added?fmt(b.added):"Before tracking started"}</dd></dl>
        <div class="actions" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost" href="${esc(v.img)}" target="_blank" rel="noopener">Open image</a><button class="btn ghost" data-copy="${esc(v.img)}">Copy image URL</button><button class="btn ghost" data-copy="${esc(location.origin+'/badges/'+encodeURIComponent(b.set)+'/')}">Copy page link</button></div>
      </div>
    </div>`;
}
document.addEventListener('click', e => {
  const t=e.target.closest('#bpTheme button'); if(t){ bpTheme=t.dataset.t; route(); e.preventDefault(); return; }
  const icsB = e.target.closest('[data-ics]'); if(icsB){ const ev = EVENTS.find(x => x.id === icsB.dataset.ics); if(ev) downloadIcs(ev); icsB.closest('details')?.removeAttribute('open'); return; }
  if(e.target.closest('[data-playhome]')){ $('#homeStream').innerHTML = `<iframe src="https://player.twitch.tv/?channel=${CONFIG.channel}&${PARENTS()}&muted=false&autoplay=true" allowfullscreen allow="autoplay; fullscreen"></iframe>`; return; }
  if(e.target.closest('[data-twlogin]')){ twLogin(); return; }
  if(e.target.closest('[data-twlogout]')){ twLogout(); return; }
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
    ${previewCard(b.img)}
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
async function admSavePopularity(){
  admSetStatus("Fetching badge popularity from potat.app…");
  const c = await livePopularity(true);
  if(!c){ admShowPopPaste(); return; }
  await admStorePopularity(c);
}
function admShowPopPaste(){
  admSetStatus("potat.app doesn't allow other sites to load its data automatically — paste it instead (see below).","err");
  const body = $('#admBody'); let box = $('#admPopBox');
  if(!box){ box = document.createElement('div'); box.id = 'admPopBox'; box.className = 'card2'; box.style.marginBottom = '16px'; body.prepend(box); }
  box.innerHTML = `<h3>Update badge popularity by hand</h3>
    <ol class="ctx" style="padding-left:20px;margin:8px 0 12px;display:flex;flex-direction:column;gap:4px">
      <li>Open <a href="${POTAT_URL}" target="_blank" rel="noopener" style="color:var(--purple-2);font-weight:700">${POTAT_URL}</a> in a new tab.</li>
      <li>Press <b>Ctrl+A</b>, then <b>Ctrl+C</b> on that page.</li>
      <li>Come back, click into the box below, press <b>Ctrl+V</b>, then <b>Save popularity</b>.</li></ol>
    <textarea id="admPopText" rows="6" style="width:100%;background:var(--bg);border:1px solid var(--line-2);border-radius:9px;color:var(--text);font:12px ui-monospace,monospace;padding:10px" placeholder="Paste the potat.app page here…"></textarea>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="admPopSave">Save popularity</button><button class="btn ghost" id="admPopClose">Cancel</button></div>`;
}
async function admStorePopularity(c){
  try{
    let sha; try{ sha = (await gh("contents/popularity.json?ref=main")).sha; }catch(_){}
    const body = {message:"Update badge popularity via admin", branch:"main",
      content: b64encode(JSON.stringify({updated:c.updated, source:c.source, counts:c.counts})), ...(sha?{sha}:{})};
    await gh("contents/popularity.json", {method:"PUT", body:JSON.stringify(body)});
    POP = c; applyPopularity(); renderPopularity(); renderGlobal();
    try{ localStorage.setItem(POP_CACHE, JSON.stringify({...c, t: Date.now()})); }catch(_){}
    $('#admPopBox')?.remove();
    admSetStatus(`Saved popularity for ${Object.keys(c.counts).length} badges — the site updates in a few minutes`,"ok");
  }catch(e){ admSetStatus("Could not save popularity: "+e.message,"err"); }
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
    <button class="btn ghost" id="admReload">Reload</button><button class="btn ghost" id="admNew">+ New event</button><button class="btn ghost" id="admPop" title="Fetch badge user counts from potat.app in this browser and save them to the site">Update popularity</button><button class="btn" id="admSave">Save changes</button>
    <button class="btn ghost" id="admLogout" title="Forget token on this device">Sign out</button>`;
  if(!ADM.events.length){ body.innerHTML = `<div class="empty">Loading events…</div>`; return; }
  const list = ADM.events.map((ev,i)=>({ev,i})).filter(({ev})=> ADM.filter==="all" ? true : ADM.filter==="needs" ? admNeeds(ev) : ["live","soon"].includes(status(ev)));
  const covered = new Set(ADM.events.flatMap(e=>e.badges.map(b=>b.img)));
  const spare = globalBadges.filter(b=>!covered.has(b.imgId)).sort((a,b)=>(b.added||'').localeCompare(a.added||'') || a.name.localeCompare(b.name));
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
      <label>Channels <span class="hint">optional — comma separated; leave empty if any channel in the category counts</span><input data-k="channels" value="${esc(evChannels(ev).join(', '))}" placeholder="e.g. ironmouse, caedrel"></label>
      <label class="chk"><input type="checkbox" data-k="channels_partial" ${ev.channels_partial?'checked':''}> The list is only part of the participating channels</label>
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
        ${spare.length?`<select data-addb><option value="">+ Add a badge to this event (newest first)…</option>${spare.map(s=>`<option value="${esc(s.imgId)}">${esc(s.name)}${s.added?` (${fmt(s.added)})`:''}</option>`).join('')}</select>`:''}
        <span style="flex:1"></span><button class="btn ghost" data-del="${i}">Delete event</button>
      </div>
    </div></details>`;
}
function admFromBadge(img){ const g = globalBadges.find(b=>b.imgId===img); return g ? { name:g.name, img:g.imgId, how:g.how||"Objective not announced yet.", cost:g.free?"free":"na" } : null; }

document.addEventListener('input', e=>{
  const card = e.target.closest('.adm-ev'); if(!card) return;
  const ev = ADM.events[+card.dataset.i];
  if(e.target.dataset.k){ const k=e.target.dataset.k, v=e.target.value.trim();
    if(k==="channels"){ const l=e.target.value.split(/[\s,;]+/).map(x=>x.replace(/^@/,'')).filter(Boolean); delete ev.channel; if(l.length) ev.channels=l; else delete ev.channels; admMarkDirty(); return; }
    if(k==="channels_partial") return;
    if(k==="start"||k==="end"){ ev[k]=fromLocalInput(e.target.value); ev.dates_src="manual"; }
    else if(v || k==="name" || k==="category") ev[k]=e.target.value; else delete ev[k];
    if(k==="name") ev.name_src="manual";
    admMarkDirty(); }
  if(e.target.dataset.bk){ const j=+e.target.closest('.adm-b').dataset.j; ev.badges[j][e.target.dataset.bk]=e.target.value; if(e.target.dataset.bk==="how") ev.badges[j].how_src="manual"; admMarkDirty(); }
});
document.addEventListener('change', e=>{
  if(e.target.matches('[data-k="channels_partial"]')){ const card=e.target.closest('.adm-ev'); const ev=ADM.events[+card.dataset.i]; if(e.target.checked) ev.channels_partial=true; else delete ev.channels_partial; admMarkDirty(); return; }
  if(e.target.matches('[data-bk="cost"]')){ const card=e.target.closest('.adm-ev'); ADM.events[+card.dataset.i].badges[+e.target.closest('.adm-b').dataset.j].cost=e.target.value; admMarkDirty(); }
  if(e.target.matches('[data-addb]') && e.target.value){ const card=e.target.closest('.adm-ev'); const nb=admFromBadge(e.target.value);
    if(nb){ ADM.events[+card.dataset.i].badges.push(nb); admMarkDirty(); renderAdmin(); document.querySelector(`.adm-ev[data-i="${card.dataset.i}"]`)?.setAttribute('open',''); } }
});
document.addEventListener('click', e=>{
  if(e.target.id==='admLogin'){ const t=$('#admTok').value.trim(); if(!t) return; ADM.token=t; try{localStorage.setItem("badgedb_gh_token",t);}catch(_){} renderAdmin(); admLoad(); return; }
  if(e.target.id==='admLogout'){ ADM.token=""; ADM.events=[]; try{localStorage.removeItem("badgedb_gh_token");}catch(_){} admSetStatus(""); renderAdmin(); return; }
  if(e.target.id==='admReload'){ if(!ADM.dirty || confirm("Discard unsaved changes?")) admLoad(); return; }
  if(e.target.id==='admSave'){ admSave(); return; }
  if(e.target.id==='admPop'){ admSavePopularity(); return; }
  if(e.target.id==='admPopClose'){ $('#admPopBox')?.remove(); return; }
  if(e.target.id==='admPopSave'){
    const raw = $('#admPopText').value, a = raw.search(/[\[{]/), z = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
    let j; try{ j = JSON.parse(raw.slice(a, z + 1)); }catch(_){ admSetStatus("That isn't the potat.app data — copy the whole page (Ctrl+A, Ctrl+C) and paste again.","err"); return; }
    const counts = parsePotat(j);
    if(Object.keys(counts).length < 10){ admSetStatus(`Only ${Object.keys(counts).length} badges recognised — is this the right page?`,"err"); return; }
    admStorePopularity({updated:new Date().toISOString().slice(0,10), source:"PotatBotat (potat.app)", counts}); return;
  }
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
    if(id==='evFilter') evFilter=v; if(id==='gSort') gSort=v; if(id==='gDir') gDir=v; if(id==='gFilter') gFilter=v; if(id==='cFilter') cFilter=v; if(id==='eSort') eSort=v; if(id==='eFilter') eFilter=v; if(id==='pFilter') pFilter=v; eShown=120; pShown=100; renderEmotes(); renderPopularity(); gShown=90; renderEvents(); renderGlobal(); renderChannel(); return; }
  if(e.target.id==='btnMore'){ gShown+=90; renderGlobal(); return; }
  if(e.target.id==='btnCMore'){ cShown+=90; renderChannel(); return; }
  if(e.target.id==='btnEMore'){ eShown+=120; renderEmotes(); return; }
  if(e.target.id==='btnPMore'){ pShown+=100; renderPopularity(); return; }
  const em=e.target.closest('[data-emote]'); if(em){ openEmote(em.dataset.emote); return; }
  const cb=e.target.closest('[data-cbadge]'); if(cb){ navigate('/channel/'+cb.dataset.cbadge+'/'); return; }
  const ev=e.target.closest('[data-ev]'); if(ev){ openEvent(ev.dataset.ev); return; }
  const oe=e.target.closest('[data-openev]'); if(oe){ openEvent(oe.dataset.openev); return; }
  const bd=e.target.closest('[data-badge]'); if(bd && bd.tagName!=='A'){ if(bd.dataset.type==='global') navigate('/badges/'+encodeURIComponent(bd.dataset.badge)+'/'); else openBadge(bd.dataset.badge,bd.dataset.type); return; }
  const cp=e.target.closest('[data-copy]'); if(cp){ navigator.clipboard?.writeText(cp.dataset.copy).then(()=>toast('Copied')); return; }
});
$('#qEv').addEventListener('input',e=>{evQuery=e.target.value.trim().toLowerCase();renderEvents();});
$('#qG').addEventListener('input',e=>{gQuery=e.target.value.trim().toLowerCase();gShown=90;renderGlobal();});
$('#qC').addEventListener('input',e=>{cQuery=e.target.value.trim().toLowerCase();cShown=90;renderChannel();});
$('#qE').addEventListener('input',e=>{eQuery=e.target.value.trim().toLowerCase();eShown=120;renderEmotes();});
$('#qP').addEventListener('input',e=>{pQuery=e.target.value.trim().toLowerCase();pShown=100;renderPopularity();});
$('#scrim').addEventListener('click',closeDrawer); $('#closeDrawer').addEventListener('click',closeDrawer);
$('#btnPlayer').addEventListener('click',togglePlayer); $('#btnPlayerX').addEventListener('click',togglePlayer);
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeDrawer(); });

// Pages built by the bot arrive pre-filled (data-ssr): keep that content until live data is loaded.
if(!document.body.dataset.ssr) renderAll();
route(); setInterval(tick,1000);
renderSideUser(); if(TW_USER) twFetchUser();
const getJSON = u => fetch(u, {cache:'no-store'}).then(r => r.ok ? r.json() : null);
Promise.allSettled([getJSON('/badges.json'), getJSON('/events.json'), getJSON('/popularity.json')]).then(([b, e, pp]) => {
  if(pp.status === 'fulfilled' && pp.value && pp.value.counts) POP = pp.value;
  if(b.status === 'fulfilled' && Array.isArray(b.value) && b.value.length) globalBadges = normalize(b.value);
  if(e.status === 'fulfilled' && Array.isArray(e.value) && e.value.length){ EVENTS = e.value; indexEvents(); }
  applyPopularity();
  READY = true; renderAll(); route();
  if(pathKey() === "/popularity/") maybeLivePopularity();
});
getJSON('/emotes.json').then(rows => { if(Array.isArray(rows)) EMOTES = rows; E_READY = true; renderEmotes(); renderStats(); }).catch(() => { E_READY = true; renderEmotes(); });
getJSON('/channel-badges.json').then(rows => {
  if(!Array.isArray(rows)) return;
  channelBadges = normChannel(rows); CH_READY = true; renderChannel();
  if(/^\/channel\/[^/]+\/$/.test(pathKey())) route();
}).catch(()=>{});
