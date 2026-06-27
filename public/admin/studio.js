// Template Studio — Entry. Verdrahtet das Code-Gate und die Tabs. Die Modus-
// Logik (Modus 1 / Modus 2) wird in eigenen Modulen ergänzt und hier nach dem
// Entsperren initialisiert.

import { postAuth, getToken, setToken, clearToken } from "./studioApi.js";

const $ = (id) => document.getElementById(id);
let booted = false;

function showStudio() {
  $("gate").hidden = true;
  $("studio").hidden = false;
  if (booted) return;
  booted = true;
  // Modus-Module lazy laden (existieren ab den nächsten Bau-Schritten).
  import("./mode2.js").then((m) => m.initMode2 && m.initMode2()).catch(() => {});
  import("./mode1.js").then((m) => m.initMode1 && m.initMode1()).catch(() => {});
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

function initTabs() {
  const tabs = $("tabs");
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest(".studio-tab");
    if (!b) return;
    const tab = b.dataset.tab;
    for (const t of tabs.querySelectorAll(".studio-tab")) t.classList.toggle("active", t === b);
    for (const p of document.querySelectorAll(".studio-panel")) {
      const on = p.dataset.tab === tab;
      p.classList.toggle("active", on);
      p.hidden = !on;
    }
  });
}

function init() {
  $("gateForm").addEventListener("submit", unlock);
  $("lockBtn").addEventListener("click", () => { clearToken(); location.reload(); });
  initTabs();
  // Schon entsperrt (Token vorhanden)? Direkt rein — ein abgelaufenes Token
  // fliegt beim ersten geschützten Call via 401 ohnehin zurück zum Gate.
  if (getToken()) showStudio();
  $("gateCode") && $("gateCode").focus();
}

init();
