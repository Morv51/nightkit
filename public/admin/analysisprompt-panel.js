// Analyse-Prompt-Generator als Studio-Panel. Referenzflyer + Genre + Vibe ->
// EIN Modell-Call -> fertiger Bildgenerierungs-Prompt zum Kopieren.
//
// Erzeugt SELBST KEIN BILD und speichert nichts. Nutzt das GETEILTE Admin-Token
// aus studioApi.js (also keine zweite Code-Abfrage) und die vorhandenen Helfer
// wireDropzone/fileToDataUrl aus studioUi.js. Rendert in #panel-aprompt.
//
// Ist ADMIN_TOOLS aus, liefert /admin/aprompt/ping 404 -> der Reiter bleibt
// verborgen und die Studio-Seite sieht aus wie bisher.
//
// Der Lauf haengt am Job-Muster: /admin/aprompt/run gibt sofort eine jobId
// zurueck, danach wird /admin/aprompt/status im Takt abgefragt. So kann der
// Modell-Call beliebig lange laufen, ohne am 120-s-Inaktivitaets-Timeout zu
// zerbrechen.

import { getToken, post } from "./studioApi.js";
import { wireDropzone, fileToDataUrl } from "./studioUi.js";

const POLL_MS = 2000;

const state = { image: null, imageName: "", jobId: null, timer: null, ticker: null, startedAt: 0, running: false, suggesting: false, starting: false, runJobId: null, runTimer: null, runTicker: null, runStartedAt: 0,
  // Nur-Prompts: eigener Job und die Liste. kopiert haelt fest, welche Eintraege
  // schon in der Zwischenablage waren — nur fuer diese Sitzung, kein Speichern.
  onlyJobId: null, onlyTimer: null, onlyStartedAt: 0, onlyRunning: false, prompts: [], kopiert: new Set() };

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const panel = () => document.getElementById("panel-aprompt");
const $ = (id) => document.getElementById(id);

// Eigene Sonde statt post(): post() wirft ohne Statuscode, wir muessen aber 404
// (Werkzeug aus) von echten Fehlern unterscheiden koennen.
async function probe() {
  const res = await fetch("/admin/aprompt/ping", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": getToken() },
    body: "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || "HTTP " + res.status); e.status = res.status; throw e; }
  return data;
}

// "aus" statt leer, damit sichtbar ist, dass ein Feld bewusst weggelassen wird.
const stufe = (v) => esc(v || "aus");
function metaZeile(info) {
  return esc(info.model) + " &middot; Stufe " + stufe(info.effort)
    + " &middot; Ausf\u00fchrlichkeit " + stufe(info.verbosity)
    + " &middot; max. " + esc(String(info.maxOutput)) + " Ausgabe-Tokens"
    + (info.classifyModel ? " &middot; Vorschlag: " + esc(info.classifyModel) : "");
}

function shell(info) {
  const cfgWarn = info && info.configured === false
    ? '<p class="ap-warn">OPENAI_API_KEY ist nicht gesetzt — der Lauf schlägt fehl, bis der Schlüssel in Render eingetragen ist.</p>'
    : "";
  return `
    <div class="ap-wrap">
      <header class="ap-head">
        <h2 class="ap-h2">Analyse-Prompt</h2>
        <p class="ap-sub">Referenzflyer, Genre und Vibe eintragen — heraus kommt ein fertiger Bildgenerierungs-Prompt zum Kopieren. Dieses Werkzeug erzeugt selbst kein Bild und speichert nichts.</p>
        ${cfgWarn}
      </header>

      <div class="ap-grid">
        <div class="ap-col">
          <span class="ap-label">Referenzflyer</span>
          <div class="st-drop ap-drop" id="ap-drop" role="button" tabindex="0">
            <span>Flyer hierher ziehen<br><small>oder klicken zum Auswählen</small></span>
          </div>
          <input type="file" id="ap-file" accept="image/png,image/jpeg,image/webp" hidden>
          <figure class="ap-preview" id="ap-preview" hidden>
            <img id="ap-img" alt="Gewählter Referenzflyer">
            <figcaption class="ap-fname" id="ap-fname"></figcaption>
            <button type="button" class="ap-clear" id="ap-clear">Anderes Bild wählen</button>
          </figure>
          <button type="button" class="ap-suggest" id="ap-suggest" disabled>Genre und Vibe vorschlagen</button>
        </div>

        <div class="ap-col">
          <label class="ap-label" for="ap-genre">Genre</label>
          <input type="text" id="ap-genre" class="ap-input" placeholder="z. B. Afro House" autocomplete="off">

          <label class="ap-label" for="ap-vibe">Vibe</label>
          <input type="text" id="ap-vibe" class="ap-input" placeholder="z. B. dunkel, roh, urban" autocomplete="off">

          <button type="button" class="ap-go" id="ap-go">Prompt erzeugen</button>
          <p class="ap-meta" id="ap-meta">${info ? metaZeile(info) : ""}</p>
        </div>
      </div>

      <div class="ap-status" id="ap-status" hidden></div>
      <div class="ap-error" id="ap-error" hidden></div>

      <div class="ap-out" id="ap-out" hidden>
        <div class="ap-out-head">
          <span class="ap-label">Erzeugter Prompt</span>
          <button type="button" class="ap-copy" id="ap-copy">Kopieren</button>
        </div>
        <textarea id="ap-text" class="ap-text" rows="12" spellcheck="false" readonly></textarea>
        <div class="ap-run-row">
          <button type="button" class="ap-run" id="ap-run">Bilder erzeugen</button>
          <button type="button" class="ap-run ap-only" id="ap-only">Nur Prompts erzeugen</button>
          <label class="ap-count-lab" for="ap-count">Varianten</label>
          <input type="number" id="ap-count" class="ap-count" min="1" max="10" step="1" value="3">
          <span class="ap-run-note" id="ap-run-note"></span>
        </div>
        <div class="ap-list" id="ap-list" hidden></div>
      </div>
    </div>`;
}

function showError(msg) {
  const el = $("ap-error");
  if (!el) return;
  el.innerHTML = esc(msg);
  el.hidden = false;
}
function clearError() { const el = $("ap-error"); if (el) { el.hidden = true; el.textContent = ""; } }

function setStatus(msg) {
  const el = $("ap-status");
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ""; return; }
  el.textContent = msg;
  el.hidden = false;
}

