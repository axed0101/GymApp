const APP_VERSION = "11.3.3";
/* GymApp Offline (v4)
   - Plan tab: Month -> Week -> Day (nested like folders)
   - Day view: cards with exercises (sets/reps/rest/target) + open exercise detail
   - Exercises tab: list + open sheet
   - Log tab: local IndexedDB diary
*/
const PLAN_SHEETS = ["Overview","January","February","March-Apr"];
const MONTH_ORDER = ["January","February","March-Apr"];

let DATA = null;
let currentTab = "plan"; // plan | ex | log
let currentSheet = null;  // used for exercise detail
let openWeekKey = null;

let currentPlan = { month: "January", weekIdx: null, dayIdx: null };

const $ = (id)=>document.getElementById(id);

function isMobile(){
  return window.innerWidth <= 860;
}
function enterMobileDetail(){
  if(!isMobile()) return;
  document.body.classList.add("mobileDetail");
  window.scrollTo({top:0, behavior:"smooth"});
}
function exitMobileDetail(){
  document.body.classList.remove("mobileDetail");
}


function normalize(s){ return (s||"").toLowerCase().trim(); }
function showModal(message, title="Avviso"){
  const ov = document.getElementById("modalOverlay");
  const t = document.getElementById("modalTitle");
  const b = document.getElementById("modalBody");
  const close = ()=>{ ov.style.display="none"; };
  t.textContent = title;
  b.textContent = message;
  ov.style.display="flex";
  document.getElementById("modalClose").onclick = close;
  document.getElementById("modalOk").onclick = close;
}

function cssEscape(s){
  try{ if(window.CSS && typeof CSS.escape==="function") return CSS.escape(s); }catch(e){}
  return String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"');
}

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

  // set a safe default currentPlan (month only). 
  // Do NOT auto-select week/day on startup (especially on iOS PWA), so the user lands on the folder list.
  currentPlan.weekIdx = null;
  currentPlan.dayIdx = null;
  for(const m of Object.keys(months)){
    const mw = months[m].weeks;
    if(mw.length){
      currentPlan.month = m;
      break;
    }
  }
}

