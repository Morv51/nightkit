// "Letzte Laeufe": zeigt die serverseitig laufenden UND fertigen Auto-Flow-Laeufe (nur
// ADMIN_TOOLS=1). Fragt NUR den Serverstatus ab (treibt den Lauf NICHT an) und zeigt
// Fortschritt + Bilder. Abbrechen, Fortsetzen und Loeschen pro Lauf, von jedem Geraet.
//
// ADDITIV: fertige Ergebnisse lassen sich hier DIREKT in den Live-Template-Bestand
// uebernehmen (einzeln oder mehrere zusammen in EINE Kategorie). Die Uebernahme nutzt
// den bestehenden Uploader-Weg (Server: /admin/autoflow/adopt -> uploadTemplate): JPEG +
// WebP-Thumbnail, automatische Verschlagwortung, Kategorie-Auswahl inkl. Neuanlage.
// Bereits uebernommene Ergebnisse sind mit Haekchen markiert (serverseitig, geraete-
// uebergreifend) -> keine versehentliche Doppel-Uebernahme. Der Lauf-Ablauf und die
// bestehende Ansicht bleiben unveraendert.

import { getToken } from "./studioApi.js";
import { notify } from "./studioUi.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let pollTimer = null;
let currentRuns = [];               // zuletzt gerenderte Laeufe (fuer die Uebernahme-Aktion)
let categories = [];                // Zielkategorien aus /admin/manage/list (lazy)
let catsLoaded = false;
const ui = new Map();               // runId -> { adopting, selected:Set, cat, newCat, name, autoTag, busy }

function uiState(runId) {
  let s = ui.get(runId);
  // promptOpen/promptData gehoeren in den UI-Zustand, nicht ins DOM: die Liste wird alle 4 s
  // neu gerendert, ein rein im DOM aufgeklappter Prompt waere sofort wieder weg.
  if (!s) { s = { adopting: false, selected: new Set(), cat: "", newCat: "", name: "", autoTag: true, busy: false,
    promptOpen: false, promptData: null, promptErr: "" }; ui.set(runId, s); }
  return s;
}

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

// Kategorien fuer die Uebernahme laden (gleiche Quelle wie der Uploader-Tab).
async function loadCategories() {
  try {
    const res = await fetch("/admin/manage/list", { headers: { "X-Admin-Token": getToken() } });
    if (!res.ok) return;
    const data = await res.json();
    categories = data.categories || [];
    catsLoaded = true;
  } catch (_) { /* Uebernahme-Panel zeigt dann nur "neu anlegen" */ }
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  } catch (_) { return iso; }
}

function labelFor(index) {
  const m = String(index).match(/^(\d+)-(haupt|v(\d+))$/);
  if (!m) return index;
  const kind = m[2] === "haupt" ? "Hauptflyer" : "Variante " + m[3];
  return kind + " · Flyer " + m[1];
}

const STATUS_LABEL = { running: "läuft", done: "fertig", cancelled: "abgebrochen", error: "Fehler", gespeichert: "gespeichert", interrupted: "unterbrochen" };

function catOptions(sel) {
  return '<option value="">Bestehende wählen …</option>' +
    categories.map((c) => '<option value="' + esc(c) + '"' + (c === sel ? " selected" : "") + ">" + esc(c) + "</option>").join("");
}

function tileHtml(im, st) {
  const selectable = st.adopting && !im.adopted;
  const isSel = st.selected.has(im.index);
  const cls = "afr-thumb" + (im.adopted ? " is-adopted" : "") + (selectable ? " afr-selectable" : "") + (isSel ? " is-sel" : "");
  const badge = im.adopted ? '<span class="afr-adopted-badge">✓ übernommen</span>' : "";
  const check = selectable ? '<span class="afr-tick" aria-hidden="true"></span>' : "";
  return '<a class="' + cls + '" href="' + esc(im.full) + '" target="_blank" rel="noopener" data-index="' + esc(im.index) + '" title="' + esc(labelFor(im.index)) + ' — Vollbild öffnen">' +
    '<img loading="lazy" src="' + esc(im.thumb) + '" alt="">' + badge + check +
    '<span class="afr-cap">' + esc(labelFor(im.index)) + "</span></a>";
}