function setRunning(on) {
  state.running = on;
  const go = $("ap-go");
  if (go) { go.disabled = on; go.textContent = on ? "Läuft…" : "Prompt erzeugen"; }
  ["ap-genre", "ap-vibe"].forEach((id) => { const e = $(id); if (e) e.disabled = on; });
  const drop = $("ap-drop"); if (drop) drop.classList.toggle("ap-locked", on);
  const sug = $("ap-suggest"); if (sug) sug.disabled = on || !state.image || state.suggesting;
  const cnt = $("ap-count"); if (cnt) cnt.disabled = on || state.starting;
}

function stopTimers() {
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  if (state.ticker) { clearInterval(state.ticker); state.ticker = null; }
}

async function pickFile(f) {
  if (!f) return;
  clearError();
  try {
    const dataUrl = await fileToDataUrl(f);
    state.image = dataUrl;
    state.imageName = f.name || "";
    const img = $("ap-img"), prev = $("ap-preview"), drop = $("ap-drop"), fname = $("ap-fname");
    if (img) img.src = dataUrl;
    if (fname) fname.textContent = state.imageName;
    if (prev) prev.hidden = false;
    if (drop) drop.hidden = true;
    const sug = $("ap-suggest"); if (sug) sug.disabled = false;   // erst mit Bild nutzbar
  } catch (e) {
    showError("Bild konnte nicht gelesen werden: " + (e && e.message ? e.message : e));
  }
}

function clearImage() {
  state.image = null; state.imageName = "";
  const prev = $("ap-preview"), drop = $("ap-drop"), file = $("ap-file");
  if (prev) prev.hidden = true;
  if (drop) drop.hidden = false;
  if (file) file.value = "";
  const sug = $("ap-suggest"); if (sug) sug.disabled = true;
}

