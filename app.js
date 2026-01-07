/* GymApp Offline (v4)
   - Plan tab: Month -> Week -> Day (nested like folders)
   - Day view: cards with exercises (sets/reps/rest/target) + open exercise detail
   - Exercises tab: list + open sheet
   - Log tab: local IndexedDB diary
*/
const PLAN_SHEETS = ["Overview","January","February","March-Apr"];

let DATA = null;
let currentTab = "plan"; // plan | ex | log
let currentSheet = null;  // used for exercise detail
let currentPlan = { month: "January", weekIdx: 0, dayIdx: 0 };

const $ = (id)=>document.getElementById(id);

function normalize(s){ return (s||"").toLowerCase().trim(); }
function escapeHtml(str){
  return (str||"").toString().replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

/* ========= Plan parsing ========= */
function cellV(cell){ return (cell && cell.v!=null) ? String(cell.v).trim() : ""; }

function parseMonth(monthName){
  const sheet = DATA[monthName];
  if(!sheet) return {month: monthName, weeks: []};

  const grid = sheet.grid;
  const rows = grid.map(r => r.map(cellV));

  const weeks = [];
  let w = null;
  let d = null;

  const isWeekRow = (r)=> normalize(r[0]).startsWith("week ");
  const isDayRow  = (r)=> normalize(r[0]).startsWith("day ");

  for(let i=0;i<rows.length;i++){
    const r = rows[i];
    const first = r[0];

    if(!first) continue;

    if(isWeekRow(r)){
      // close previous
      if(d && w){ w.days.push(d); d=null; }
      if(w){ weeks.push(w); }
      w = { title: first, days: [], startRow: i };
      continue;
    }

    if(isDayRow(r)){
      if(!w){
        // sometimes a day appears before week; create a default week bucket
        w = { title: "Week", days: [], startRow: i };
      }
      if(d){ w.days.push(d); }
      d = { title: first, exercises: [], startRow: i };
      continue;
    }

    // within a day: look for exercise rows (skip header "Exercise")
    if(d){
      if(normalize(first)==="exercise") continue;
      // stop day if a new week/day begins (handled above) else parse exercise line if meaningful
      const ex = first;
      const sets = r[1] || "";
      const rest = r[2] || "";
      const target = r[3] || "";
      const notes = r[5] || "";
      // only treat as exercise if the name isn't empty and not just separators
      const joined = r.join(" ").trim();
      if(!joined) continue;
      if(joined.replace(/[-–—_ ]/g,"").length===0) continue;

      // filter out obvious section comments inside day (rare)
      // if sets/rest/target all empty but notes empty too, still might be a label; keep anyway
      d.exercises.push({ name: ex, sets, rest, target, notes });
    }
  }

  if(d && w){ w.days.push(d); }
  if(w){ weeks.push(w); }

  // Remove empty weeks/days
  const cleanWeeks = weeks.map(wk=>({
    title: wk.title,
    days: (wk.days||[]).filter(dd => (dd.exercises||[]).length>0)
  })).filter(wk=>wk.days.length>0);

  return { month: monthName, weeks: cleanWeeks };
}

let PLAN_INDEX = null; // { months: {January: {...}, ...} }

function buildPlanIndex(){
  const months = {};
  for(const m of ["January","February","March-Apr"]){
    months[m] = parseMonth(m);
  }
  PLAN_INDEX = months;

  // set a safe default currentPlan
  for(const m of Object.keys(months)){
    const mw = months[m].weeks;
    if(mw.length){
      currentPlan.month = m;
      currentPlan.weekIdx = 0;
      currentPlan.dayIdx = 0;
      break;
    }
  }
}

function setActiveTab(tab){
  currentTab = tab;
  ["tab-plan","tab-ex","tab-log"].forEach(t=>$(t).classList.remove("active"));
  $(`tab-${tab}`).classList.add("active");
  $("q").value = "";
  renderList();
  syncNav();
  if(tab==="log") renderLogView();
  if(tab==="ex") renderExerciseListLanding();
  if(tab==="plan") renderCurrentDay();
}

function syncNav(){
  const ids = ["nav-plan","nav-ex","nav-log"];
  for(const id of ids){
    const el = document.getElementById(id);
    if(!el) continue;
    el.classList.remove("active");
  }
  const activeId = currentTab==="plan" ? "nav-plan" : (currentTab==="ex" ? "nav-ex" : "nav-log");
  const el = document.getElementById(activeId);
  if(el) el.classList.add("active");
}

/* ========= Sidebar list ========= */
function renderList(){
  const list = $("list");
  list.innerHTML = "";
  if(!DATA) return;

  const q = normalize($("q").value);

  if(currentTab==="plan"){
    // Month -> Week -> Day tree
    for(const mName of Object.keys(PLAN_INDEX)){
      const monthObj = PLAN_INDEX[mName];
      if(!monthObj.weeks.length) continue;

      const mHeader = document.createElement("div");
      mHeader.className="sectionTitle";
      mHeader.textContent=mName;
      list.appendChild(mHeader);

      monthObj.weeks.forEach((wk, wi)=>{
        const wkDiv = document.createElement("div");
        wkDiv.className="item" + ((currentPlan.month===mName && currentPlan.weekIdx===wi) ? " active" : "");
        wkDiv.innerHTML = `<div>📦 ${escapeHtml(wk.title)}</div><small>${wk.days.length} day</small>`;
        wkDiv.onclick = ()=>{
          currentPlan.month = mName;
          currentPlan.weekIdx = wi;
          currentPlan.dayIdx = 0;
          renderList();
          renderCurrentDay();
        };
        // filter by search: if q is set, only show weeks/days matching
        if(q && !normalize(wk.title).includes(q) && !wk.days.some(d=>normalize(d.title).includes(q) || d.exercises.some(e=>normalize(e.name).includes(q)))) {
          return;
        }
        list.appendChild(wkDiv);

        // days under week
        wk.days.forEach((day, di)=>{
          if(q && !(normalize(day.title).includes(q) || day.exercises.some(e=>normalize(e.name).includes(q)))) return;

          const dayDiv = document.createElement("div");
          dayDiv.className="item";
          dayDiv.style.marginLeft="14px";
          const active = (currentPlan.month===mName && currentPlan.weekIdx===wi && currentPlan.dayIdx===di);
          dayDiv.className = "item" + (active ? " active" : "");
          dayDiv.innerHTML = `<div>📄 ${escapeHtml(day.title)}</div><small>${day.exercises.length} esercizi</small>`;
          dayDiv.onclick = ()=>{
            currentPlan.month = mName;
            currentPlan.weekIdx = wi;
            currentPlan.dayIdx = di;
            renderList();
            renderCurrentDay();
          };
          list.appendChild(dayDiv);
        });
      });
    }
    return;
  }

  if(currentTab==="ex"){
    const allNames = Object.keys(DATA).filter(n=>!PLAN_SHEETS.includes(n));
    const filtered = allNames.filter(n=>!q || normalize(n).includes(q)).sort((a,b)=>a.localeCompare(b));
    const h = document.createElement("div");
    h.className="sectionTitle";
    h.textContent="Esercizi";
    list.appendChild(h);
    for(const name of filtered){
      const div = document.createElement("div");
      div.className="item" + (currentSheet===name ? " active":"");
      div.innerHTML = `<div>💪 ${escapeHtml(name)}</div><small>Scheda tecnica</small>`;
      div.onclick = ()=>renderExerciseDetail(name);
      list.appendChild(div);
    }
    return;
  }

  if(currentTab==="log"){
    const h = document.createElement("div");
    h.className="sectionTitle";
    h.textContent="Log";
    list.appendChild(h);
    const div = document.createElement("div");
    div.className="item active";
    div.innerHTML = `<div>📝 Diario allenamento</div><small>Solo sul tuo iPhone</small>`;
    list.appendChild(div);
    return;
  }
}

/* ========= Plan views ========= */
function getCurrentDayObj(){
  const m = PLAN_INDEX[currentPlan.month];
  if(!m) return null;
  const w = m.weeks[currentPlan.weekIdx];
  if(!w) return null;
  const d = w.days[currentPlan.dayIdx];
  if(!d) return null;
  return {month: currentPlan.month, weekTitle: w.title, day: d, weekIdx: currentPlan.weekIdx, dayIdx: currentPlan.dayIdx};
}

function renderCurrentDay(){
  const obj = getCurrentDayObj();
  const container = $("content");
  container.innerHTML = "";

  if(!obj){
    $("title").textContent = "Piano";
    $("subtitle").textContent = "Nessun dato trovato";
    container.innerHTML = `<div class="card"><h3>Nessun piano</h3><div class="hint">Non riesco a leggere la struttura del mese. Dimmi se vuoi che la adatti a mano.</div></div>`;
    return;
  }

  $("title").textContent = obj.day.title;
  $("subtitle").textContent = `${obj.month} • ${obj.weekTitle}`;

  // header controls
  const header = document.createElement("div");
  header.className="card";
  header.innerHTML = `
    <h3>Sessione</h3>
    <div class="hint">Scorri gli esercizi. Tocca “Dettagli” per la scheda tecnica. I link esterni (immagini) restano disponibili nella scheda esercizio.</div>
    <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn" id="btnPrevDay">⬅️ Giorno</button>
      <button class="btn" id="btnNextDay">Giorno ➡️</button>
      <button class="btn" id="btnOpenMonthTable">🗂️ Apri tabella mese</button>
    </div>
  `;
  container.appendChild(header);

  header.querySelector("#btnPrevDay").onclick = ()=>stepDay(-1);
  header.querySelector("#btnNextDay").onclick = ()=>stepDay(1);
  header.querySelector("#btnOpenMonthTable").onclick = ()=>renderRawSheet(obj.month);

  // exercises
  const list = document.createElement("div");
  list.className="split";

  obj.day.exercises.forEach((ex, idx)=>{
    const c = document.createElement("div");
    c.className="card";
    const hasSheet = Object.prototype.hasOwnProperty.call(DATA, ex.name);
    const target = ex.target && ex.target.startsWith("=") ? "calcolato in Excel" : (ex.target || "");
    c.innerHTML = `
      <h3>${idx+1}. ${escapeHtml(ex.name)}</h3>
      <div class="row" style="margin-top:8px">
        ${ex.sets ? `<span class="pill" style="cursor:default" data-ico="🔁">${escapeHtml(ex.sets)}</span>` : ""}
        ${ex.rest ? `<span class="pill" style="cursor:default" data-ico="⏱️">${escapeHtml(ex.rest)}</span>` : ""}
        ${target ? `<span class="pill" style="cursor:default" data-ico="🎯">${escapeHtml(target)}</span>` : ""}
      </div>
      ${ex.notes ? `<div class="hint" style="margin-top:10px">${escapeHtml(ex.notes)}</div>` : ``}
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
        ${hasSheet ? `<button class="btn primary" data-open="${escapeHtml(ex.name)}">📄 Dettagli</button>` : `<span class="hint">Nessuna scheda trovata</span>`}
        <button class="btn" data-addlog="${escapeHtml(ex.name)}">📝 Log</button>
      </div>
    `;
    list.appendChild(c);
  });

  container.appendChild(list);

  // wire buttons
  container.querySelectorAll("button[data-open]").forEach(b=>{
    b.onclick = ()=>renderExerciseDetail(b.getAttribute("data-open"));
  });
  container.querySelectorAll("button[data-addlog]").forEach(b=>{
    const name = b.getAttribute("data-addlog");
    b.onclick = async ()=>{
      setActiveTab("log");
      // preselect exercise inside log view
      setTimeout(()=>{
        const sel = document.getElementById("logEx");
        if(sel){ sel.value = name; }
      }, 50);
    };
  });
}

function stepDay(delta){
  const m = PLAN_INDEX[currentPlan.month];
  if(!m) return;
  let wi = currentPlan.weekIdx;
  let di = currentPlan.dayIdx + delta;

  while(true){
    const w = m.weeks[wi];
    if(!w) break;
    if(di >=0 && di < w.days.length){
      currentPlan.weekIdx = wi;
      currentPlan.dayIdx = di;
      break;
    }
    if(di < 0){
      wi -= 1;
      if(wi < 0) wi = 0;
      di = (m.weeks[wi] ? m.weeks[wi].days.length-1 : 0);
      if(wi===0 && di<0) di=0;
    } else {
      wi += 1;
      if(wi >= m.weeks.length){ wi = m.weeks.length-1; di = m.weeks[wi].days.length-1; }
      else di = 0;
    }
    // stop if stuck
    if(wi===currentPlan.weekIdx && di===currentPlan.dayIdx) break;
  }

  renderList();
  renderCurrentDay();
}

/* ========= Exercise sheet (raw) ========= */
function isInternalLink(link){
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

function renderExerciseListLanding(){
  currentSheet = null;
  $("title").textContent="Esercizi";
  $("subtitle").textContent="Apri una scheda tecnica dalla lista";
  const container=$("content");
  container.innerHTML = `<div class="card"><h3>Catalogo esercizi</h3><div class="hint">Cerca a sinistra e apri una scheda. I link blu aprono la ricerca Google Images.</div></div>`;
}

function renderExerciseDetail(name){
  currentSheet = name;
  renderList();
  $("title").textContent = name;
  $("subtitle").textContent = "Scheda esercizio";

  renderRawSheet(name, true);
}

function renderRawSheet(sheetName, fromExercise=false){
  const sheet = DATA[sheetName];
  const { grid, min_row, min_col, max_col } = sheet;

  const container = $("content");
  container.innerHTML = "";

  const top = document.createElement("div");
  top.className="card";
  top.innerHTML = `
    <h3>${fromExercise ? "Quick guide" : "Tabella completa"}</h3>
    <div class="hint">${fromExercise ? "Link blu = immagini. Link interni = navigazione dentro l’app." : "Questa è la tabella originale del foglio. Utile se vuoi vedere formule / colonne."}</div>
  `;
  container.appendChild(top);

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
          a.href="#";
          a.textContent = v || internal.sheet;
          a.onclick = (ev)=>{ ev.preventDefault(); 
            if(PLAN_SHEETS.includes(internal.sheet)) { currentTab="plan"; setActiveTab("plan"); renderRawSheet(internal.sheet,false); }
            else { setActiveTab("ex"); renderExerciseDetail(internal.sheet); }
          };
          td.appendChild(a);
        } else {
          const a = document.createElement("a");
          a.href = l;
          a.target="_blank";
          a.rel="noopener";
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

function colLetter(n){
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
    req.onupgradeneeded = ()=>{
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
    <h3>Scrivi una nota</h3>
    <div class="row" style="margin-bottom:10px">
      <input id="logDate" type="date" />
      <select id="logEx" aria-label="Esercizio"></select>
      <input id="logActual" placeholder="Actual (es. 60kg x5)" />
    </div>
    <textarea id="logNote" placeholder="Note / RIR / sensazioni…"></textarea>
    <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn primary" id="btnSaveLog">✅ Salva</button>
      <div class="hint">Suggerimento: scrivi 1 riga per set pesante (RIR incluso).</div>
    </div>
  `;
  container.appendChild(card);

  const sel = card.querySelector("#logEx");
  for(const ex of exercises){
    const opt=document.createElement("option");
    opt.value=ex; opt.textContent=ex;
    sel.appendChild(opt);
  }
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
  a.download="gymapp_offline_backup.json";
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

  buildPlanIndex();
  await openDb();
  await registerSw();

  // UI bindings
  $("q").addEventListener("input", ()=>renderList());
  $("tab-plan").onclick = ()=>setActiveTab("plan");
  $("tab-ex").onclick = ()=>setActiveTab("ex");
  $("tab-log").onclick = ()=>setActiveTab("log");
  const np=document.getElementById("nav-plan"); if(np) np.onclick=()=>setActiveTab("plan");
  const ne=document.getElementById("nav-ex"); if(ne) ne.onclick=()=>setActiveTab("ex");
  const nl=document.getElementById("nav-log"); if(nl) nl.onclick=()=>setActiveTab("log");

  $("btnToggleView").style.display="none"; // v4: plan is folder view; hide old toggle
  $("btnExport").onclick = ()=>exportBackup();
  $("btnReset").onclick = ()=>resetAll();

  // start
  setActiveTab("plan");
}
init();