function adoptBarHtml(st) {
  const n = st.selected.size;
  const cat = (st.newCat || "").trim() || st.cat;
  const canGo = n >= 1 && !!cat && !st.busy;
  return '<div class="afr-adopt">' +
    '<div class="afr-adopt-title">In den Bestand übernehmen · Ergebnisse antippen zum Auswählen</div>' +
    '<div class="afr-adopt-row">' +
      '<select class="afr-cat">' + catOptions(st.cat) + "</select>" +
      '<span class="afr-or">oder neu</span>' +
      '<input type="text" class="afr-newcat" maxlength="60" placeholder="Neue Kategorie" value="' + esc(st.newCat) + '">' +
    "</div>" +
    (n === 1
      ? '<div class="afr-adopt-row"><input type="text" class="afr-name" maxlength="60" placeholder="Anzeigename (optional)" value="' + esc(st.name) + '"></div>'
      : "") +
    '<label class="afr-autotag-lbl"><input type="checkbox" class="afr-autotag"' + (st.autoTag ? " checked" : "") + '> Tags automatisch erzeugen (ein Sonnet-Aufruf pro Bild)</label>' +
    '<div class="afr-adopt-actions">' +
      '<button class="rbtn rbtn-ghost afr-selall" type="button">Alle auswählen</button>' +
      '<button class="rbtn rbtn-primary afr-adopt-go" type="button"' + (canGo ? "" : " disabled") + ">In Bestand übernehmen (" + n + ")</button>" +
    "</div>" +
    (st.busy ? '<div class="afr-adopt-hint">Übernahme läuft … (Thumbnail + Verschlagwortung je Bild)</div>' : "") +
  "</div>";
}

// ── Einblick in den TATSAECHLICH GESENDETEN Bildprompt ───────────────────────
// Zaehlt die Marker, die selectRuleLines in den Prompt schreibt. Damit ist auf einen Blick
// belegt, ob der destillierte Anordnungsmuster-Text aus der latest.json wirklich drin steht,
// statt es am Bild raten zu muessen.
function regelBefund(prompt) {
  const p = String(prompt || "");
  const zeilen = p.split("\n");
  const muster = zeilen.find((l) => l.startsWith("- TYPICAL ARRANGEMENT:")) || "";
  return {
    muster: !!muster,
    musterText: muster.replace("- TYPICAL ARRANGEMENT:", "").trim(),
    regeln: zeilen.filter((l) => l.startsWith("- ARRANGEMENT RULE:")).length,
    rollen: zeilen.filter((l) => l.startsWith("- MISSING ROLE")).length,
    kopf: zeilen.some((l) => l.startsWith("SECONDARY-BLOCK ARRANGEMENT")),
    zeichen: p.length,
  };
}

function befundHtml(prompt) {
  const b = regelBefund(prompt);
  if (!b.kopf) {
    return '<div class="afr-befund is-off">Kein Regelwerk im Prompt. Entweder lief der Lauf mit Schalter <b>aus</b>, ' +
      'oder in der <code>latest.json</code> stand nichts Passendes.</div>';
  }
  const teile = [
    (b.muster ? '<b class="afr-ja">Muster: ja</b>' : '<b class="afr-nein">Muster: nein</b>'),
    b.regeln + " Anordnungsregeln",
    b.rollen + " Rollen-Herleitungen",
  ];
  return '<div class="afr-befund' + (b.muster ? "" : " is-warn") + '">Regelwerk im Prompt · ' + teile.join(" · ") +
    (b.muster ? '<div class="afr-befund-m">' + esc(b.musterText) + "</div>"
      : '<div class="afr-befund-m">Kein <code>anordnung_muster</code> im Prompt. Typisch für ein noch nicht neu destilliertes Regelwerk im alten Format.</div>') +
    "</div>";
}

