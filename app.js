/* Offline Workout Plan Viewer + Simple Log
   - Reads embedded Excel->JSON (data.json)
   - Shows sheets (Plan + Exercise sheets)
   - Stores your personal logs locally in IndexedDB
*/
const PLAN_SHEETS = ["Overview","January","February","March-Apr"];

let DATA = null;
let currentTab = "plan"; // plan | ex | log
let currentSheet = null;

const $ = (id)=>document.getElementById(id);

function setActiveTab(tab){
  currentTab = tab;
  ["tab-plan","tab-ex","tab-log"].forEach(t=>$(t).classList.remove("active"));
  $(`tab-${tab}`).classList.add("active");
  $("q").value = "";
  renderList();
  if(tab==="log") renderLogView();
  else renderSheet( (tab==="plan") ? "Overview" : firstExerciseSheet() );
}

function firstExerciseSheet(){
  const all = Object.keys(DATA||{});
  for(const s of all){
    if(!PLAN_SHEETS.includes(s)) return s;
  }
  return "Overview";
}

function sheetGroup(sheetName){
  return PLAN_SHEETS.includes(sheetName) ? "Piano" : "Esercizi";
}

function normalize(s){ return (s||"").toLowerCase(); }

function renderList(){
  const list = $("list");
  list.innerHTML = "";
  if(!DATA) return;

  const q = normalize($("q").value);
  const allNames = Object.keys(DATA);

  const filtered = allNames.filter(n=>{
    if(currentTab==="plan" && !PLAN_SHEETS.includes(n)) return false;
    if(currentTab==="ex" && PLAN_SHEETS.includes(n)) return false;
    if(currentTab==="log") return false;
    return !q || normalize(n).includes(q);
  });

  const bySection = new Map();
  for(const n of filtered){
    const sec = sheetGroup(n);
    if(!bySection.has(sec)) bySection.set(sec, []);
    bySection.get(sec).push(n);
  }

  for(const [sec, items] of bySection.entries()){
    const h = document.createElement("div");
    h.className="sectionTitle";
    h.textContent=sec;
    list.appendChild(h);

    items.sort((a,b)=>a.localeCompare(b));
    for(const name of items){
      const div = document.createElement("div");
      div.className="item" + (currentSheet===name ? " active":"");
      div.innerHTML = `<div>${escapeHtml(name)}</div><small>Tocca per aprire</small>`;
      div.onclick = ()=>renderSheet(name);
      list.appendChild(div);
    }
  }

  if(currentTab==="log"){
    const h = document.createElement("div");
    h.className="sectionTitle";
    h.textContent="Log";
    list.appendChild(h);
    const div = document.createElement("div");
    div.className="item active";
    div.innerHTML = `<div>Workout Log</div><small>Note personali sul training</small>`;
    list.appendChild(div);
  }
}

