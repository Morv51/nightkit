// Grafik-Analyse (Bestandsverwaltung) — Phase 1 (Eingabe) + Phase 2 (Analyse je Flyer).
// Laeuft EINMALIG zur Musterextraktion, NICHT bei der Generierung. Die Bilder werden nur
// analysiert: sie werden nicht als Vorlage gespeichert und nicht nachgebaut.
//
// Additiv und isoliert: eigenes Panel (#panel-dsgn), eigene Endpunkte
// (/admin/design-analysis/*). Nutzt die geteilten Studio-Helfer (fileToDataUrl inkl.
// HEIC/Downscale + iOS-Fix, Dropzone, Paste) und das gemeinsame Admin-Token.
// Ist ADMIN_TOOLS aus, liefert list 404 -> Tab bleibt verborgen.

import { getToken } from "./studioApi.js";
import { fileToDataUrl, wireDropzoneMulti, wirePaste, notify, installErrorSurface } from "./studioUi.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Fester Fragenkatalog — Reihenfolge + Beschriftung der Anzeige.
const FIELDS = [
  ["blickfang", "Blickfang"],
  ["flaechenaufteilung", "Flächenaufteilung"],
  ["klassen", "Klassen (laut vs. Sachinfo)"],
  ["fehlende_rollen", "Rollen (DJs / Location / Uhrzeit)"],
  ["datum", "Datum"],
  ["schrift_disziplin", "Schrift-Disziplin"],
  ["tiefe", "Tiefe"],
  ["ordnung", "Ordnung"],
  ["vibe", "Vibe"],
  ["stil_kategorie", "Stil-Kategorie"],
  ["lautstaerke", "Lautstärke"],
];

let files = [];       // { name, dataUrl }
let running = false;
let cancelled = false;

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": getToken() },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = (await res.json()) || {}; } catch (_) {}
  return { http: res.status, data };
}

function setStatus(text) { const el = $("dsgnStatus"); if (el) el.textContent = text || ""; }

function refreshStartState() {
  const btn = $("dsgnStart");
  if (btn) btn.disabled = !files.length || running;
}

function renderThumbs() {
  const row = $("dsgnThumbs");
  if (!row) return;
  row.innerHTML = "";
  files.forEach((f, i) => {
    const t = document.createElement("div"); t.className = "batch-thumb";
    const img = document.createElement("img"); img.src = f.dataUrl; img.alt = "";
    const x = document.createElement("button");
    x.type = "button"; x.className = "batch-thumb-x"; x.textContent = "✕"; x.title = "Entfernen";
    x.addEventListener("click", () => { if (!running) { files.splice(i, 1); renderThumbs(); refreshStartState(); } });
    t.appendChild(img); t.appendChild(x); row.appendChild(t);
  });
  row.hidden = !files.length;
  const label = $("dsgnDropLabel");
  if (label) label.textContent = files.length
    ? files.length + " Flyer gewählt — je Flyer ein Analyse-Aufruf"
    : "Flyer hierher ziehen, einfügen (⌘/Ctrl+V) oder tippen — mehrere möglich (zum Testen 3–5, später 30–50)";
}

// Phase 1: Eingabe. Bilder werden nur clientseitig gehalten und zur Analyse geschickt.
async function addFiles(fileList) {
  for (const f of Array.from(fileList || [])) {
    try { files.push({ name: f.name || "flyer", dataUrl: await fileToDataUrl(f) }); }
    catch (e) { notify((e && e.message) || "Bild nicht lesbar", "error"); }
  }
  renderThumbs(); refreshStartState();
}