function promptPanelHtml(runId, st) {
  if (!st.promptOpen) return "";
  if (st.promptErr) return '<div class="afr-prompt-box"><div class="afr-empty">' + esc(st.promptErr) + "</div></div>";
  const d = st.promptData;
  if (!d) return '<div class="afr-prompt-box"><div class="afr-empty">Lade Prompt …</div></div>';
  const files = Array.isArray(d.files) ? d.files : [];
  if (!files.length) return '<div class="afr-prompt-box"><div class="afr-empty">Keine Prompts im Lauf gespeichert.</div></div>';
  const teil = (titel, prompt, key) => {
    if (!prompt) return '<div class="afr-empty">' + esc(titel) + ": kein Prompt gespeichert.</div>";
    return '<details class="afr-prompt-det"><summary>' + esc(titel) +
      ' <span class="afr-prompt-n">' + prompt.length + " Zeichen</span>" +
      '<button class="rbtn rbtn-ghost afr-prompt-copy" type="button" data-key="' + esc(key) + '">Kopieren</button></summary>' +
      befundHtml(prompt) +
      '<pre class="afr-prompt-pre" data-key="' + esc(key) + '">' + esc(prompt) + "</pre></details>";
  };
  return '<div class="afr-prompt-box">' + files.map((f) => {
    const kopf = '<div class="afr-prompt-h">' + esc(f.name || ("Datei " + f.fnum)) +
      (f.hand ? ' <b class="afr-hand">Handzuordnung</b>' : "") + "</div>";
    if (f.analyzeError) return kopf + '<div class="afr-empty">Analyse fehlgeschlagen: ' + esc(f.analyzeError) + "</div>";
    // Hauptflyer-Zeile nur, wenn es einen gibt (Clean-Flow-Varianten haben keinen).
    const haupt = f.mainPrompt ? teil("Hauptflyer", f.mainPrompt, f.fnum + "-haupt") : "";
    const vars = (f.variantPrompts || []).map((v) =>
      teil("Variante " + v.num + (v.label ? " · " + v.label : ""), v.prompt, f.fnum + "-v" + v.num)).join("");
    return kopf + haupt + vars;
  }).join("") + "</div>";
}

function render(runs) {
  currentRuns = runs || [];
  const root = $("afRunsRoot");
  if (!root) return;
  if (!runs || !runs.length) {
    root.innerHTML = '<div class="afr-empty">Noch keine Läufe. Starte in Auto-Flow 1, 2 oder 3, dann läuft der Auftrag auf dem Server weiter, auch wenn du den Tab schließt, und erscheint hier mit Fortschritt und Bildern.</div>';
    return;
  }
  root.innerHTML = runs.map((r) => {
    const st = uiState(r.runId);
    const total = r.total || 0, done = r.done || 0, failed = r.failed || 0;
    const running = r.status === "running";
    const incomplete = total > 0 && done < total;
    const pct = total ? Math.round((done / total) * 100) : ((r.images && r.images.length) ? 100 : 0);
    const stLabel = STATUS_LABEL[r.status] || r.status || "";
    const hasFree = (r.images || []).some((im) => !im.adopted);
    const imgs = (r.images || []).map((im) => tileHtml(im, st)).join("");
    const progress = total
      ? '<div class="afr-prog"><span style="width:' + pct + '%"></span></div>' +
        '<div class="afr-progtext">' + done + " von " + total + " fertig" + (failed ? ", " + failed + " fehlgeschlagen" : "") + (running ? " · läuft …" : "") + "</div>"
      : "";
    let btns = "";
    if (hasFree) btns += '<button class="rbtn afr-adopt-toggle' + (st.adopting ? " is-on" : "") + '" type="button" data-run="' + esc(r.runId) + '">' + (st.adopting ? "Übernahme beenden" : "In Bestand übernehmen") + "</button>";
    btns += '<button class="rbtn rbtn-ghost afr-prompt' + (st.promptOpen ? " is-on" : "") + '" type="button" data-run="' + esc(r.runId) + '">' + (st.promptOpen ? "Prompt zu" : "Prompt ansehen") + "</button>";
    if (running) btns += '<button class="rbtn rbtn-ghost afr-cancel" type="button" data-run="' + esc(r.runId) + '">Abbrechen</button>';
    if (incomplete) btns += '<button class="rbtn rbtn-ghost afr-resume" type="button" data-run="' + esc(r.runId) + '">Fortsetzen</button>';
    btns += '<button class="rbtn rbtn-danger afr-del" type="button" data-run="' + esc(r.runId) + '">Löschen</button>';
    return '<div class="afr-run" data-run="' + esc(r.runId) + '">' +
      '<div class="afr-head">' +
        '<div class="afr-meta"><b>' + (r.flow === "clean" ? "Clean-Flow" : "Auto-Flow " + esc(r.flow || "?")) + "</b> · " + esc(fmtTime(r.createdAt)) +
          (r.mode ? " · " + esc(r.mode) : "") +
          // A/B auf einen Blick: ohne Marke lief der Lauf ohne Regelwerk.
          (r.regelwerk ? ' · <b class="afr-rules">Regelwerk</b>' : "") +
          // Zweiter A/B-Vergleich: ohne Marke lief der Lauf mit der Auto-Analyse.
          (r.hand ? ' · <b class="afr-hand">Handzuordnung</b>' : "") +
          (r.sourceName ? " · " + esc(r.sourceName) : "") +
          ' <span class="afr-badge afr-st-' + esc(r.status || "") + '">' + esc(stLabel) + "</span></div>" +
        '<div class="afr-btns">' + btns + "</div>" +
      "</div>" + progress +
      promptPanelHtml(r.runId, st) +
      '<div class="afr-grid">' + imgs + "</div>" +
      (st.adopting ? adoptBarHtml(st) : "") +
    "</div>";
  }).join("");
}