async function poll() {
  if (!state.jobId) return;
  let job;
  try {
    job = await post("/admin/aprompt/status", { jobId: state.jobId });
  } catch (e) {
    stopTimers();
    setStatus("");
    setRunning(false);
    state.jobId = null;
    showError("Abfrage fehlgeschlagen: " + (e && e.message ? e.message : e));
    return;
  }

  if (job.status === "pending") {
    state.timer = setTimeout(poll, POLL_MS);
    return;
  }

  stopTimers();
  setStatus("");
  setRunning(false);
  state.jobId = null;

  if (job.status === "error") {
    showError(job.error || "Unbekannter Fehler");
    return;
  }

  const out = $("ap-out"), ta = $("ap-text"), meta = $("ap-meta");
  if (ta) ta.value = job.text || "";
  if (out) out.hidden = false;
  if (meta && job.model) meta.textContent = job.model + " · Stufe " + (job.effort || "") + " · " + (job.text ? job.text.length : 0) + " Zeichen";
  const copy = $("ap-copy"); if (copy) copy.textContent = "Kopieren";
}

// Kleiner Zweit-Call. Fuellt nur die beiden Felder vor, die editierbar bleiben,
// und startet die Hauptanalyse ausdruecklich NICHT. Stimmt das Format der
// Modellantwort nicht, meldet der Server das — dann bleiben die Felder, wie sie
// sind, und der Fehler steht sichtbar in der Maske.
async function suggestGenreVibe() {
  if (!state.image || state.suggesting || state.running) return;
  clearError();
  const btn = $("ap-suggest");
  state.suggesting = true;
  if (btn) { btn.disabled = true; btn.textContent = "Schlage vor\u2026"; }
  try {
    const r = await post("/admin/aprompt/suggest", { image: state.image });
    const g = $("ap-genre"), v = $("ap-vibe");
    if (g && r.genre) g.value = r.genre;
    if (v && r.vibe) v.value = r.vibe;
  } catch (e) {
    showError("Vorschlag fehlgeschlagen: " + (e && e.message ? e.message : e));
  } finally {
    state.suggesting = false;
    if (btn) { btn.disabled = !state.image || state.running; btn.textContent = "Genre und Vibe vorschlagen"; }
  }
}

async function start() {
  if (state.running) return;
  clearError();
  const genre = ($("ap-genre") && $("ap-genre").value || "").trim();
  const vibe = ($("ap-vibe") && $("ap-vibe").value || "").trim();
  if (!state.image) return showError("Bitte zuerst einen Referenzflyer wählen.");
  if (!genre) return showError("Bitte ein Genre eintragen.");
  if (!vibe) return showError("Bitte einen Vibe eintragen.");

  const out = $("ap-out"); if (out) out.hidden = true;
  const note = $("ap-run-note"); if (note) note.innerHTML = "";
  state.prompts = []; state.kopiert = new Set(); zeigeListe();   // alte Liste raeumen
  setRunning(true);
  state.startedAt = Date.now();
  setStatus("Analyse läuft — das dauert erfahrungsgemäß mehrere Minuten.");
  state.ticker = setInterval(() => {
    const s = Math.round((Date.now() - state.startedAt) / 1000);
    setStatus("Analyse läuft seit " + s + " s — das dauert erfahrungsgemäß mehrere Minuten.");
  }, 1000);

  try {
    const r = await post("/admin/aprompt/run", { image: state.image, genre, vibe });
    if (!r || !r.jobId) throw new Error("Server lieferte keine Lauf-Kennung");
    state.jobId = r.jobId;
    state.timer = setTimeout(poll, POLL_MS);
  } catch (e) {
    stopTimers();
    setStatus("");
    setRunning(false);
    showError("Start fehlgeschlagen: " + (e && e.message ? e.message : e));
  }
}

// ── Nur Prompts erzeugen ────────────────────────────────────────────────────
// Markup und Klassen sind die der Prompt-Ansicht im Reiter "Laeufe" (afr-*, in
// studio.css global definiert), damit es identisch aussieht. Bewusst OHNE deren
// befundHtml(): das rendert ein Regelwerk-Urteil aus dem Auto-Flow-A/B-Schalter,
// das hier nichts zu suchen haette. Und mit eigener Kopier-Funktion, weil
// copyPrompt() dort nach einer Lauf-Kachel (.afr-run) sucht, die es in diesem
// Panel nicht gibt.

