// Prompt-Generator (Beta): Referenzflyer hochladen, optional Genre/Kontext angeben,
// zwei getrennte Sonnet-Aufrufe fahren, Masteranalyse und Produktionsprompt anzeigen.
//
// ZWEI Aufrufe, zwei HTTP-Requests — bewusst: das hält jeden Request kurz genug für den
// 120-s-Timeout des Servers, zeigt sichtbar, welcher Call gerade läuft, und macht das
// Abschnitts-Gate zu einem natürlichen Halt zwischen den beiden Schritten.
//
// Nichts wird gespeichert: kein R2, keine Datenbank, kein Bestandseintrag. Nach dem
// Neuladen der Seite ist alles weg — für den Testbetrieb ist das so gewollt.

import { getToken } from "./studioApi.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Zustand nur im Speicher — bewusst nicht persistiert.
const state = { imageDataUrl: "", fileName: "", analysis: "", prompt: "", busy: false };

async function api(path, bodyObj, method) {
  const res = await fetch(path, {
    method: method || "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": getToken() },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { http: res.status, data };
}

function render() {
  const p = $("panel-promptgen");
  if (!p) return;
  p.innerHTML = [
    '<div class="pg-wrap">',
    '  <h2 class="pg-h">Prompt-Generator <span class="pg-beta">Beta</span></h2>',
    '  <p class="pg-sub">Referenzflyer hochladen → Masteranalyse → Produktionsprompt. Zwei getrennte Modell-Aufrufe. Nichts wird gespeichert; nach dem Neuladen ist alles weg.</p>',
    '  <div class="pg-form">',
    '    <label class="pg-label">Referenzflyer</label>',
    '    <input type="file" id="pgFile" accept="image/png,image/jpeg,image/webp">',
    '    <div class="pg-thumb" id="pgThumb" hidden></div>',
    '    <label class="pg-label" for="pgContext">Genre / Kontext <span class="pg-opt">optional</span></label>',
    '    <textarea id="pgContext" rows="3" placeholder="z. B. Hip Hop, 90er Boombox-Kultur, Berliner Kellerclub. Leer lassen = das Modell leitet Genre und kulturelle Identität allein aus dem Bild ab."></textarea>',
    '    <div class="pg-row">',
    '      <button class="rbtn rbtn-primary" id="pgStart" type="button" disabled>Analyse starten</button>',
    '      <span class="pg-cost">≈ 0,12 $ pro Durchlauf (Analyse + Konvertierung)</span>',
    '    </div>',
    '    <div class="pg-status" id="pgStatus"></div>',
    '  </div>',
    '  <div id="pgOut"></div>',
    "</div>",
  ].join("");
  wire();
}

function setStatus(html, kind) {
  const el = $("pgStatus");
  if (el) el.innerHTML = html ? '<div class="pg-state' + (kind ? " is-" + kind : "") + '">' + html + "</div>" : "";
}

function setBusy(on) {
  state.busy = on;
  const b = $("pgStart");
  if (b) { b.disabled = on || !state.imageDataUrl; b.textContent = on ? "läuft …" : "Analyse starten"; }
  const f = $("pgFile"); if (f) f.disabled = on;
}

function wire() {
  const file = $("pgFile");
  if (file) file.addEventListener("change", () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setStatus("Bild ist größer als 10 MB — bitte kleiner speichern.", "err"); return; }
    const r = new FileReader();
    r.onload = () => {
      state.imageDataUrl = String(r.result || "");
      state.fileName = f.name;
      const t = $("pgThumb");
      if (t) { t.hidden = false; t.innerHTML = '<img src="' + esc(state.imageDataUrl) + '" alt=""><span>' + esc(f.name) + "</span>"; }
      setStatus("");
      setBusy(false);
    };
    r.readAsDataURL(f);
  });
  const start = $("pgStart");
  if (start) start.addEventListener("click", () => runAnalysis());
  const out = $("pgOut");
  if (out) out.addEventListener("click", (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) { copy(c.dataset.copy, c); return; }
    if (e.target.closest("#pgRetry")) { runAnalysis(); return; }
    if (e.target.closest("#pgConvert")) { runConversion(); return; }
  });
}

async function copy(which, btn) {
  const text = which === "analysis" ? state.analysis : state.prompt;
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = "✓ kopiert";
    setTimeout(() => { btn.textContent = old; }, 1400);
  } catch (_) {
    btn.textContent = "Kopieren nicht erlaubt";
  }
}