function escapeHtml(str){
  return (str||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

function renderSheet(name){
  if(!DATA) return;
  currentSheet = name;
  // highlight active item
  renderList();

  $("title").textContent = name;
  $("subtitle").textContent = (PLAN_SHEETS.includes(name) ? "Piano allenamento" : "Scheda esercizio");

  const sheet = DATA[name];
  const { grid, min_row, min_col, max_row, max_col } = sheet;

  const container = $("content");
  container.innerHTML = "";
  if(PLAN_SHEETS.includes(name) && readablePlan){
    renderPlanReadable(name);
    return;
  }

  // small hint for exercise sheets
  if(!PLAN_SHEETS.includes(name)){
    const card = document.createElement("div");
    card.className="card";
    card.innerHTML = `
      <h3>Tip veloce</h3>
      <div class="hint">Se vedi un link (blu), è quello che nel tuo Excel portava alla ricerca Google Images. Toccalo e si apre nel browser.</div>
    `;
    container.appendChild(card);
  }

  const wrap = document.createElement("div");
  wrap.style.overflow="auto";

  const table = document.createElement("table");
  table.className="grid";

  // header row with column letters
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  const th0 = document.createElement("th");
  th0.textContent = "";
  trh.appendChild(th0);

  const colCount = max_col - min_col + 1;
  for(let i=0;i<colCount;i++){
    const th = document.createElement("th");
    th.textContent = colLetter(min_col + i);
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for(let r=0;r<grid.length;r++){
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = String(min_row + r);
    tr.appendChild(th);

    for(let c=0;c<grid[r].length;c++){
      const td = document.createElement("td");
      const cell = grid[r][c] || {v:"",l:null};
      const v = cell.v ?? "";
      const l = cell.l;
      if(l){
        const internal = isInternalLink(l);
        if(internal){
          const a = document.createElement("a");
          a.href = "#";
          a.textContent = v || internal.sheet;
          a.onclick = (ev)=>{ ev.preventDefault(); renderSheet(internal.sheet); };
          td.appendChild(a);
        } else {
          const a = document.createElement("a");
          a.href = l;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = v || l;
          td.appendChild(a);
        }
      } else {
        td.textContent = v;
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}


function isInternalLink(link){
  // Excel internal hyperlinks often look like "#Sheet!A1" or "#'Sheet Name'!A1"
  if(!link) return null;
  const s = String(link);
  if(s.startsWith("#")){
    const t = s.slice(1);
    const m = t.match(/^'([^']+)'!/) || t.match(/^([^!]+)!/);
    if(m) return {sheet: m[1].trim()};
    if(t.trim()) return {sheet: t.trim().replace(/^'|'$/g,"")};
  }
  if(s.includes("!") && !s.startsWith("http")){
    const m = s.match(/^'([^']+)'!/) || s.match(/^([^!]+)!/);
    if(m) return {sheet: m[1].trim()};
  }
  return null;
}

let readablePlan = true;

function renderPlanReadable(sheetName){
  const sheet = DATA[sheetName];
  const { grid } = sheet;
  const rows = grid.map(r => r.map(c => (c?.v ?? "").toString().trim()));
  let headerIdx = rows.findIndex(r => r.join(" ").toLowerCase().includes("exercise") || r.join(" ").toLowerCase().includes("sets") || r.join(" ").toLowerCase().includes("reps"));
  if(headerIdx<0) headerIdx = 0;

  const items=[];
  for(let i=headerIdx+1;i<rows.length;i++){
    const r = rows[i];
    const joined=r.join(" ").trim();
    if(!joined) continue;
    if(joined.replace(/[-–—_ ]/g,"").length===0) continue;
    const exIdx = r.findIndex(x=>x);
    if(exIdx<0) continue;
    const ex = r[exIdx];
    const rest = r.slice(exIdx+1).filter(x=>x);
    items.push({exercise: ex, cols: rest.slice(0,6)});
  }

  const container = $("content");
  container.innerHTML="";
  const top = document.createElement("div");
  top.className="card";
  top.innerHTML = `
    <h3>Piano (vista leggibile)</h3>
    <div class="hint">Vista più pulita della tabella. Se vuoi la tabella completa, usa il bottone “Vista” in alto.</div>
  `;
  container.appendChild(top);

  const list = document.createElement("div");
  list.className="split";
  for(const it of items){
    const c=document.createElement("div");
    c.className="card";
    c.innerHTML = `<h3>${escapeHtml(it.exercise)}</h3>
      <div class="hint">${escapeHtml(it.cols.join(" • "))}</div>`;
    list.appendChild(c);
  }
  container.appendChild(list);
}

function colLetter(n){
  // 1->A
  let s="";
  while(n>0){
    const m=(n-1)%26;
    s=String.fromCharCode(65+m)+s;
    n=Math.floor((n-1)/26);
  }
  return s;
}

/* ========= Local log (IndexedDB) ========= */
const DB_NAME="workout_offline_db";
const DB_VER=1;
let db=null;

function openDb(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e)=>{
      const d = req.result;
      if(!d.objectStoreNames.contains("logs")){
        const store = d.createObjectStore("logs", { keyPath:"id" });
        store.createIndex("byDate","date");
        store.createIndex("byExercise","exercise");
      }
    };
    req.onsuccess = ()=>{ db=req.result; resolve(db); };
    req.onerror = ()=>reject(req.error);
  });
}

function addLog(entry){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(["logs"],"readwrite");
    tx.objectStore("logs").put(entry);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

function getAllLogs(){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(["logs"],"readonly");
    const req = tx.objectStore("logs").getAll();
    req.onsuccess=()=>resolve(req.result||[]);
    req.onerror=()=>reject(req.error);
  });
}

function clearAll(){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(["logs"],"readwrite");
    const req = tx.objectStore("logs").clear();
    req.onsuccess=()=>resolve();
    req.onerror=()=>reject(req.error);
  });
}