// Ein Datensatz als lesbarer Block (Wortlaut) + Rohdaten zum Nachlesen.
function recordHtml(rec, idx) {
  const f = rec.fields || {};
  const rows = FIELDS.map(([key, label]) => {
    const val = f[key];
    const text = (val == null || val === "") ? "—" : (typeof val === "string" ? val : JSON.stringify(val));
    return '<div class="dsgn-row"><div class="dsgn-k">' + esc(label) + '</div><div class="dsgn-v">' + esc(text) + "</div></div>";
  }).join("");
  const extra = Object.keys(f).filter((k) => !FIELDS.some(([kk]) => kk === k));
  return '<div class="dsgn-rec">' +
    '<div class="dsgn-rec-head"><b>' + (idx + 1) + " · " + esc(rec.sourceName || "Flyer") + "</b>" +
      '<span class="dsgn-meta">' + esc(rec.model || "") + " · " + esc((rec.createdAt || "").slice(0, 16).replace("T", " ")) + "</span></div>" +
    rows +
    (extra.length ? '<div class="dsgn-row"><div class="dsgn-k">Zusatzfelder</div><div class="dsgn-v">' + esc(extra.join(", ")) + "</div></div>" : "") +
    '<details class="dsgn-raw"><summary>Rohdaten (JSON)</summary><pre>' + esc(JSON.stringify(rec.fields, null, 2)) + "</pre></details>" +
  "</div>";
}

// Übersicht: reine Verteilungszählung über die bereits gespeicherten Datensätze.
// Feste Buckets in fester Reihenfolge (auch 0 wird gezeigt, damit Lücken sichtbar sind).
const STIL_KATEGORIEN = ["grunge", "elegant", "minimal", "neon", "retro", "streetstyle", "glamour", "sonstige"];
const LAUTSTAERKEN = ["zurueckhaltend", "mittel", "laut"];
const LAUT_LABEL = { zurueckhaltend: "zurückhaltend", mittel: "mittel", laut: "laut" };

// Zählt records nach einem Feld in die vorgegebenen Buckets; Unbekanntes separat.
function tally(records, key, buckets) {
  const counts = Object.create(null);
  for (const b of buckets) counts[b] = 0;
  let unbekannt = 0;
  for (const rec of records) {
    const raw = (rec && rec.fields) ? rec.fields[key] : "";
    const v = String(raw == null ? "" : raw).trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, v)) counts[v]++;
    else unbekannt++;
  }
  return { counts, unbekannt };
}

function overviewLine(label, buckets, tallied, labelMap) {
  const parts = buckets.map((b) => {
    const n = tallied.counts[b];
    const name = (labelMap && labelMap[b]) || b;
    return '<span class="dsgn-ov-item' + (n ? "" : " is-zero") + '">' + esc(name) + " <b>" + n + "</b></span>";
  });
  if (tallied.unbekannt) parts.push('<span class="dsgn-ov-item is-zero">ohne/unklar <b>' + tallied.unbekannt + "</b></span>");
  return '<div class="dsgn-row"><div class="dsgn-k">' + esc(label) + '</div><div class="dsgn-v dsgn-ov">' + parts.join(" · ") + "</div></div>";
}

function renderOverview(records) {
  const card = $("dsgnOverview");
  const body = $("dsgnOverviewBody");
  if (!card || !body) return;
  if (!records.length) { card.hidden = true; body.innerHTML = ""; return; }
  card.hidden = false;
  body.innerHTML =
    overviewLine("Stil-Kategorie", STIL_KATEGORIEN, tally(records, "stil_kategorie", STIL_KATEGORIEN), null) +
    overviewLine("Lautstärke", LAUTSTAERKEN, tally(records, "lautstaerke", LAUTSTAERKEN), LAUT_LABEL);
}

function renderRecords(records) {
  const root = $("dsgnRecords");
  if (!root) return;
  renderOverview(records);            // Verteilungs-Übersicht oben mitziehen
  const n = records.length;
  const badge = $("dsgnCount");
  if (badge) badge.textContent = n ? n + (n === 1 ? " Datensatz" : " Datensätze") : "";
  root.innerHTML = n
    ? records.map(recordHtml).join("")
    : '<div class="afr-empty">Noch keine Datensätze. Oben Flyer wählen und analysieren.</div>';
}

