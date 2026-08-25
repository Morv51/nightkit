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

const state = { image: null, imageName: "", jobId: null, timer: null, ticker: null, startedAt: 0, running: false, suggesting: false, starting: false };

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
          <span class="ap-run-note" id="ap-run-note"></span>
        </div>
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

// Startet einen Auto-Flow-Lauf mit genau diesem Produktionsprompt: drei Varianten,
// kein Referenzbild, 9:16 nativ. Der Lauf laeuft serverseitig weiter, auch wenn der
// Reiter gewechselt wird — die Ergebnisse liegen danach unter "Letzte Laeufe".
async function startImages() {
  const ta = $("ap-text");
  if (state.starting || !ta || !ta.value.trim()) return;
  clearError();
  const btn = $("ap-run"), note = $("ap-run-note");
  state.starting = true;
  if (btn) { btn.disabled = true; btn.textContent = "Startet\u2026"; }
  if (note) note.innerHTML = "";
  try {
    const r = await post("/admin/aprompt/autoflow", { prompt: ta.value });
    if (note) {
      note.innerHTML = "Lauf " + esc(r.runId) + " gestartet \u2014 " + esc(String(r.anzahl))
        + " Varianten, " + esc(r.model) + ", " + esc(r.size)
        + '. Die Bilder erscheinen unter <a href="#afruns" id="ap-to-runs">Letzte L\u00e4ufe</a>.';
      const l = $("ap-to-runs");
      if (l) l.addEventListener("click", (e) => {
        e.preventDefault();
        const t = document.querySelector('.studio-tab[data-tab="afruns"]');
        if (t) t.click();
      });
    }
  } catch (e) {
    showError("Lauf konnte nicht gestartet werden: " + (e && e.message ? e.message : e));
  } finally {
    state.starting = false;
    if (btn) { btn.disabled = false; btn.textContent = "Bilder erzeugen"; }
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
