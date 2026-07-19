// Clean-Flow (BETA) — eigenstaendiger Reiter. Ein Referenz-Flyer -> Nachbau (fester Prompt) oder
// N Varianten (Farb-Kollektion, Sonnet-Schritt). Nutzt den SERVER-Lauf (/admin/autoflow/start
// mit cleanFlow:true), denselben editImage-Weg + dieselbe Ablage wie die anderen Flows; Ergebnis
// in "Letzte Laeufe". Beruehrt keine bestehende Flow-Logik. Diese Datei ist reine Oberflaeche.

import { getToken } from "./studioApi.js";
import { fileToDataUrl, wireDropzone, wirePaste, notify } from "./studioUi.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let file = null;        // { name, dataUrl }
let running = false;
let mode = "nachbau";   // "nachbau" | "varianten"
let subject = true;     // Varianten: true = Mit Hauptmotiv (Default), false = Ohne Hauptmotiv
let lastPrompts = [];   // zuletzt angezeigte Vorschau-Prompts
const copied = new Set(); // Indizes der bereits kopierten Karten (persistent bis neue Vorschau)

function setStatus(t) { const el = $("clStatus"); if (el) el.textContent = t || ""; }

// Anzahl Varianten vom Slider (1-10).
function variantCount() {
  const el = $("clCount");
  return Math.max(1, Math.min(10, parseInt(el && el.value, 10) || 5));
}

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

// ── Modus-Umschalter: Slider + Hauptmotiv-Wahl nur bei Varianten, Startknopf folgt dem Modus ──
function setMode(m) {
  mode = m === "varianten" ? "varianten" : "nachbau";
  const nb = $("clModeNachbau"), va = $("clModeVarianten"), opt = $("clVarOpt"), sopt = $("clSubjOpt");
  if (nb) { nb.classList.toggle("is-on", mode === "nachbau"); nb.setAttribute("aria-selected", mode === "nachbau"); }
  if (va) { va.classList.toggle("is-on", mode === "varianten"); va.setAttribute("aria-selected", mode === "varianten"); }
  if (opt) opt.hidden = mode !== "varianten";
  if (sopt) sopt.hidden = mode !== "varianten";
  syncStartLabel();
}

// Hauptmotiv-Umschalter (nur Varianten): true = Mit, false = Ohne.
function setSubject(hasSubject) {
  subject = !!hasSubject;
  const mit = $("clSubjMit"), ohne = $("clSubjOhne");
  if (mit) { mit.classList.toggle("is-on", subject); mit.setAttribute("aria-selected", subject); }
  if (ohne) { ohne.classList.toggle("is-on", !subject); ohne.setAttribute("aria-selected", !subject); }
}

function syncStartLabel() {
  const b = $("clStart");
  if (b) b.textContent = mode === "varianten" ? ("▶ " + variantCount() + " Varianten erzeugen") : "▶ Nachbau erzeugen";
  const val = $("clCountVal"); if (val) val.textContent = String(variantCount());
}