function setActiveTab(tab){
  currentTab = tab;
  ["tab-plan","tab-ex"].forEach(t=>{ const el=$(t); if(el) el.classList.remove("active"); });
  const active = $(`tab-${tab}`);
  if(active) active.classList.add("active");
  $("q").value = "";
  exitMobileDetail();
  renderList();
  syncNav();
  if(tab==="ex") renderExerciseListLanding();
  if(tab==="plan"){
    // On app start we don't auto-open a day; show landing until user selects one.
    if(typeof currentPlan.weekIdx==="number" && typeof currentPlan.dayIdx==="number") renderCurrentDay();
    else renderPlanLanding();
  }
}
function syncNav(){
  const ids = ["nav-plan","nav-ex"];
  for(const id of ids){
    const el = document.getElementById(id);
    if(!el) continue;
    el.classList.remove("active");
  }
  const activeId = currentTab==="plan" ? "nav-plan" : "nav-ex";
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
        const weekKey = mName + "|" + wi;
        const weekMatches = (!q) ? true : (normalize(wk.title).includes(q) || wk.days.some(d=>normalize(d.title).includes(q) || d.exercises.some(e=>normalize(e.name).includes(q))));
        if(q && !weekMatches) return;

        const isOpen = (openWeekKey === weekKey) || (q && weekMatches);
        const isActiveWeek = (currentPlan.month===mName && currentPlan.weekIdx===wi);

        const wkDiv = document.createElement("div");
        wkDiv.className = "item" + (isActiveWeek ? " active" : "");
        wkDiv.innerHTML = `<div>${isOpen ? "📂" : "📁"} ${escapeHtml(wk.title)}</div><small>${wk.days.length} day</small>`;
        wkDiv.onclick = ()=>{
          // Accordion: open/close the week without auto-selecting any day
          openWeekKey = (openWeekKey === weekKey) ? null : weekKey;
          renderList();
        };
        list.appendChild(wkDiv);

        if(!isOpen) return;

        // days under week
        wk.days.forEach((day, di)=>{
          if(q && !(normalize(day.title).includes(q) || day.exercises.some(e=>normalize(e.name).includes(q)))) return;

          const dayDiv = document.createElement("div");
          dayDiv.style.marginLeft = "14px";
          const active = (currentPlan.month===mName && currentPlan.weekIdx===wi && currentPlan.dayIdx===di);
          dayDiv.className = "item" + (active ? " active" : "");
          dayDiv.innerHTML = `<div>📄 ${escapeHtml(day.title)}</div><small>${day.exercises.length} esercizi</small>`;
          dayDiv.onclick = ()=>{
            currentPlan.month = mName;
            currentPlan.weekIdx = wi;
            currentPlan.dayIdx = di;
            // keep the week open after selecting a day
            openWeekKey = weekKey;
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

function renderPlanLanding(){
  currentSheet = null;
  $("title").textContent = "Piano";
  $("subtitle").textContent = "Seleziona una settimana e poi un day workout";
  const container = $("content");
  container.innerHTML = `
    <div class="card">
      <h3>👈 Scegli dalla lista</h3>
      <div class="hint" style="margin-top:10px">
        Tocca una <b>settimana</b> per aprire/chiudere l’elenco, poi scegli il <b>day workout</b>.
        <br/>Su iPhone così non ti si apre niente “a tradimento”.
      </div>
    </div>
  `;
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

async function renderCurrentDay(){
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
  enterMobileDetail();

  // header controls
  const header = document.createElement("div");
  header.className="card";
  header.innerHTML = `
    <h3>Sessione</h3>
    <div class="hint">Scorri gli esercizi. Tocca “Dettagli” per la scheda tecnica. I link esterni (immagini) restano disponibili nella scheda esercizio.</div>
    <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn" id="btnPrevDay">⬅️ Giorno</button>
      <button class="btn" id="btnNextDay">Giorno ➡️</button>
      <button class="btn" id="btnPrevWeek">⬅️ Settimana</button>
      <button class="btn" id="btnNextWeek">Settimana ➡️</button>
      <button class="btn" id="btnOpenMonthTable">🗂️ Tabella mese</button>
    </div>
  `;
  container.appendChild(header);

  header.querySelector("#btnPrevDay").onclick = ()=>stepDay(-1);
  header.querySelector("#btnNextDay").onclick = ()=>stepDay(1);
  header.querySelector("#btnPrevWeek").onclick = ()=>stepWeek(-1);
  header.querySelector("#btnNextWeek").onclick = ()=>stepWeek(1);
  header.querySelector("#btnOpenMonthTable").onclick = ()=>{ renderRawSheet(obj.month); enterMobileDetail(); };

  // exercises
  const list = document.createElement("div");
  list.className="split";

  obj.day.exercises.forEach((ex, idx)=>{
    const c = document.createElement("div");
    c.className="card";
    const hasSheet = Object.prototype.hasOwnProperty.call(DATA, ex.name);
    c.innerHTML = `
      <h3>${idx+1}. ${escapeHtml(ex.name)}</h3>
      <div class="row" style="margin-top:8px">
        ${ex.sets ? `<span class="pill" style="cursor:default" data-ico="🔁">${escapeHtml(ex.sets)}</span>` : ""}
        ${ex.rest ? `<span class="pill" style="cursor:default" data-ico="⏱️">${escapeHtml(ex.rest)}</span>` : ""}
      </div>
      ${ex.notes ? `<div class="hint" style="margin-top:10px">${escapeHtml(ex.notes)}</div>` : ``}
      <div class="field">
        <label>Kg usati oggi</label>
        <input inputmode="decimal" placeholder="es. 80" data-kg="${escapeHtml(ex.name)}" />
      </div>
      <div class="field">
        <label>Note (esecuzione / RIR / sensazioni)</label>
        <textarea placeholder="Scrivi qui…" data-note="${escapeHtml(ex.name)}"></textarea>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
        ${hasSheet ? `<button class="btn primary" data-open="${escapeHtml(ex.name)}">📄 Dettagli</button>` : `<span class="hint">Nessuna scheda trovata</span>`}
</div>
    `;
    list.appendChild(c);
  });

  container.appendChild(list);


  try{
  // load + autosave per-exercise fields (kg + note) for this day workout
  const dayKey = `${obj.month}||${obj.weekTitle}||${obj.day.title}`;
  const loadOne = async (exName)=>{
    const id = `${dayKey}||${exName}`;
    const entry = await getDayEntryAny(id);
    const kgEl = container.querySelector(`input[data-kg="${cssEscape(exName)}"]`);
    const noteEl = container.querySelector(`textarea[data-note="${cssEscape(exName)}"]`);
    if(entry){
      if(kgEl) kgEl.value = entry.kg || "";
      if(noteEl) noteEl.value = entry.note || "";
    }
  };
  const saveOne = async (exName)=>{
    const id = `${dayKey}||${exName}`;
    const kgEl = container.querySelector(`input[data-kg="${cssEscape(exName)}"]`);
    const noteEl = container.querySelector(`textarea[data-note="${cssEscape(exName)}"]`);
    const payload = {
      id,
      dayKey,
      month: obj.month,
      weekTitle: obj.weekTitle,
      dayTitle: obj.day.title,
      exercise: exName,
      kg: kgEl ? kgEl.value.trim() : "",
      note: noteEl ? noteEl.value.trim() : "",
      ts: Date.now()
    };
    await upsertDayEntryAny(payload);
  };

  const exNames = obj.day.exercises.map(e=>e.name);
  await Promise.all(exNames.map(loadOne));

  // debounce saves
  const timers = new Map();
  const debouncedSave = (exName)=>{
    if(timers.has(exName)) clearTimeout(timers.get(exName));
    timers.set(exName, setTimeout(()=>saveOne(exName), 450));
  };

  container.querySelectorAll("input[data-kg]").forEach(inp=>{
    const exName = inp.getAttribute("data-kg");
    inp.addEventListener("input", ()=>debouncedSave(exName));
    inp.addEventListener("blur", ()=>saveOne(exName));
  });
  container.querySelectorAll("textarea[data-note]").forEach(tx=>{
    const exName = tx.getAttribute("data-note");
    tx.addEventListener("input", ()=>debouncedSave(exName));
    tx.addEventListener("blur", ()=>saveOne(exName));
  });


  }catch(e){ console.warn("day fields load/save failed", e); }

  // wire buttons
  container.querySelectorAll("button[data-open]").forEach(b=>{
    b.onclick = ()=>renderExerciseDetail(b.getAttribute("data-open"));
  });
}

async function flushVisibleDayFields(){
  try{
    if(!currentPlan) return;
    const obj = getCurrentDayObj();
    if(!obj) return;
    const container = $("content");
    if(!container) return;
    const dayKey = `${obj.month}||${obj.weekTitle}||${obj.day.title}`;
    const inputs = container.querySelectorAll("input[data-kg], textarea[data-note]");
    const byEx = new Map();
    inputs.forEach(el=>{
      if(el && el.getAttribute){
        if(el.matches("input[data-kg]")){
          const ex = el.getAttribute("data-kg");
          if(!byEx.has(ex)) byEx.set(ex,{kg:"",note:""});
          byEx.get(ex).kg = (el.value || "").trim();
        } else if(el.matches("textarea[data-note]")){
          const ex2 = el.getAttribute("data-note");
          if(!byEx.has(ex2)) byEx.set(ex2,{kg:"",note:""});
          byEx.get(ex2).note = (el.value || "").trim();
        }
      }
    });
    for(const [exName, val] of byEx.entries()){
      const id = `${dayKey}||${exName}`;
      await upsertDayEntryAny({
        id: id,
        dayKey: dayKey,
        month: obj.month,
        weekTitle: obj.weekTitle,
        dayTitle: obj.day.title,
        exercise: exName,
        kg: val.kg || "",
        note: val.note || "",
        ts: Date.now()
      });
    }
  }catch(e){}
}

function findAdjacentWeek(delta){
  // delta: -1 previous, +1 next
  const cur = getCurrentDayObj();
  if(!cur) return null;
  const curDayTitle = cur.day.title;
  const curDayIdx = cur.dayIdx;

  const monthIdx = MONTH_ORDER.indexOf(cur.month);
  const monthObj = PLAN_INDEX[cur.month];

  function pickDay(weekObj){
    if(!weekObj) return null;
    // Try by title first
    const diByTitle = weekObj.days.findIndex(d=>d.title===curDayTitle);
    if(diByTitle>=0) return {dayIdx: diByTitle};
    // fallback by index
    if(curDayIdx < weekObj.days.length) return {dayIdx: curDayIdx};
    return null;
  }

  // within same month
  let mIdx = monthIdx;
  let wIdx = cur.weekIdx + delta;

  while(true){
    const mName = MONTH_ORDER[mIdx];
    if(!mName) return null;
    const m = PLAN_INDEX[mName];
    if(!m || !m.weeks.length) return null;

    // clamp / wrap across months
    if(wIdx < 0){
      mIdx -= 1;
      if(mIdx < 0) return null;
      const prevM = PLAN_INDEX[MONTH_ORDER[mIdx]];
      if(!prevM || !prevM.weeks.length) return null;
      wIdx = prevM.weeks.length - 1;
      continue;
    }
    if(wIdx >= m.weeks.length){
      mIdx += 1;
      if(mIdx >= MONTH_ORDER.length) return null;
      wIdx = 0;
      continue;
    }

    const w = m.weeks[wIdx];
    const pick = pickDay(w);
    if(pick){
      return { month: mName, weekIdx: wIdx, dayIdx: pick.dayIdx };
    } else {
      // corresponding day not found in that week; skip further in same direction
      wIdx += delta;
      continue;
    }
  }
}

function stepWeek(delta){
  const next = findAdjacentWeek(delta);
  if(!next){
    showModal(delta>0 
      ? "Non c'è una settimana di allenamento successiva." 
      : "Non c'è una settimana di allenamento precedente.", "Settimana non trovata");
    return;
  }
  currentPlan.month = next.month;
  currentPlan.weekIdx = next.weekIdx;
  currentPlan.dayIdx = next.dayIdx;
  renderList();
  renderCurrentDay();
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
  enterMobileDetail();

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
    <h3>${fromExercise ? "Quick guide" : "Tabella completa"}</h3>${fromExercise ? `<div style="margin-top:12px" id="photoBlock"></div>` : ``}
    <div class="hint">${fromExercise ? "Link blu = immagini. Link interni = navigazione dentro l’app." : "Questa è la tabella originale del foglio. Utile se vuoi vedere formule / colonne."}</div>
  `;
  if(fromExercise){
    const block = top.querySelector("#photoBlock");
    const q = encodeURIComponent(sheetName);
    block.innerHTML = `
      <div class="hint">Foto: apri la ricerca su Google Images.</div>
      <button class="btn" id="btnG">🔎 Google Images</button>
    `;
    const btn = top.querySelector("#btnG");
    if(btn) btn.onclick = ()=>window.open(`https://www.google.com/search?tbm=isch&q=${q}`, "_blank");
  }

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
    const rowNum = min_row + r;
    if(fromExercise && ((rowNum>=6 && rowNum<=17) || (rowNum>=21 && rowNum<=28))) continue;
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
const DB_VER=4;
let db=null;

/* ========= Day entries storage (IndexedDB + localStorage fallback) ========= */
function safeUUID(){
  try{ if(window.crypto && crypto.randomUUID) return safeUUID(); }catch(e){}
  return "id-"+Date.now()+"-"+Math.random().toString(16).slice(2);
}

const LS_DAY_KEY = "gymapp_dayEntries_v1";

function lsReadDayMap(){
  try{
    const raw = localStorage.getItem(LS_DAY_KEY);
    if(!raw) return {};
    const obj = JSON.parse(raw);
    if(obj && typeof obj === "object") return obj;
  }catch(e){}
  return {};
}
function lsWriteDayMap(map){
  try{ localStorage.setItem(LS_DAY_KEY, JSON.stringify(map)); }catch(e){}
}
function lsGetDayEntry(id){
  const map = lsReadDayMap();
  return map[id] || null;
}
function lsUpsertDayEntry(entry){
  if(!entry || !entry.id) return;
  const map = lsReadDayMap();
  map[entry.id] = entry;
  lsWriteDayMap(map);
}
function lsGetAllDayEntries(){
  const map = lsReadDayMap();
  const out = [];
  for(const k in map){ if(Object.prototype.hasOwnProperty.call(map,k)) out.push(map[k]); }
  return out;
}
function lsClearAllDayEntries(){
  try{ localStorage.removeItem(LS_DAY_KEY); }catch(e){}
}

/* Unified API: prefer IndexedDB, always mirror in localStorage for iOS reliability */
async function getDayEntryAny(id){
  // 1) try IndexedDB
  if(db){
    try{
      const x = await getDayEntry(id);
      if(x) return x;
    }catch(e){}
  }
  // 2) fallback localStorage
  return lsGetDayEntry(id);
}
async function upsertDayEntryAny(entry){
  // always mirror to localStorage first
  lsUpsertDayEntry(entry);
  if(db){
    try{ await upsertDayEntry(entry); }catch(e){}
  }
}
async function getAllDayEntriesAny(){
  let out = [];
  if(db){
    try{ out = await getAllDayEntries(); }catch(e){ out = []; }
  }
  // merge with localStorage (prefer db record if same id)
  const map = new Map(out.map(x=>[x.id,x]));
  const ls = lsGetAllDayEntries();
  for(let i=0;i<ls.length;i++){
    const e = ls[i];
    if(e && e.id && !map.has(e.id)) map.set(e.id, e);
  }
  return Array.from(map.values());
}
async function clearAllDayEntriesAny(){
  lsClearAllDayEntries();
  if(db){
    try{ await clearAll(); }catch(e){} // clearAll clears stores; keep for compat
  }
}

// Back-compat aliases (older builds called these without the *Any suffix)
async function getDayEntry(id){
  return getDayEntryAny(id);
}
async function upsertDayEntry(obj){
  return upsertDayEntryAny(obj);
}



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
      if(!d.objectStoreNames.contains("dayEntries")){
        const e = d.createObjectStore("dayEntries", { keyPath:"id" });
        e.createIndex("byDay","dayKey");
        e.createIndex("byExercise","exercise");
      }
      if(!d.objectStoreNames.contains("backups")){
        const b = d.createObjectStore("backups", { keyPath:"id" });
        b.createIndex("byDate","date");
        b.createIndex("byTs","ts");
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

function getAllDayEntries(){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(["dayEntries"],"readonly");
    const store = tx.objectStore("dayEntries");
    const out = [];
    const req = store.openCursor();
    req.onsuccess = ()=>{
      const cur = req.result;
      if(cur){
        out.push(cur.value);
        cur.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = ()=>reject(req.error);
  });
}


function clearAll(){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(["logs"],"readwrite");
    const req = tx.objectStore("logs").clear();
    req.onsuccess=()=>resolve();
    req.onerror=()=>reject(req.error);
  });

async function addBackup(snapshot){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(["backups"],"readwrite");
    tx.objectStore("backups").put(snapshot);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

async function getAllBackups(){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(["backups"],"readonly");
    const req = tx.objectStore("backups").getAll();
    req.onsuccess=()=>resolve(req.result||[]);
    req.onerror=()=>reject(req.error);
  });
}


async function upsertDayEntry(entry){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(["dayEntries"],"readwrite");
    tx.objectStore("dayEntries").put(entry);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

async function getDayEntry(id){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(["dayEntries"],"readonly");
    const req = tx.objectStore("dayEntries").get(id);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
}

async function dailyAutoBackup(){
  // iOS Safari blocks automatic file downloads, so we save a daily snapshot INSIDE the app (IndexedDB).
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const last = localStorage.getItem("lastAutoBackupDate");
  if(last === key) return;

  const logs = await getAllLogs();
  const snap = {
    id: safeUUID(),
    date: key,
    ts: Date.now(),
    version: 1,
    exportedAt: new Date().toISOString(),
    logs
  };
  await addBackup(snap);

  // keep last 30
  const all = (await getAllBackups()).sort((a,b)=>b.ts-a.ts);
  for(let i=30;i<all.length;i++){
    await new Promise((resolve,reject)=>{
      const tx = db.transaction(["backups"],"readwrite");
      tx.objectStore("backups").delete(all[i].id);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
    });
  }

  localStorage.setItem("lastAutoBackupDate", key);
}
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
      id: safeUUID(),
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

  // Backups (auto)
  const backupsCard = document.createElement("div");
  backupsCard.className="card";
  backupsCard.innerHTML = `<h3>Backup automatici (giornalieri)</h3>
    <div class="hint">L’app salva automaticamente uno snapshot al giorno (solo sul telefono). Da qui puoi esportare un backup in file quando vuoi.</div>
    <div class="logList" id="bkList"></div>`;
  container.appendChild(backupsCard);

  const bks = (await getAllBackups()).sort((a,b)=>b.ts-a.ts);
  const bkEl = backupsCard.querySelector("#bkList");
  if(!bks.length){
    const div=document.createElement("div");
    div.className="hint";
    div.textContent="Nessun backup automatico ancora (si crea al primo avvio del giorno).";
    bkEl.appendChild(div);
  } else {
    for(const b of bks.slice(0,10)){
      const div=document.createElement("div");
      div.className="logItem";
      div.innerHTML = `<div class="meta"><span><b>${escapeHtml(b.date)}</b></span><span>• ${new Date(b.ts).toLocaleString()}</span></div>
        <div style="margin-top:8px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" data-expbk="${escapeHtml(b.id)}">⬇️ Esporta questo backup</button>
        </div>`;
      bkEl.appendChild(div);
    }
    backupsCard.querySelectorAll("button[data-expbk]").forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute("data-expbk");
        const all = await getAllBackups();
        const b = all.find(x=>x.id===id);
        if(!b) return alert("Backup non trovato.");
        const blob = new Blob([JSON.stringify({version:1, exportedAt:new Date().toISOString(), logs:b.logs}, null, 2)], {type:"application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href=url;
        a.download=`gymapp_backup_${b.date}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      };
    });
  }

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
async function importBackupFromFile(file){
  const text = await file.text();
  let payload = null;
  try{ payload = JSON.parse(text); }catch(e){ throw new Error("Il file non è un JSON valido."); }
  if(!payload || !Array.isArray(payload.dayEntries)) throw new Error("Backup non valido: manca dayEntries[].");
  return payload;
}

async function importBackup(payload, mode="merge"){
  const incoming = payload && payload.dayEntries ? payload.dayEntries : [];
  if(mode==="replace"){
    await clearAllDayEntriesAny();
  }
  const existing = await getAllDayEntriesAny();
  const map = new Map(existing.map(x=>[x.id,x]));
  let added=0, updated=0;
  for(let i=0;i<incoming.length;i++){
    const item = incoming[i];
    if(!item) continue;
    const id = item.id ? String(item.id) : ("import-"+Date.now()+"-"+Math.random().toString(16).slice(2));
    const normalized = {
      id: id,
      dayKey: item.dayKey || "",
      month: item.month || "",
      weekTitle: item.weekTitle || "",
      dayTitle: item.dayTitle || "",
      exercise: item.exercise || "",
      kg: (item.kg || ""),
      note: (item.note || ""),
      ts: item.ts || Date.now()
    };
    await upsertDayEntryAny(normalized);
    if(map.has(id)) updated++; else added++;
    map.set(id, normalized);
  }
  return {added: added, updated: updated, total: incoming.length};
}


async function exportBackup(){
  const entries = await getAllDayEntriesAny();
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    dayEntries: entries
  };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url;
  a.download="gymapp_backup_dayEntries.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function resetAll(){
  if(!confirm("Sei sicuro? Cancello solo i tuoi dati inseriti (Kg/Note). Il piano resta.")) return;
  await clearAllDayEntriesAny();
  // refresh current view
  if(currentPlan){ await renderCurrentDay(); }
  else { setActiveTab("plan"); }
  alert("Ok: dati cancellati.");
}

/* ========= SW registration ========= */
async function registerSw(){
  if("serviceWorker" in navigator){
    try{ const reg = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }); try{ reg.update(); }catch(e){} }
    catch(e){ console.warn("SW registration failed", e); }
  }
}

async function init(){
  $("title").textContent="Caricamento…";
  const res = await fetch("data.json");
  DATA = await res.json();

  buildPlanIndex();
  openWeekKey = null;
  await openDb();
  if(typeof dailyAutoBackup==="function") await dailyAutoBackup();
await registerSw();

  // UI bindings
  $("q").addEventListener("input", ()=>renderList());
  $("tab-plan").onclick = ()=>setActiveTab("plan");
  $("tab-ex").onclick = ()=>setActiveTab("ex");
    const np=document.getElementById("nav-plan"); if(np) np.onclick=()=>setActiveTab("plan");
  const ne=document.getElementById("nav-ex"); if(ne) ne.onclick=()=>setActiveTab("ex");
  
  $("btnToggleView").style.display="none"; // v4: plan is folder view; hide old toggle
  $("btnImport").onclick = ()=>document.getElementById("fileImport").click();
  document.getElementById("fileImport").onchange = async (ev)=>{
    const file = ev.target.files && ev.target.files[0];
    if(!file) return;
    try{
      const payload = await importBackupFromFile(file);
      const mode = confirm("OK = UNISCI (merge)\nAnnulla = SOVRASCRIVI (replace)") ? "merge" : "replace";
      const res = await importBackup(payload, mode);
      // refresh UI so imported Kg/Note become visible immediately
      if(currentTab === "plan" && currentPlan){
        await renderCurrentDay();
      }
      alert(`Import completato. Aggiunti: ${res.added} • Aggiornati: ${res.updated} • Totale: ${res.total}`);
    }catch(e){
      alert(e.message || String(e));
    } finally {
      ev.target.value="";
    }
  };
  $("btnExport").onclick = ()=>exportBackup();
  $("btnReset").onclick = ()=>resetAll();
  $("btnBack").onclick = ()=>{ exitMobileDetail(); window.scrollTo({top:0, behavior:"smooth"}); };
  window.addEventListener("resize", ()=>{ if(!isMobile()) exitMobileDetail(); });
  // ensure last typed values are persisted on iOS when reloading/closing
  window.addEventListener("pagehide", ()=>{ flushVisibleDayFields(); });
  document.addEventListener("visibilitychange", ()=>{ if(document.hidden) flushVisibleDayFields(); });

  // start
  setActiveTab("plan");
}
init();