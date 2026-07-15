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

// Übersichts-Karte holen — und, falls das HTML sie (z. B. durch veraltetes/gecachtes
// template-studio.html) NICHT enthält, selbst oben im Panel erzeugen. So haengt die
// Übersicht nicht mehr davon ab, dass HTML und JS im selben Deploy-Stand sind.
function ensureOverviewEls() {
  let card = $("dsgnOverview");
  let body = $("dsgnOverviewBody");
  if (card && body) return { card, body };
  const panel = $("panel-dsgn");
  if (!panel) return { card: null, body: null };
  card = document.createElement("div");
  card.className = "st-card";
  card.id = "dsgnOverview";
  card.hidden = true;
  card.innerHTML =
    '<div class="st-head">Übersicht · Verteilung der Datensätze</div>' +
    '<div class="st-mini-note">Reine Zählung aus den gespeicherten Datensätzen — zeigt, ob die Kategorien ausgewogen besetzt sind, bevor die volle Charge läuft.</div>' +
    '<div id="dsgnOverviewBody"></div>';
  const note = panel.querySelector(".afr-note");
  if (note && note.nextSibling) panel.insertBefore(card, note.nextSibling);
  else panel.insertBefore(card, panel.firstChild);
  body = card.querySelector("#dsgnOverviewBody");
  return { card, body };
}