async function renderLogView(){
  currentSheet=null;
  $("title").textContent="Workout Log";
  $("subtitle").textContent="Salvato solo sul tuo iPhone (offline)";
  const container=$("content");
  container.innerHTML="";

  const exercises = Object.keys(DATA||{}).filter(n=>!PLAN_SHEETS.includes(n)).sort((a,b)=>a.localeCompare(b));
  const card = document.createElement("div");
  card.className="card";
  card.innerHTML = `
    <h3>Aggiungi nota</h3>
    <div class="row" style="margin-bottom:10px">
      <input id="logDate" type="date" />
      <select id="logEx" aria-label="Esercizio"></select>
      <input id="logActual" placeholder="Actual (es. 60kg x5)" />
    </div>
    <textarea id="logNote" placeholder="Note / RIR / sensazioni…"></textarea>
    <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn" id="btnSaveLog">Salva</button>
      <div class="hint">Consiglio: usalo come diario rapido. I dati restano sul telefono.</div>
    </div>
  `;
  container.appendChild(card);

  // fill select
  const sel = card.querySelector("#logEx");
  for(const ex of exercises){
    const opt=document.createElement("option");
    opt.value=ex; opt.textContent=ex;
    sel.appendChild(opt);
  }
  // default date today
  const today = new Date();
  const yyyy=today.getFullYear();
  const mm=String(today.getMonth()+1).padStart(2,"0");
  const dd=String(today.getDate()).padStart(2,"0");
  card.querySelector("#logDate").value = `${yyyy}-${mm}-${dd}`;

  card.querySelector("#btnSaveLog").onclick = async ()=>{
    const entry = {
      id: crypto.randomUUID(),
      date: card.querySelector("#logDate").value,
      exercise: card.querySelector("#logEx").value,
      actual: card.querySelector("#logActual").value.trim(),
      note: card.querySelector("#logNote").value.trim(),
      ts: Date.now()
    };
    await addLog(entry);
    card.querySelector("#logActual").value="";
    card.querySelector("#logNote").value="";
    await renderLogList();
  };

  const listCard = document.createElement("div");
  listCard.className="card";
  listCard.innerHTML = `<h3>Storico</h3><div class="logList" id="logList"></div>`;
  container.appendChild(listCard);

  await renderLogList();
}

async function renderLogList(){
  const logs = (await getAllLogs()).sort((a,b)=>b.ts-a.ts);
  const el = $("content").querySelector("#logList");
  el.innerHTML = "";
  if(!logs.length){
    const div=document.createElement("div");
    div.className="hint";
    div.textContent="Nessuna nota ancora. Quando inizi ad usarlo, qui vedi tutto lo storico.";
    el.appendChild(div);
    return;
  }
  for(const l of logs){
    const div=document.createElement("div");
    div.className="logItem";
    div.innerHTML = `
      <div class="meta">
        <span><b>${escapeHtml(l.date||"")}</b></span>
        <span>${escapeHtml(l.exercise||"")}</span>
        ${l.actual ? `<span>• ${escapeHtml(l.actual)}</span>` : ""}
      </div>
      ${l.note ? `<div class="txt">${escapeHtml(l.note)}</div>` : ""}
    `;
    el.appendChild(div);
  }
}

/* ========= Backup/export ========= */
async function exportBackup(){
  const logs = await getAllLogs();
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    logs
  };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url;
  a.download="workout_offline_backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function resetAll(){
  if(!confirm("Sei sicuro? Cancello solo i tuoi LOG locali. Il piano resta.")) return;
  await clearAll();
  if(currentTab==="log") await renderLogView();
  alert("Ok: log locali cancellati.");
}

/* ========= SW registration ========= */
async function registerSw(){
  if("serviceWorker" in navigator){
    try{ await navigator.serviceWorker.register("sw.js"); }
    catch(e){ console.warn("SW registration failed", e); }
  }
}

async function init(){
  $("title").textContent="Caricamento…";
  const res = await fetch("data.json");
  DATA = await res.json();

  await openDb();
  await registerSw();

  // UI bindings
  $("q").addEventListener("input", ()=>renderList());
  $("tab-plan").onclick = ()=>setActiveTab("plan");
  $("tab-ex").onclick = ()=>setActiveTab("ex");
  $("tab-log").onclick = ()=>setActiveTab("log");
  $("btnToggleView").onclick = ()=>{ readablePlan = !readablePlan; $("btnToggleView").textContent = "Vista: " + (readablePlan ? "Leggibile" : "Tabella"); if(currentTab==="plan") renderSheet(currentSheet||"Overview"); };
  $("btnExport").onclick = ()=>exportBackup();
  $("btnReset").onclick = ()=>resetAll();

  // start
  setActiveTab("plan");
}
init();
