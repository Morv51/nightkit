// Template Studio — Entry. Verdrahtet das Code-Gate, die Tabs und die Unterauswahl
// der Gruppen-Tabs (Prompting Tool = Flyer→Template / Moodboard→Prompt; Auto-Flow =
// Auto-Flow 1 / Auto-Flow 2). Die Werkzeug-Module (mode1/mode2/autoflow/autoflow2/
// keywords/manage/upload) sind UNVERAENDERT und binden ueber ihre eigenen Element-
// IDs (z. B. #panel-mode1); hier wird nur die Tab-Verpackung gesteuert.

import { postAuth, getToken, setToken, clearToken } from "./studioApi.js";

const $ = (id) => document.getElementById(id);
let booted = false;
let userPicked = false;    // hat der Nutzer selbst einen Tab/Unterpunkt gewaehlt?
let adminResolved = false; // wurde der Admin-Standard schon aufgeloest?

// Aktuelle Unterauswahl je Gruppen-Tab (Standard: Flyer→Template bzw. Auto-Flow 1).
const subState = { prompting: "mode1", auto: "auto" };

// Archiv: die vier ausgelagerten Werkzeuge. Ihre Panels/Module bleiben UNVERAENDERT; nur ihre
// Sichtbarkeit wird jetzt vom Archiv-Reiter gesteuert statt von einem eigenen Haupt-Tab.
const ARCHIV_TOOLS = ["dsgn", "prompting", "auto", "keywords"];
let archivSel = "dsgn"; // zuletzt im Archiv gewaehltes Werkzeug

// Panels + Subnavs fuer einen logischen Tab zeigen (ohne Nav-Highlight). Bei Gruppen-Tabs zeigt
// die aktive Unterauswahl. Dieselbe Logik wie bisher, nur ausgelagert, damit das Archiv sie
// mit einem Werkzeug-Namen wiederverwenden kann.
function showPanelsFor(tab) {
  for (const p of document.querySelectorAll(".studio-panel")) {
    let on = p.dataset.tab === tab;
    if (on && p.dataset.sub) on = subState[tab] === p.dataset.sub;
    p.hidden = !on;
    p.classList.toggle("active", on);
  }
  for (const nav of document.querySelectorAll(".studio-subnav")) nav.hidden = nav.dataset.group !== tab;
}

// Im Archiv das gewaehlte Werkzeug anzeigen (dessen Panel[s] + ggf. Subnav) + Auswahl spiegeln.
function applyArchiv() {
  showPanelsFor(archivSel);
  const sel = $("archivSelect");
  if (sel && sel.value !== archivSel) sel.value = archivSel;
}

// Einen Tab aktivieren. Versteckte/fehlende Tabs werden nie aktiviert (kein leerer Standard).
// "archiv" ist ein Sonderfall: die Archiv-Leiste erscheint und das gewaehlte Werkzeug wird
// darunter gezeigt.
function activateTab(tab) {
  const tabsEl = $("tabs");
  const btn = tabsEl.querySelector('.studio-tab[data-tab="' + tab + '"]');
  if (!btn || btn.hidden) return false;
  for (const t of tabsEl.querySelectorAll(".studio-tab")) t.classList.toggle("active", t === btn);
  const bar = $("archivBar");
  if (tab === "archiv") {
    if (bar) bar.hidden = false;
    applyArchiv();
  } else {
    if (bar) bar.hidden = true;
    showPanelsFor(tab);
  }
  return true;
}

// Unterauswahl innerhalb eines Gruppen-Tabs wechseln. Funktioniert auch, wenn die Gruppe
// gerade IM ARCHIV gezeigt wird (dann ist der aktive Haupt-Tab "archiv", nicht die Gruppe).
function activateSub(group, sub) {
  subState[group] = sub;
  for (const st of document.querySelectorAll('.studio-subtab[data-group="' + group + '"]')) st.classList.toggle("active", st.dataset.sub === sub);
  const active = $("tabs").querySelector(".studio-tab.active");
  if (active && active.dataset.tab === group) activateTab(group);
  else if (active && active.dataset.tab === "archiv" && archivSel === group) applyArchiv();
}

// Werkzeug im Archiv wechseln (Dropdown).
function selectArchivTool(tool) {
  if (!ARCHIV_TOOLS.includes(tool)) return;
  archivSel = tool;
  applyArchiv();
}

function initTabs() {
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".studio-tab");
    if (!b || b.hidden) return;
    userPicked = true;
    activateTab(b.dataset.tab);
  });
  document.addEventListener("click", (e) => {
    const s = e.target.closest(".studio-subtab");
    if (!s) return;
    userPicked = true;
    activateSub(s.dataset.group, s.dataset.sub);
  });
  const arch = $("archivSelect");
  if (arch) arch.addEventListener("change", (e) => { userPicked = true; selectArchivTool(e.target.value); });
}