function listeHtml() {
  if (!state.prompts.length) return "";
  return state.prompts.map((p, i) => {
    const titel = i === 0 ? "Hauptflyer" : "Variante " + i;
    const kopiert = state.kopiert.has(i);
    return '<details class="afr-prompt-det ap-entry' + (kopiert ? " is-kopiert" : "") + '" data-i="' + i + '">'
      + '<summary>' + esc(titel)
      + (kopiert ? ' <span class="ap-kopiert-mark">kopiert</span>' : "")
      + ' <span class="afr-prompt-n">' + p.length + " Zeichen</span>"
      + '<button class="rbtn rbtn-ghost afr-prompt-copy" type="button" data-i="' + i + '">Kopieren</button>'
      + "</summary>"
      + '<pre class="afr-prompt-pre" data-i="' + i + '">' + esc(p) + "</pre></details>";
  }).join("");
}

function zeigeListe() {
  const el = $("ap-list");
  if (!el) return;
  if (!state.prompts.length) { el.hidden = true; el.innerHTML = ""; return; }
  // Aufgeklappte Eintraege ueber das Neuzeichnen retten.
  const offen = new Set([...el.querySelectorAll("details[open]")].map((d) => d.dataset.i));
  el.innerHTML = listeHtml();
  el.hidden = false;
  for (const d of el.querySelectorAll("details")) if (offen.has(d.dataset.i)) d.open = true;
}

// Eigene Kopier-Funktion: sucht im EIGENEN Panel, nicht in einer Lauf-Kachel.
// Dreistufig wie der Kopieren-Knopf oben — Zwischenablage, execCommand,
// notfalls markieren.
async function kopiereEintrag(i) {
  const pre = document.querySelector('#ap-list .afr-prompt-pre[data-i="' + i + '"]');
  if (!pre) return;
  const text = pre.textContent || "";
  let ok2 = false;
  try { await navigator.clipboard.writeText(text); ok2 = true; } catch (_) { /* zweiter Weg */ }
  if (!ok2) {
    const aus = window.getSelection();
    const bereich = document.createRange();
    bereich.selectNodeContents(pre);
    aus.removeAllRanges(); aus.addRange(bereich);
    try { ok2 = document.execCommand("copy"); } catch (_) { ok2 = false; }
  }
  // Die Markierung bleibt, damit bei acht Prompts klar ist, was schon durch ist.
  state.kopiert.add(i);
  zeigeListe();
}

async function pollOnly() {
  if (!state.onlyJobId) return;
  let job;
  try { job = await post("/admin/aprompt/status", { jobId: state.onlyJobId }); }
  catch (e) { onlyFertig(); showError("Abfrage fehlgeschlagen: " + (e && e.message ? e.message : e)); return; }
  if (job.status === "pending") { state.onlyTimer = setTimeout(pollOnly, 2000); return; }

  onlyFertig();
  if (job.status === "error") { showError("Prompts konnten nicht erzeugt werden: " + (job.error || "Unbekannter Fehler")); return; }

  state.prompts = Array.isArray(job.prompts) ? job.prompts : [];
  state.kopiert = new Set();                 // neue Liste, Markierungen zuruecksetzen
  zeigeListe();
  const note = $("ap-run-note");
  if (note) {
    const zuviel = job.verworfen ? " (" + job.verworfen + " ueberzaehlige verworfen)" : "";
    note.textContent = state.prompts.length + (state.prompts.length === 1 ? " Prompt" : " Prompts") + " erzeugt" + zuviel + " — kein Bild erzeugt.";
  }
}

function onlyFertig() {
  if (state.onlyTimer) { clearTimeout(state.onlyTimer); state.onlyTimer = null; }
  state.onlyJobId = null;
  state.onlyRunning = false;
  const btn = $("ap-only"), cnt = $("ap-count");
  if (btn) { btn.disabled = false; btn.textContent = "Nur Prompts erzeugen"; }
  if (cnt) cnt.disabled = false;
  const run = $("ap-run"); if (run) run.disabled = false;
}