// ── Call 1 ──
async function runAnalysis() {
  if (state.busy || !state.imageDataUrl) return;
  state.analysis = ""; state.prompt = "";
  const out = $("pgOut"); if (out) out.innerHTML = "";
  setBusy(true);
  setStatus("<b>Schritt 1 von 2:</b> Masteranalyse läuft … (das dauert etwa eine Minute)", "run");

  let r;
  try { r = await api("/admin/promptgen/analyze", { image: state.imageDataUrl, context: ($("pgContext") || {}).value || "" }); }
  catch (_) { setBusy(false); setStatus("Analyse fehlgeschlagen: keine Verbindung.", "err"); return; }

  if (r.http === 401) { setBusy(false); setStatus("Sitzung abgelaufen — bitte neu entsperren.", "err"); return; }
  if (r.http !== 200 || !r.data) {
    setBusy(false);
    setStatus("Analyse fehlgeschlagen: " + esc((r.data && r.data.error) || ("HTTP " + r.http)), "err");
    return;
  }

  state.analysis = r.data.analysis || "";
  renderAnalysis(r.data);

  // Bauteil 4: unvollständig -> Call 2 gar nicht erst starten.
  if (!r.data.ok || r.data.missing.length) {
    setBusy(false);
    setStatus("<b>Analyse unvollständig.</b> " + r.data.found + " von " + r.data.total +
      " Abschnitten gefunden — der Produktionsprompt wurde nicht gestartet.", "warn");
    return;
  }
  runConversion();
}

// ── Call 2 ──
async function runConversion() {
  if (!state.analysis) return;
  setBusy(true);
  setStatus("<b>Schritt 2 von 2:</b> Produktionsprompt läuft …", "run");

  let r;
  try { r = await api("/admin/promptgen/convert", { analysis: state.analysis }); }
  catch (_) { setBusy(false); setStatus("Konvertierung fehlgeschlagen: keine Verbindung.", "err"); return; }

  setBusy(false);
  if (r.http !== 200 || !r.data) {
    setStatus("Konvertierung fehlgeschlagen: " + esc((r.data && r.data.error) || ("HTTP " + r.http)), "err");
    return;
  }
  state.prompt = r.data.prompt || "";
  setStatus("Fertig. Beide Ergebnisse stehen unten.", "ok");
  renderAll(r.data.truncated);
}

function analysisCardHtml(meta) {
  const fehlt = meta && meta.missing && meta.missing.length
    ? '<div class="pg-missing"><b>Fehlende Abschnitte:</b> ' + meta.missing.map(esc).join(", ") +
      '<div class="pg-missing-act"><button class="rbtn rbtn-ghost" id="pgRetry" type="button">Analyse wiederholen</button>' +
      (meta.truncated ? '<span class="pg-note">Die Antwort war am Token-Limit abgeschnitten.</span>' : "") + "</div></div>"
    : "";
  return '<div class="pg-card">' +
    '<div class="pg-card-h">Masteranalyse' +
      (meta ? '<span class="pg-badge' + (meta.ok ? " is-ok" : " is-warn") + '">' + meta.found + "/" + meta.total + " Abschnitte</span>" : "") +
      (meta && !meta.hasContext ? '<span class="pg-badge">ohne Kontext</span>' : "") +
      '<button class="rbtn rbtn-ghost" data-copy="analysis" type="button">Kopieren</button></div>' +
    fehlt +
    "<pre>" + esc(state.analysis) + "</pre></div>";
}

function renderAnalysis(meta) {
  const out = $("pgOut"); if (!out) return;
  out.innerHTML = analysisCardHtml(meta);
}

function renderAll(truncated) {
  const out = $("pgOut"); if (!out) return;
  // Der Produktionsprompt ist das eigentliche Ergebnis und steht darum oben und hervorgehoben.
  out.innerHTML =
    '<div class="pg-card is-result">' +
      '<div class="pg-card-h">Produktionsprompt' +
        (truncated ? '<span class="pg-badge is-warn">am Token-Limit abgeschnitten</span>' : "") +
        '<button class="rbtn rbtn-primary" data-copy="prompt" type="button">Kopieren</button></div>' +
      "<pre>" + esc(state.prompt) + "</pre></div>" +
    analysisCardHtml(null);
}

export function initPromptgen() {
  // Gleiches Muster wie manage-panel.js: Werkzeug selbst anfragen, Reiter nur zeigen,
  // wenn es wirklich verfuegbar ist (ADMIN_TOOLS an).
  fetch("/admin/promptgen/status", { headers: { "X-Admin-Token": getToken() } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || !d.ok) return;
      const tab = document.querySelector('.studio-tab[data-tab="promptgen"]');
      if (tab) tab.hidden = false;
      render();
      if (!d.ready) setStatus("ANTHROPIC_API_KEY ist auf dem Server nicht gesetzt — Läufe schlagen fehl.", "err");
    })
    .catch(() => {});
}