// ── Start: Nachbau -> variants 0, Varianten -> Slider-Anzahl. Beides cleanFlow:true. ──
async function start() {
  if (running) return;
  if (!file) return notify("Erst einen Flyer hochladen", "info");
  const variants = mode === "varianten" ? variantCount() : 0;
  const btns = [$("clStart"), $("clPreviewBtn")];
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
        subject, // Varianten: Mit/Ohne Hauptmotiv (beim Nachbau ohne Wirkung)
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

// ── Prompt-Vorschau: laeuft bis zum fertigen Bildprompt und stoppt (kein editImage, keine
//    Bildkosten). Gilt fuer den gewaehlten Modus. ──
async function preview() {
  if (running) return;
  if (!file) return notify("Erst einen Flyer hochladen", "info");
  const variants = mode === "varianten" ? variantCount() : 0;
  const box = $("clPreview"); if (box) { box.hidden = false; box.innerHTML = '<div class="afr-empty">Baue Prompts …</div>'; }
  const btn = $("clPreviewBtn"); if (btn) btn.disabled = true;
  setStatus("Vorschau …");
  try {
    const res = await fetch("/admin/clean/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": getToken() },
      body: JSON.stringify({ variants, subject, dataUrl: file.dataUrl }),
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

function cardTitle(p, i) {
  return (lastPrompts.length === 1 && p.label === "Nachbau") ? "Nachbau" : ("Variante " + (i + 1));
}

// Karten-Anzeige: pro Variante Nummer + Label, die color_world hervorgehoben als Kopfzeile, der
// volle Prompt in Monospace scrollbar, Kopieren je Karte. Kopier-Status wird bei jeder neuen
// Vorschau zurueckgesetzt.
function renderPreview(prompts) {
  const box = $("clPreview"); if (!box) return;
  lastPrompts = prompts || [];
  copied.clear();
  if (!lastPrompts.length) { box.innerHTML = '<div class="afr-empty">Keine Prompts.</div>'; return; }
  const head = '<div class="cl-preview-head">' +
    '<span class="cl-preview-title">Prompt-Vorschau (kein Bild erzeugt)</span>' +
    '<span class="cl-count" id="clCopyCount"></span>' +
    (lastPrompts.length > 1 ? '<button class="rbtn rbtn-ghost cl-copyall" id="clCopyAll" type="button">Alle kopieren</button>' : "") +
    "</div>";
  const cards = lastPrompts.map((p, i) => {
    const cw = (p.label && p.label !== "Nachbau") ? '<div class="cl-cw">' + esc(p.label) + "</div>" : "";
    return '<div class="cl-card" data-i="' + i + '">' +
      '<div class="cl-card-top">' +
        '<span class="cl-card-num">' + esc(cardTitle(p, i)) + "</span>" +
        '<span class="cl-card-n">' + (p.prompt || "").length + " Zeichen</span>" +
        '<button class="rbtn rbtn-ghost cl-card-copy" type="button" data-i="' + i + '">Kopieren</button>' +
      "</div>" + cw +
      '<pre class="cl-card-pre" data-i="' + i + '">' + esc(p.prompt || "") + "</pre>" +
    "</div>";
  }).join("");
  box.innerHTML = head + cards;
  box.querySelectorAll(".cl-card-copy").forEach((b) => b.addEventListener("click", () => copyOne(Number(b.dataset.i))));
  const all = $("clCopyAll"); if (all) all.addEventListener("click", copyAll);
  updateCounter();
}

function writeClip(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error("no clipboard"));
}

function markCopied(i) {
  copied.add(i);
  const card = document.querySelector('.cl-card[data-i="' + i + '"]');
  if (card) {
    card.classList.add("is-copied");
    const b = card.querySelector(".cl-card-copy");
    if (b) { b.textContent = "✓ Kopiert"; b.classList.add("is-copied"); }
  }
  updateCounter();
}

function updateCounter() {
  const el = $("clCopyCount"); if (!el) return;
  const total = lastPrompts.length, n = copied.size;
  el.textContent = n + " von " + total + " kopiert";
  el.classList.toggle("is-all", n > 0 && n === total);
}

function copyOne(i) {
  const p = lastPrompts[i]; if (!p) return;
  writeClip(p.prompt || "").then(() => { markCopied(i); notify("Prompt kopiert", "success"); })
    .catch(() => notify("Kopieren nicht möglich", "error"));
}

// Alle Prompts nacheinander nummeriert in die Zwischenablage.
function copyAll() {
  if (!lastPrompts.length) return;
  const text = lastPrompts.map((p, i) =>
    "=== " + cardTitle(p, i) + (p.label && p.label !== "Nachbau" ? " · " + p.label : "") + " ===\n" + (p.prompt || "")
  ).join("\n\n\n");
  writeClip(text).then(() => {
    lastPrompts.forEach((_, i) => markCopied(i));
    notify(lastPrompts.length + " Prompts kopiert", "success");
  }).catch(() => notify("Kopieren nicht möglich", "error"));
}

export function initCleanflow() {
  const f = $("clFile");
  if (f) f.addEventListener("change", () => { if (f.files[0]) onFile(f.files[0]); f.value = ""; });
  wireDropzone($("clDrop"), onFile);
  wirePaste($("panel-clean"), onFile);
  if ($("clModeNachbau")) $("clModeNachbau").addEventListener("click", () => setMode("nachbau"));
  if ($("clModeVarianten")) $("clModeVarianten").addEventListener("click", () => setMode("varianten"));
  if ($("clSubjMit")) $("clSubjMit").addEventListener("click", () => setSubject(true));
  if ($("clSubjOhne")) $("clSubjOhne").addEventListener("click", () => setSubject(false));
  const slider = $("clCount");
  if (slider) slider.addEventListener("input", syncStartLabel);
  if ($("clStart")) $("clStart").addEventListener("click", start);
  if ($("clPreviewBtn")) $("clPreviewBtn").addEventListener("click", preview);
  setMode("nachbau");
}