function renderOverview(records) {
  const { card, body } = ensureOverviewEls();
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

// ── Phase 3: Regelwerk destillieren + anzeigen. Reine Anzeige gespeicherter Daten; die
//    Belastbarkeit (beruht_auf) kommt aus dem Backend (Anzahl belegender Datensätze). ──
let rulesRunning = false;

// Belastbarkeits-Chip: stark, wenn eine Regel auf vielen Datensätzen beruht; schwach (Hinweis)
// bei ≤ 2. Der Schwellwert für „stark" richtet sich nach der Gesamtzahl der Datensätze.
function belegBadge(n, total) {
  const strong = n >= Math.max(5, Math.ceil((total || 0) / 2));
  const weak = n <= 2;
  const cls = "dsgn-beleg" + (strong ? " is-strong" : "") + (weak ? " is-weak" : "");
  const label = n + (n === 1 ? " Datensatz" : " Datensätze");
  return '<span class="' + cls + '" title="Auf wie vielen Datensätzen die Regel beruht">' + esc(label) + "</span>";
}

function ruleItemHtml(item, total) {
  const it = item || {};
  const text = esc(it.regel || it.muster || "");
  const rolle = it.rolle ? '<b class="dsgn-rolle">' + esc(it.rolle) + "</b> " : "";
  return '<li class="dsgn-rule">' + rolle + '<span class="dsgn-rule-t">' + text + "</span> " + belegBadge(it.beruht_auf || 0, total) + "</li>";
}

function renderRuleset(ruleset) {
  const root = $("dsgnRules");
  const meta = $("dsgnRulesMeta");
  const clearBtn = $("dsgnRulesClear");
  if (!root) return;
  if (!ruleset) {
    if (meta) meta.textContent = "";
    if (clearBtn) clearBtn.hidden = true;
    root.innerHTML = '<div class="afr-empty">Noch kein Regelwerk. Oben „Regelwerk destillieren" starten.</div>';
    return;
  }
  const total = (ruleset.basis && ruleset.basis.datensaetze) || 0;
  const when = (ruleset.createdAt || "").slice(0, 16).replace("T", " ");
  if (meta) meta.textContent = total ? total + " Datensätze · " + when : "";
  if (clearBtn) clearBtn.hidden = false;

  const uni = Array.isArray(ruleset.universelle_regeln) ? ruleset.universelle_regeln : [];
  const stil = (ruleset.stilabhaengige_regeln && typeof ruleset.stilabhaengige_regeln === "object") ? ruleset.stilabhaengige_regeln : {};

  let html = '<div class="dsgn-rules-sec"><div class="dsgn-rules-h">Universelle Regeln</div>';
  html += uni.length
    ? '<ol class="dsgn-rules-list">' + uni.map((r) => ruleItemHtml(r, total)).join("") + "</ol>"
    : '<div class="afr-empty">Keine universellen Regeln erkannt.</div>';
  html += "</div>";

  const keys = Object.keys(stil).sort((a, b) => (stil[b].anzahl || 0) - (stil[a].anzahl || 0));
  html += '<div class="dsgn-rules-sec"><div class="dsgn-rules-h">Stilabhängige Regeln</div>';
  if (!keys.length) html += '<div class="afr-empty">Keine stilabhängigen Regeln erkannt.</div>';
  for (const k of keys) {
    const grp = stil[k] || {};
    html += '<div class="dsgn-stil"><div class="dsgn-stil-h">' + esc(k) + ' <span class="dsgn-stil-n">' + (grp.anzahl || 0) + " Datensätze</span></div>";
    const regeln = Array.isArray(grp.regeln) ? grp.regeln : [];
    if (regeln.length) html += '<ol class="dsgn-rules-list">' + regeln.map((r) => ruleItemHtml(r, total)).join("") + "</ol>";
    const hr = Array.isArray(grp.herleitung_rollen) ? grp.herleitung_rollen : [];
    if (hr.length) {
      html += '<div class="dsgn-hr-h">Herleitung fehlender Rollen</div>';
      html += '<ul class="dsgn-rules-list dsgn-hr">' + hr.map((r) => ruleItemHtml(r, total)).join("") + "</ul>";
    }
    html += "</div>";
  }
  html += "</div>";
  root.innerHTML = html;
}

async function loadRuleset() {
  const r = await api("/admin/design-analysis/ruleset", {});
  if (r.http === 404 || r.http === 401) return;
  if (r.http !== 200 || !r.data || r.data.ok === false) { renderRuleset(null); return; }
  renderRuleset(r.data.ruleset || null);
}

// Destillieren läuft serverseitig als HINTERGRUND-JOB (der Sonnet-Lauf über ~40 Datensätze
// ist zu lang fürs Request-Fenster). Wir starten den Job (202 + jobId) und POLLEN den Status.
// Läuft serverseitig weiter, auch wenn der Browser schließt — beim Reload zeigt loadRuleset
// ein gespeichertes Regelwerk. So resettet der Knopf nicht mehr ohne Ergebnis.
async function distill() {
  if (rulesRunning || running) return;
  const btn = $("dsgnDistill");
  const setD = (t) => { const el = $("dsgnDistillStatus"); if (el) el.textContent = t || ""; };
  const done = () => { rulesRunning = false; if (btn) btn.disabled = false; };
  rulesRunning = true;
  if (btn) btn.disabled = true;
  const model = ($("dsgnModel") && $("dsgnModel").value) === "haiku" ? "haiku" : "sonnet";

  setD("Starte Destillieren …");
  const start = await api("/admin/design-analysis/distill", { model });
  if (start.http !== 202 || !start.data || !start.data.jobId) {
    done(); setD("");
    notify("Destillieren fehlgeschlagen: " + ((start.data && start.data.error) || ("HTTP " + start.http)), "error");
    return;
  }
  const jobId = start.data.jobId;
  const n = start.data.datensaetze || 0;
  const t0 = Date.now();
  const MAX_MS = 6 * 60 * 1000; // clientseitiges Poll-Limit; der Job läuft ggf. länger weiter

  while (Date.now() - t0 < MAX_MS) {
    await new Promise((r) => setTimeout(r, 2500));
    setD("Destilliere Regelwerk aus " + (n ? n + " " : "") + "Datensätzen … " + Math.round((Date.now() - t0) / 1000) + " s");
    const s = await api("/admin/design-analysis/distill-status", { jobId });
    if (s.http === 404) { // Job abgelaufen/verloren — vielleicht ist er trotzdem gespeichert
      done(); setD("");
      await loadRuleset();
      notify("Auftrag nicht mehr auffindbar — Regelwerk (falls gespeichert) unten geladen.", "warn");
      return;
    }
    if (s.http !== 200 || !s.data) continue; // transient -> weiter pollen
    if (s.data.status === "done") {
      renderRuleset(s.data.ruleset || null);
      setD("Regelwerk destilliert.");
      notify("Regelwerk destilliert", "success");
      done(); return;
    }
    if (s.data.status === "error") {
      done(); setD("");
      notify(s.data.error || "Destillieren fehlgeschlagen", "error");
      return;
    }
    // status "pending" -> weiter warten
  }
  // Client-Poll-Limit erreicht: serverseitig evtl. noch laufend/fertig -> Reload lädt es.
  done();
  setD("Dauert ungewöhnlich lange — später „Aktualisieren" klicken.");
  await loadRuleset();
}

async function clearRuleset() {
  if (rulesRunning) return;
  if (!confirm("Das destillierte Regelwerk verwerfen?")) return;
  const r = await api("/admin/design-analysis/ruleset-clear", {});
  if (r.http === 200 && r.data && r.data.ok) { notify("Regelwerk verworfen", "success"); renderRuleset(null); }
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
  if ($("dsgnReload")) $("dsgnReload").addEventListener("click", () => { loadRecords(); loadRuleset(); });
  if ($("dsgnDistill")) $("dsgnDistill").addEventListener("click", distill);
  if ($("dsgnRulesClear")) $("dsgnRulesClear").addEventListener("click", clearRuleset);
  const tabBtn = document.querySelector('.studio-tab[data-tab="dsgn"]');
  if (tabBtn) tabBtn.addEventListener("click", () => { loadRecords(); loadRuleset(); });
  renderThumbs();

  loadRecords().then((reachable) => { if (reachable && tabBtn) tabBtn.hidden = false; });
  loadRuleset();
}