// Gezielte DOM-Aktualisierung der Uebernahme-Leiste (ohne Voll-Neurender -> Fokus/Eingaben
// bleiben erhalten, wenn im Textfeld getippt wird).
function updateAdoptBar(runId) {
  const st = uiState(runId);
  const card = $("afRunsRoot") && $("afRunsRoot").querySelector('.afr-run[data-run="' + CSS.escape(runId) + '"]');
  if (!card) return;
  const n = st.selected.size;
  const cat = (st.newCat || "").trim() || st.cat;
  const go = card.querySelector(".afr-adopt-go");
  if (go) { go.textContent = "In Bestand übernehmen (" + n + ")"; go.disabled = !(n >= 1 && !!cat && !st.busy); }
  // Name-Feld nur bei genau einem ausgewaehlten Ergebnis sinnvoll -> Leiste neu aufbauen,
  // wenn sich das Vorhandensein aendert (0/2+ <-> 1). Fokus liegt dann auf einer Kachel.
  const hasName = !!card.querySelector(".afr-name");
  if ((n === 1) !== hasName) {
    const bar = card.querySelector(".afr-adopt");
    if (bar) bar.outerHTML = adoptBarHtml(st);
  }
}

function setTileStatus(runId, index, text, kind) {
  const card = $("afRunsRoot") && $("afRunsRoot").querySelector('.afr-run[data-run="' + CSS.escape(runId) + '"]');
  if (!card) return;
  const tile = card.querySelector('.afr-thumb[data-index="' + CSS.escape(index) + '"]');
  if (!tile) return;
  let s = tile.querySelector(".afr-cap");
  if (s) { s.textContent = text; s.className = "afr-cap afr-cap-status" + (kind ? " " + kind : ""); }
}

async function toggleAdopt(runId) {
  const st = uiState(runId);
  if (!st.adopting && !catsLoaded) await loadCategories();
  st.adopting = !st.adopting;
  if (!st.adopting) st.selected.clear();
  render(currentRuns);
}

function toggleSelect(runId, index) {
  const st = uiState(runId);
  if (st.busy) return;
  const run = currentRuns.find((r) => r.runId === runId);
  const im = run && (run.images || []).find((i) => i.index === index);
  if (!im || im.adopted) return; // bereits uebernommen -> nicht auswaehlbar
  if (st.selected.has(index)) st.selected.delete(index); else st.selected.add(index);
  const card = $("afRunsRoot").querySelector('.afr-run[data-run="' + CSS.escape(runId) + '"]');
  const tile = card && card.querySelector('.afr-thumb[data-index="' + CSS.escape(index) + '"]');
  if (tile) tile.classList.toggle("is-sel", st.selected.has(index));
  updateAdoptBar(runId);
}

function selectAll(runId) {
  const st = uiState(runId);
  const run = currentRuns.find((r) => r.runId === runId);
  if (!run) return;
  const free = (run.images || []).filter((im) => !im.adopted).map((im) => im.index);
  const allSel = free.length && free.every((i) => st.selected.has(i));
  st.selected = allSel ? new Set() : new Set(free); // Umschalter: alle / keine
  render(currentRuns);
}