async function loadRecords() {
  const r = await api("/admin/design-analysis/list", {});
  if (r.http === 404) return false;            // ADMIN_TOOLS aus -> Tab verborgen lassen
  if (r.http === 401) { renderRecords([]); notify("Sitzung abgelaufen — Seite neu laden.", "error"); return true; }
  if (r.http !== 200 || !r.data || r.data.ok === false) {
    const root = $("dsgnRecords");
    if (root) root.innerHTML = '<div class="afr-empty">Konnte nicht laden: ' + esc((r.data && r.data.error) || ("HTTP " + r.http)) + "</div>";
    return true;
  }
  renderRecords(r.data.records || []);
  return true;
}

// Phase 2: jeden Flyer einzeln analysieren (nacheinander, ein Fehlschlag bricht nicht ab).
async function analyseAll() {
  if (running || !files.length) return;
  running = true; cancelled = false;
  refreshStartState();
  const cancelBtn = $("dsgnCancel"); if (cancelBtn) cancelBtn.hidden = false;
  const model = ($("dsgnModel") && $("dsgnModel").value) === "haiku" ? "haiku" : "sonnet";
  let done = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    if (cancelled) break;
    setStatus("Analysiere " + (i + 1) + " von " + files.length + " · " + files[i].name + " …");
    const r = await api("/admin/design-analysis/analyze", { image: files[i].dataUrl, name: files[i].name, model });
    if (r.http === 401) { notify("Sitzung abgelaufen — Seite neu laden.", "error"); break; }
    if (r.http === 200 && r.data && r.data.ok) done++;
    else { failed++; notify("Fehlgeschlagen (" + files[i].name + "): " + ((r.data && r.data.error) || ("HTTP " + r.http)), "error"); }
    await loadRecords();
  }
  running = false;
  if (cancelBtn) cancelBtn.hidden = true;
  refreshStartState();
  setStatus(cancelled ? "Abgebrochen · " + done + " analysiert" : done + " analysiert" + (failed ? ", " + failed + " fehlgeschlagen" : ""));
  if (done) notify(done + (done === 1 ? " Flyer analysiert" : " Flyer analysiert"), failed ? "warn" : "success");
}

async function clearAll() {
  if (running) return;
  if (!confirm("Alle gesammelten Datensätze verwerfen?\nDie Grundlage für Phase 3 geht damit verloren.")) return;
  const r = await api("/admin/design-analysis/clear", {});
  if (r.http === 200 && r.data && r.data.ok) { notify("Datensätze verworfen", "success"); loadRecords(); }
  else notify("Verwerfen fehlgeschlagen: " + ((r.data && r.data.error) || ("HTTP " + r.http)), "error");
}

export function initDesignAnalysis() {
  installErrorSurface();
  const panel = $("panel-dsgn");
  if (!panel || panel.dataset.wired) return;
  panel.dataset.wired = "1";

  const file = $("dsgnFile");
  if (file) file.addEventListener("change", () => {
    const picked = Array.from(file.files || []); file.value = "";
    if (picked.length) addFiles(picked);
  });
  wireDropzoneMulti($("dsgnDrop"), addFiles);
  wirePaste(panel, (f) => addFiles([f]));
  if ($("dsgnStart")) $("dsgnStart").addEventListener("click", analyseAll);
  if ($("dsgnCancel")) $("dsgnCancel").addEventListener("click", () => { cancelled = true; setStatus("Bricht ab …"); });
  if ($("dsgnClear")) $("dsgnClear").addEventListener("click", clearAll);
  if ($("dsgnReload")) $("dsgnReload").addEventListener("click", loadRecords);
  const tabBtn = document.querySelector('.studio-tab[data-tab="dsgn"]');
  if (tabBtn) tabBtn.addEventListener("click", loadRecords);
  renderThumbs();

  loadRecords().then((reachable) => { if (reachable && tabBtn) tabBtn.hidden = false; });
}