async function startOnlyPrompts() {
  const ta = $("ap-text");
  if (state.onlyRunning || state.starting || !ta || !ta.value.trim()) return;
  clearError();
  const cnt = $("ap-count");
  let anzahl = parseInt(cnt && cnt.value, 10);
  if (!Number.isFinite(anzahl)) anzahl = 3;
  anzahl = Math.max(1, Math.min(10, anzahl));
  if (cnt) cnt.value = String(anzahl);

  const btn = $("ap-only"), note = $("ap-run-note"), run = $("ap-run");
  state.onlyRunning = true;
  state.onlyStartedAt = Date.now();
  if (btn) { btn.disabled = true; btn.textContent = "Erzeugt\u2026"; }
  if (cnt) cnt.disabled = true;
  if (run) run.disabled = true;
  if (note) note.textContent = anzahl > 1 ? "Prompts werden erzeugt \u2014 das dauert bei h\u00f6herer Anzahl mehrere Minuten." : "";

  try {
    const r = await post("/admin/aprompt/variants", { prompt: ta.value, anzahl });
    if (!r || !r.jobId) throw new Error("Server lieferte keine Lauf-Kennung");
    state.onlyJobId = r.jobId;
    state.onlyTimer = setTimeout(pollOnly, 2000);
  } catch (e) {
    onlyFertig();
    if (note) note.textContent = "";
    showError("Prompts konnten nicht erzeugt werden: " + (e && e.message ? e.message : e));
  }
}

// Startet einen Auto-Flow-Lauf aus diesem Produktionsprompt. Ab Anzahl 2 laeuft
// serverseitig zuerst der Variantencall — der kann Minuten dauern, darum Job-Muster
// mit Abfrage im Takt. Bei Anzahl 1 ist der Job praktisch sofort fertig.
function stopRunTimers() {
  if (state.runTimer) { clearTimeout(state.runTimer); state.runTimer = null; }
  if (state.runTicker) { clearInterval(state.runTicker); state.runTicker = null; }
}

function runFertig() {
  stopRunTimers();
  state.runJobId = null;
  state.starting = false;
  const btn = $("ap-run"), cnt = $("ap-count");
  if (btn) { btn.disabled = false; btn.textContent = "Bilder erzeugen"; }
  if (cnt) cnt.disabled = false;
}

async function pollRun() {
  if (!state.runJobId) return;
  let job;
  try { job = await post("/admin/aprompt/status", { jobId: state.runJobId }); }
  catch (e) {
    runFertig();
    const note = $("ap-run-note"); if (note) note.textContent = "";
    showError("Abfrage fehlgeschlagen: " + (e && e.message ? e.message : e));
    return;
  }
  if (job.status === "pending") { state.runTimer = setTimeout(pollRun, 2000); return; }

  runFertig();
  const note = $("ap-run-note");
  if (job.status === "error") {
    if (note) note.textContent = "";
    showError("Lauf konnte nicht gestartet werden: " + (job.error || "Unbekannter Fehler"));
    return;
  }
  if (note) {
    const wort = job.anzahl === 1 ? "Variante" : "Varianten";
    const zuviel = job.verworfen ? " (" + job.verworfen + " ueberzaehlige verworfen)" : "";
    note.innerHTML = "Lauf " + esc(job.runId) + " gestartet \u2014 " + esc(String(job.anzahl)) + " " + wort + zuviel
      + ", " + esc(job.model) + ", " + esc(job.size)
      + '. Die Bilder erscheinen unter <a href="#afruns" id="ap-to-runs">Letzte L\u00e4ufe</a>.';
    const l = $("ap-to-runs");
    if (l) l.addEventListener("click", (e) => {
      e.preventDefault();
      const t = document.querySelector('.studio-tab[data-tab="afruns"]');
      if (t) t.click();
    });
  }
}