async function adoptSelected(runId) {
  const st = uiState(runId);
  const run = currentRuns.find((r) => r.runId === runId);
  if (!run || st.busy) return;
  const indices = [...st.selected];
  if (!indices.length) return;
  const category = (st.newCat || "").trim() || st.cat;
  if (!category) { notify("Bitte Kategorie wählen oder eingeben", "error"); return; }
  const single = indices.length === 1;
  const autoTag = st.autoTag;
  const name = single ? (st.name || "").trim() : "";

  st.busy = true;
  updateAdoptBar(runId);
  let done = 0, failed = 0;
  for (const index of indices) {
    setTileStatus(runId, index, "übernehme …");
    const r = await api("/admin/autoflow/adopt", { runId, index, category, autoTag, name });
    if (r.http === 401) { notify("Sitzung abgelaufen — bitte Seite neu laden.", "error"); st.busy = false; return; }
    if (r.http === 200 && r.data && r.data.ok !== false) {
      done++;
      const im = (run.images || []).find((i) => i.index === index);
      if (im) im.adopted = true;
      st.selected.delete(index);
    } else {
      failed++;
      setTileStatus(runId, index, "Fehler: " + ((r.data && r.data.error) || ("HTTP " + r.http)), "err");
    }
  }
  st.busy = false;

  // Neue Kategorie koennte entstanden sein -> Kategorien + Bestandsverwaltung auffrischen.
  if (done) {
    await loadCategories();
    document.dispatchEvent(new CustomEvent("nk-templates-changed"));
    notify(done + (done === 1 ? " Ergebnis" : " Ergebnisse") + " übernommen · Kategorie " + category + (failed ? " · " + failed + " Fehler" : ""), failed ? "warn" : "success");
  } else if (failed) {
    notify("Übernahme fehlgeschlagen (" + failed + ")", "error");
  }
  // Bleiben noch nicht-uebernommene Bilder? Dann Uebernahme-Modus offen lassen.
  if (!(run.images || []).some((im) => !im.adopted)) st.adopting = false;
  render(currentRuns);
}

async function load() {
  const root = $("afRunsRoot");
  if (root && !root.querySelector(".afr-run")) root.innerHTML = '<div class="afr-empty">Lade …</div>';
  let r;
  try { r = await api("/admin/autoflow/runs", {}); }
  catch (e) { if (root) root.innerHTML = '<div class="afr-empty">Konnte nicht laden: ' + esc(e.message || "Netzwerkfehler") + "</div>"; return true; }
  if (r.http === 404) return false; // ADMIN_TOOLS aus -> Reiter verborgen lassen
  if (r.http === 401) { if (root) root.innerHTML = '<div class="afr-empty">Sitzung abgelaufen. Bitte Seite neu laden und Code 99 erneut eingeben.</div>'; return true; }
  if (r.http !== 200 || !r.data || r.data.ok === false) {
    if (root) root.innerHTML = '<div class="afr-empty">Speicher nicht verfügbar: ' + esc((r.data && r.data.error) || ("HTTP " + r.http)) + "</div>";
    return true;
  }
  const runs = r.data.runs || [];
  render(runs);
  // Solange etwas laeuft und der Reiter sichtbar ist, automatisch nachladen — aber NICHT
  // waehrend gerade eine Uebernahme-Auswahl offen ist (sonst wuerde die Auswahl stoeren).
  clearTimeout(pollTimer);
  const panel = $("panel-afruns");
  const visible = panel && panel.offsetParent !== null;
  const adopting = runs.some((x) => uiState(x.runId).adopting);
  if (!adopting && runs.some((x) => x.status === "running") && visible) pollTimer = setTimeout(load, 4000);
  return true;
}

async function cancel(runId) {
  if (!runId) return;
  if (!confirm("Diesen laufenden Auto-Flow abbrechen?\nDie bereits fertigen Bilder bleiben erhalten.")) return;
  const r = await api("/admin/autoflow/cancel", { runId });
  if (r.http === 200) { notify("Abbruch angefordert", "info"); load(); }
  else notify("Abbrechen fehlgeschlagen: " + ((r.data && r.data.error) || ("HTTP " + r.http)), "error");
}

async function resume(runId) {
  if (!runId) return;
  const r = await api("/admin/autoflow/resume", { runId });
  if (r.http === 200) { notify("Lauf wird fortgesetzt", "success"); load(); }
  else notify("Fortsetzen fehlgeschlagen: " + ((r.data && r.data.error) || ("HTTP " + r.http)), "error");
}

async function delRun(runId) {
  if (!runId) return;
  if (!confirm("Diesen Lauf endgültig löschen?\nAlle gespeicherten Bilder dieses Laufs werden aus R2 entfernt.")) return;
  const r = await api("/admin/autoflow/delete", { runId });
  if (r.http === 200 && r.data && r.data.ok) { notify("Lauf gelöscht", "success"); load(); }
  else notify("Löschen fehlgeschlagen: " + ((r.data && r.data.error) || ("HTTP " + r.http)), "error");
}