// Standard beim Oeffnen: ein Hash auf einen SICHTBAREN Tab gewinnt, sonst der immer
// sichtbare Fallback "prompting". Der Admin-Standard "manage" wird nachgezogen, sobald
// die Bestandsverwaltung ihren Tab freigibt (onAdminReady) — der ist beim Start noch
// verborgen.
function resolveInitial() {
  const hashTab = (location.hash || "").replace(/^#/, "");
  // Deep-Link auf ein archiviertes Werkzeug (#dsgn/#prompting/#auto/#keywords) -> Archiv oeffnen
  // und dieses Werkzeug vorwaehlen. So bleiben alte Links erreichbar.
  if (ARCHIV_TOOLS.includes(hashTab)) { archivSel = hashTab; if (activateTab("archiv")) return; }
  if (hashTab && activateTab(hashTab)) return;
  activateTab("clean"); // Standard: Clean-Flow (immer sichtbar; prompting ist jetzt im Archiv)
}

// Von manage-panel.js gefeuert, sobald die Bestandsverwaltung (Reiter "Templates") bei
// ADMIN_TOOLS=1 ihren Tab sichtbar gemacht hat. Standard-Startreiter ist "Erstellen" (clean);
// ein Hash gewinnt weiterhin (der Redirect /admin/manage nutzt #manage und oeffnet damit den
// jetzt sichtbaren Templates-Reiter korrekt).
function onAdminReady() {
  if (adminResolved) return;
  adminResolved = true;
  if (userPicked) return;
  const hashTab = (location.hash || "").replace(/^#/, "");
  if (ARCHIV_TOOLS.includes(hashTab)) { archivSel = hashTab; if (activateTab("archiv")) return; }
  if (hashTab && activateTab(hashTab)) return; // inkl. #manage -> Templates (jetzt sichtbar)
  activateTab("clean"); // Standard-Startreiter: Erstellen
}

function showStudio() {
  $("gate").hidden = true;
  $("studio").hidden = false;
  if (booted) return;
  booted = true;
  // Werkzeug-Module lazy laden (unveraendert; binden an ihre eigenen IDs).
  import("./mode2.js").then((m) => m.initMode2 && m.initMode2()).catch(() => {});
  import("./mode1.js").then((m) => m.initMode1 && m.initMode1()).catch(() => {});
  import("./variants.js").then((m) => m.initVariants && m.initVariants()).catch(() => {});
  import("./autoflow.js").then((m) => m.initAutoflow && m.initAutoflow()).catch(() => {});
  import("./autoflow2.js").then((m) => m.initAutoflow2 && m.initAutoflow2()).catch(() => {});
  import("./autoflow3.js").then((m) => m.initAutoflow3 && m.initAutoflow3()).catch(() => {});
  import("./cleanflow.js").then((m) => m.initCleanflow && m.initCleanflow()).catch(() => {});
  import("./autoflowRuns.js").then((m) => m.initAutoflowRuns && m.initAutoflowRuns()).catch(() => {});
  import("./keywords.js").then((m) => m.initKeywords && m.initKeywords()).catch(() => {});
  import("./manage-panel.js").then((m) => m.initManage && m.initManage()).catch(() => {});
  import("./upload-panel.js").then((m) => m.initUpload && m.initUpload()).catch(() => {});
  import("./designAnalysis.js").then((m) => m.initDesignAnalysis && m.initDesignAnalysis()).catch(() => {});
  import("./usage-panel.js").then((m) => m.initUsage && m.initUsage()).catch(() => {});
  import("./analysisprompt-panel.js").then((m) => m.initAnalysisPrompt && m.initAnalysisPrompt()).catch(() => {});
  resolveInitial();
}

async function unlock(e) {
  e.preventDefault();
  const err = $("gateErr");
  err.hidden = true;
  const code = $("gateCode").value.trim();
  try {
    const { token } = await postAuth(code);
    setToken(token);
    showStudio();
  } catch (ex) {
    err.textContent = ex.message || "Falscher Code";
    err.hidden = false;
    $("gateCode").select();
  }
}

function init() {
  $("gateForm").addEventListener("submit", unlock);
  $("lockBtn").addEventListener("click", () => { clearToken(); location.reload(); });
  initTabs();
  document.addEventListener("nk-admin-ready", onAdminReady);
  // Schon entsperrt (Token vorhanden)? Direkt rein — ein abgelaufenes Token fliegt
  // beim ersten geschützten Call via 401 ohnehin zurück zum Gate.
  if (getToken()) showStudio();
  $("gateCode") && $("gateCode").focus();
}

init();