async function startImages() {
  const ta = $("ap-text");
  if (state.starting || !ta || !ta.value.trim()) return;
  clearError();
  const cnt = $("ap-count");
  let anzahl = parseInt(cnt && cnt.value, 10);
  if (!Number.isFinite(anzahl)) anzahl = 3;
  anzahl = Math.max(1, Math.min(10, anzahl));
  if (cnt) cnt.value = String(anzahl);

  const btn = $("ap-run"), note = $("ap-run-note");
  state.starting = true;
  state.runStartedAt = Date.now();
  if (btn) { btn.disabled = true; btn.textContent = "Startet\u2026"; }
  if (cnt) cnt.disabled = true;
  if (note) note.textContent = anzahl > 1 ? "Varianten werden erzeugt \u2014 das dauert bei h\u00f6herer Anzahl mehrere Minuten." : "";
  if (anzahl > 1) {
    state.runTicker = setInterval(() => {
      const sek = Math.round((Date.now() - state.runStartedAt) / 1000);
      if (note) note.textContent = "Varianten werden erzeugt, seit " + sek + " s \u2014 das dauert bei h\u00f6herer Anzahl mehrere Minuten.";
    }, 1000);
  }
  try {
    const r = await post("/admin/aprompt/autoflow", { prompt: ta.value, anzahl });
    if (!r || !r.jobId) throw new Error("Server lieferte keine Lauf-Kennung");
    state.runJobId = r.jobId;
    state.runTimer = setTimeout(pollRun, 2000);
  } catch (e) {
    runFertig();
    if (note) note.textContent = "";
    showError("Lauf konnte nicht gestartet werden: " + (e && e.message ? e.message : e));
  }
}

async function copyOut() {
  const ta = $("ap-text"), btn = $("ap-copy");
  if (!ta || !ta.value) return;
  const quittung = (t) => { if (btn) { btn.textContent = t; setTimeout(() => { if (btn) btn.textContent = "Kopieren"; }, 1800); } };
  try {
    await navigator.clipboard.writeText(ta.value);
    return quittung("Kopiert");
  } catch (_) { /* kein Zwischenablage-Recht -> zweiter Weg */ }
  // Zweiter Weg: der alte execCommand-Pfad braucht keine Berechtigung und
  // kopiert in aelteren/strengeren Umgebungen trotzdem wirklich.
  ta.removeAttribute("readonly");
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let kopiert = false;
  try { kopiert = document.execCommand("copy"); } catch (_) { kopiert = false; }
  ta.setAttribute("readonly", "readonly");
  // Dritter Weg: wenigstens markiert lassen, damit Strg/Cmd+C sofort greift.
  quittung(kopiert ? "Kopiert" : "Markiert — Strg/Cmd+C");
}

function wire() {
  const drop = $("ap-drop"), file = $("ap-file");
  wireDropzone(drop, pickFile);
  if (drop && file) {
    drop.addEventListener("click", () => file.click());
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
  }
  if (file) file.addEventListener("change", () => pickFile(file.files && file.files[0]));
  const clear = $("ap-clear"); if (clear) clear.addEventListener("click", clearImage);
  const go = $("ap-go"); if (go) go.addEventListener("click", start);
  const sug = $("ap-suggest"); if (sug) sug.addEventListener("click", suggestGenreVibe);
  const copy = $("ap-copy"); if (copy) copy.addEventListener("click", copyOut);
  const run = $("ap-run"); if (run) run.addEventListener("click", startImages);
  const only = $("ap-only"); if (only) only.addEventListener("click", startOnlyPrompts);
  // Ein Zuhoerer fuer alle Kopieren-Knoepfe der Liste (die Liste wird neu gezeichnet).
  const liste = $("ap-list");
  if (liste) liste.addEventListener("click", (e) => {
    const k = e.target.closest(".afr-prompt-copy");
    if (!k) return;
    e.preventDefault(); e.stopPropagation();
    kopiereEintrag(Number(k.dataset.i));
  });
}

export async function initAnalysisPrompt() {
  const tabBtn = document.querySelector('.studio-tab[data-tab="aprompt"]');
  const p = panel(); if (!p) return;
  let info;
  try { info = await probe(); }
  catch (e) {
    if (e.status === 404) return;              // Werkzeug aus -> Reiter verborgen lassen
    if (tabBtn) tabBtn.hidden = false;
    p.innerHTML = '<p class="ap-error-static">Analyse-Prompt konnte nicht geladen werden: ' + esc(e.message) + "</p>";
    return;
  }
  if (tabBtn) tabBtn.hidden = false;           // Werkzeug an -> Reiter zeigen
  p.innerHTML = shell(info);
  wire();
}
