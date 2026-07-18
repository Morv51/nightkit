// Clean-Flow (BETA) — eigenstaendiger Reiter. Ein Referenz-Flyer -> ein Template-Nachbau ueber
// einen KURZEN, festen Prompt (server-seitig in lib/studio/cleanFlow.js). Keine Textzonen, keine
// Rollen, kein Regelwerk. Nutzt den SERVER-Lauf (/admin/autoflow/start mit cleanFlow:true) und
// damit denselben editImage-Weg + dieselbe Ablage wie die anderen Flows; Ergebnis in "Letzte
// Laeufe". Beruehrt keine bestehende Flow-Logik.

import { getToken } from "./studioApi.js";
import { fileToDataUrl, wireDropzone, wirePaste, notify } from "./studioUi.js";

const $ = (id) => document.getElementById(id);

let file = null;   // { name, dataUrl }
let running = false;

function setStatus(t) { const el = $("clStatus"); if (el) el.textContent = t || ""; }

function renderThumb() {
  const row = $("clThumbs");
  if (!row) return;
  row.innerHTML = "";
  if (file) {
    const t = document.createElement("div"); t.className = "batch-thumb";
    const img = document.createElement("img"); img.src = file.dataUrl; img.alt = "";
    const x = document.createElement("button");
    x.type = "button"; x.className = "batch-thumb-x"; x.textContent = "✕"; x.title = "Entfernen";
    x.addEventListener("click", () => { if (!running) { file = null; renderThumb(); } });
    t.appendChild(img); t.appendChild(x); row.appendChild(t);
  }
  row.hidden = !file;
  const label = $("clDropLabel");
  if (label && file) label.textContent = file.name;
}

async function onFile(f) {
  try { file = { name: f.name || "flyer", dataUrl: await fileToDataUrl(f) }; renderThumb(); }
  catch (e) { notify((e && e.message) || "Bild nicht lesbar", "error"); }
}

// Anzahl Varianten vom Slider (1-10).
function variantCount() {
  const el = $("clCount");
  return Math.max(1, Math.min(10, parseInt(el && el.value, 10) || 5));
}

// Server-getriebener Start. variants=0 -> Nachbau (fester Prompt). variants>0 -> Design-Familie
// (ein Sonnet-Aufruf + N editImage-Laeufe). Beides cleanFlow:true, editImage-Weg, keine Regeln.
async function start(variants) {
  if (running) return;
  if (!file) return notify("Erst einen Flyer hochladen", "info");
  const btns = [$("clStart"), $("clVariants")];
  btns.forEach((b) => { if (b) b.disabled = true; });
  running = true; setStatus("Starte …");
  try {
    const res = await fetch("/admin/autoflow/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": getToken() },
      body: JSON.stringify({
        flow: "clean", cleanFlow: true,
        mode: variants > 0 ? variants + " Varianten" : "Nachbau",
        loose: false, textOnly: false, regelwerk: false, variants, refType: "single",
        files: [{ name: file.name, dataUrl: file.dataUrl }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status !== 200 || !data.runId) throw new Error(data.error || ("HTTP " + res.status));
    setStatus("Gestartet.");
    notify("Clean-Flow gestartet. Du kannst den Tab schließen. Fortschritt siehe Reiter Letzte Läufe.", "success");
    const tab = document.querySelector('.studio-tab[data-tab="afruns"]');
    if (tab) tab.click();
  } catch (e) {
    setStatus("");
    notify("Start fehlgeschlagen: " + (e.message || e), "error");
  } finally {
    running = false;
    btns.forEach((b) => { if (b) b.disabled = false; });
  }
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Prompt-Vorschau: laeuft bis zum fertigen Bildprompt und stoppt (kein editImage, keine
// Bildkosten). Zeigt die N Varianten-Prompts im Volltext mit Kopieren-Knopf. Sonnet laeuft nur
// bei Varianten (Slider-Anzahl); ein leerer Lauf waere nur der Nachbau-Prompt.
async function preview() {
  if (running) return;
  if (!file) return notify("Erst einen Flyer hochladen", "info");
  const n = variantCount();
  const box = $("clPreview"); if (box) { box.hidden = false; box.innerHTML = '<div class="afr-empty">Baue Prompts …</div>'; }
  const btn = $("clPreviewBtn"); if (btn) btn.disabled = true;
  setStatus("Vorschau …");
  try {
    const res = await fetch("/admin/clean/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": getToken() },
      body: JSON.stringify({ variants: n, dataUrl: file.dataUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status !== 200 || !data.ok) throw new Error(data.error || ("HTTP " + res.status));
    renderPreview(data.prompts || []);
    setStatus("Vorschau bereit.");
  } catch (e) {
    if (box) box.innerHTML = '<div class="afr-empty">Vorschau fehlgeschlagen: ' + esc(e.message || e) + "</div>";
    setStatus("");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderPreview(prompts) {
  const box = $("clPreview"); if (!box) return;
  if (!prompts.length) { box.innerHTML = '<div class="afr-empty">Keine Prompts.</div>'; return; }
  box.innerHTML = '<div class="afr-prompt-h">Prompt-Vorschau · ' + prompts.length + (prompts.length === 1 ? " Prompt" : " Prompts") + " (kein Bild erzeugt)</div>" +
    prompts.map((p, i) => {
      const title = (prompts.length === 1 && p.label === "Nachbau") ? "Nachbau" : ("Variante " + (i + 1) + (p.label ? " · " + p.label : ""));
      return '<details class="afr-prompt-det"' + (i === 0 ? " open" : "") + '><summary>' + esc(title) +
        ' <span class="afr-prompt-n">' + (p.prompt || "").length + " Zeichen</span>" +
        '<button class="rbtn rbtn-ghost cl-copy" type="button" data-i="' + i + '">Kopieren</button></summary>' +
        '<pre class="afr-prompt-pre" data-i="' + i + '">' + esc(p.prompt || "") + "</pre></details>";
    }).join("");
  box.querySelectorAll(".cl-copy").forEach((btn) => btn.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    const pre = box.querySelector('.afr-prompt-pre[data-i="' + btn.dataset.i + '"]');
    const text = pre ? pre.textContent : "";
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => notify("Prompt kopiert", "success")).catch(() => notify("Kopieren nicht möglich", "error"));
    else notify("Kopieren nicht möglich", "error");
  }));
}

export function initCleanflow() {
  const f = $("clFile");
  if (f) f.addEventListener("change", () => { if (f.files[0]) onFile(f.files[0]); f.value = ""; });
  wireDropzone($("clDrop"), onFile);
  wirePaste($("panel-clean"), onFile);
  const slider = $("clCount"), val = $("clCountVal");
  if (slider && val) { const sync = () => { val.textContent = slider.value; }; slider.addEventListener("input", sync); sync(); }
  if ($("clStart")) $("clStart").addEventListener("click", () => start(0));
  if ($("clVariants")) $("clVariants").addEventListener("click", () => start(variantCount()));
  if ($("clPreviewBtn")) $("clPreviewBtn").addEventListener("click", preview);
}