// Prompt-Einblick auf Abruf holen (nicht im 4-s-Poll) und im UI-Zustand halten.
async function togglePrompt(runId) {
  const st = uiState(runId);
  if (st.promptOpen) { st.promptOpen = false; render(currentRuns); return; }
  st.promptOpen = true; st.promptErr = "";
  render(currentRuns);                        // sofort "Lade Prompt …" zeigen
  if (st.promptData) return;                  // schon geholt -> kein zweiter Aufruf
  const r = await api("/admin/autoflow/prompt", { runId });
  if (r.http === 200 && r.data && r.data.ok) st.promptData = r.data;
  else st.promptErr = "Prompt nicht ladbar: " + ((r.data && r.data.error) || ("HTTP " + r.http));
  render(currentRuns);
}

function copyPrompt(runId, key) {
  const card = document.querySelector('.afr-run[data-run="' + CSS.escape(runId) + '"]');
  const pre = card && card.querySelector('.afr-prompt-pre[data-key="' + CSS.escape(key) + '"]');
  if (!pre) return;
  const text = pre.textContent || "";
  const ok2 = () => notify("Prompt kopiert", "success");
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok2).catch(() => notify("Kopieren nicht möglich", "error"));
  else notify("Kopieren nicht möglich", "error");
}

function runIdOfEvent(e) {
  const card = e.target.closest(".afr-run");
  return card ? card.dataset.run : "";
}

export function initAutoflowRuns() {
  const root = $("afRunsRoot");
  if (!root) return;
  root.addEventListener("click", (e) => {
    // Uebernahme-Modus umschalten.
    const tog = e.target.closest(".afr-adopt-toggle"); if (tog) { e.preventDefault(); return toggleAdopt(tog.dataset.run); }
    // Auswahl per Kachel-Tipp (nur im Uebernahme-Modus, nur nicht-uebernommene).
    const sel = e.target.closest(".afr-thumb.afr-selectable");
    if (sel) { e.preventDefault(); return toggleSelect(runIdOfEvent(e), sel.dataset.index); }
    const all = e.target.closest(".afr-selall"); if (all) { e.preventDefault(); return selectAll(runIdOfEvent(e)); }
    const go = e.target.closest(".afr-adopt-go"); if (go) { e.preventDefault(); return adoptSelected(runIdOfEvent(e)); }
    // Kopieren VOR dem Aufklapp-Umschalter pruefen: der Knopf sitzt im <summary>, sonst
    // klappte das <details> beim Kopieren mit zu.
    const cp = e.target.closest(".afr-prompt-copy");
    if (cp) { e.preventDefault(); e.stopPropagation(); return copyPrompt(runIdOfEvent(e), cp.dataset.key); }
    const pr = e.target.closest(".afr-prompt"); if (pr) { e.preventDefault(); return togglePrompt(pr.dataset.run); }
    const del = e.target.closest(".afr-del"); if (del) { e.preventDefault(); return delRun(del.dataset.run); }
    const c = e.target.closest(".afr-cancel"); if (c) { e.preventDefault(); return cancel(c.dataset.run); }
    const rs = e.target.closest(".afr-resume"); if (rs) { e.preventDefault(); return resume(rs.dataset.run); }
  });
  // Formularwerte der Uebernahme-Leiste in den UI-Zustand spiegeln (ohne Neurender).
  root.addEventListener("input", (e) => {
    const runId = runIdOfEvent(e); if (!runId) return;
    const st = uiState(runId);
    if (e.target.classList.contains("afr-newcat")) { st.newCat = e.target.value; updateAdoptBar(runId); }
    else if (e.target.classList.contains("afr-name")) { st.name = e.target.value; }
  });
  root.addEventListener("change", (e) => {
    const runId = runIdOfEvent(e); if (!runId) return;
    const st = uiState(runId);
    if (e.target.classList.contains("afr-cat")) { st.cat = e.target.value; updateAdoptBar(runId); }
    else if (e.target.classList.contains("afr-autotag")) { st.autoTag = e.target.checked; }
  });
  const reload = $("afRunsReload");
  if (reload) reload.addEventListener("click", load);
  const tabBtn = document.querySelector('.studio-tab[data-tab="afruns"]');
  if (tabBtn) tabBtn.addEventListener("click", load);
  load().then((reachable) => { if (reachable && tabBtn) tabBtn.hidden = false; });
}
