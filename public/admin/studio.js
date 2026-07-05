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

// Einen Tab aktivieren. Versteckte/fehlende Tabs werden nie aktiviert (kein leerer
// Standard). Bei Gruppen-Tabs wird nur das Panel der aktiven Unterauswahl gezeigt.
function activateTab(tab) {
  const tabsEl = $("tabs");
  const btn = tabsEl.querySelector('.studio-tab[data-tab="' + tab + '"]');
  if (!btn || btn.hidden) return false;
  for (const t of tabsEl.querySelectorAll(".studio-tab")) t.classList.toggle("active", t === btn);
  for (const p of document.querySelectorAll(".studio-panel")) {
    let on = p.dataset.tab === tab;
    if (on && p.dataset.sub) on = subState[tab] === p.dataset.sub;
    p.hidden = !on;
    p.classList.toggle("active", on);
  }
  for (const nav of document.querySelectorAll(".studio-subnav")) nav.hidden = nav.dataset.group !== tab;
  return true;
}

// Unterauswahl innerhalb eines Gruppen-Tabs wechseln.
function activateSub(group, sub) {
  subState[group] = sub;
  for (const st of document.querySelectorAll('.studio-subtab[data-group="' + group + '"]')) st.classList.toggle("active", st.dataset.sub === sub);
  const active = $("tabs").querySelector(".studio-tab.active");
  if (active && active.dataset.tab === group) activateTab(group);
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
}

// Standard beim Oeffnen: ein Hash auf einen SICHTBAREN Tab gewinnt, sonst der immer
// sichtbare Fallback "prompting". Der Admin-Standard "manage" wird nachgezogen, sobald
// die Bestandsverwaltung ihren Tab freigibt (onAdminReady) — der ist beim Start noch
// verborgen.
function resolveInitial() {
  const hashTab = (location.hash || "").replace(/^#/, "");
  if (hashTab && activateTab(hashTab)) return;
  activateTab("prompting");
}

// Von manage-panel.js gefeuert, sobald die Bestandsverwaltung bei ADMIN_TOOLS=1 ihren
// Tab sichtbar gemacht hat: dann ist sie der Standard-Tab, sofern der Nutzer nicht
// schon selbst gewaehlt hat und kein Hash auf einen anderen sichtbaren Tab zeigt
// (der Redirect /admin/manage nutzt #manage und landet damit hier korrekt).
function onAdminReady() {
  if (adminResolved) return;
  adminResolved = true;
  if (userPicked) return;
  const hashTab = (location.hash || "").replace(/^#/, "");
  if (hashTab && hashTab !== "manage" && activateTab(hashTab)) return;
  activateTab("manage");
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
  import("./keywords.js").then((m) => m.initKeywords && m.initKeywords()).catch(() => {});
  import("./manage-panel.js").then((m) => m.initManage && m.initManage()).catch(() => {});
  import("./upload-panel.js").then((m) => m.initUpload && m.initUpload()).catch(() => {});
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
