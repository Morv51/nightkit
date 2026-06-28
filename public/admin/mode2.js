// Modus 2: Moodboard → PROMPT. Reiner PROMPT-GENERATOR (wie Modus 1, KEINE
// Bildgenerierung mehr). Upload Moodboard → Vision abstrahiert NUR die Stil-
// Sprache (Look, keine Collage-Struktur) → fertiger Club-Event-Flyer-Prompt zum
// Kopieren und manuellen Einfügen in ChatGPT.

import { post } from "./studioApi.js";
import { fileToDataUrl, notify, wireDropzone, wirePaste } from "./studioUi.js";

const $ = (id) => document.getElementById(id);

const state = { moodboard: null, dna: null };

function setBusy(on, msg) {
  $("m2Busy").hidden = !on;
  if (msg) $("m2BusyMsg").textContent = msg;
}

// Hochgeladenes Moodboard als Vorschau-Thumbnail zeigen + als Vision-Eingabe merken.
function showThumb(dataUrl) {
  state.moodboard = dataUrl;
  const t = $("m2Thumb");
  t.src = dataUrl;
  t.hidden = false;
}

async function onFile(file) {
  try {
    const dataUrl = await fileToDataUrl(file);
    $("m2DropLabel").textContent = file.name;
    showThumb(dataUrl);
    notify("Moodboard geladen — jetzt analysieren", "success");
  } catch (e) {
    notify(e.message, "error");
  }
}

async function analyze() {
  if (!state.moodboard) return notify("Erst ein Moodboard hochladen", "error");
  const btn = $("m2Analyze");
  btn.disabled = true;
  setBusy(true, "Analysiere Stil-DNA …");
  try {
    // NUR Stil-DNA (Look, keine Collage-Struktur). Das Moodboard ist reine
    // Vision-Eingabe — es wird NICHT generiert.
    const { dna, prompt } = await post("/admin/analyze", {
      mode: "moodboard",
      image: state.moodboard,
      model: $("m2Model").value,
    });
    state.dna = dna;
    $("m2Prompt").value = prompt || "";
    autoGrow();
    $("m2Rebuild").hidden = false;
    notify("Analyse fertig — Prompt bereit zum Kopieren", "success");
  } catch (e) {
    notify(e.message, "error");
  } finally {
    btn.disabled = false;
    setBusy(false);
  }
}

// Prompt aus der vorhandenen Stil-DNA neu bauen (z.B. nach manueller Änderung).
async function rebuildPrompt() {
  if (!state.dna) return notify("Erst ein Moodboard analysieren", "info");
  try {
    const { prompt } = await post("/admin/build-prompt", { dna: state.dna });
    $("m2Prompt").value = prompt;
    autoGrow();
    flashPrompt();
    notify("Prompt aus Stil-DNA neu gebaut", "success");
  } catch (e) {
    notify(e.message, "error");
  }
}

// Kurzes Aufblitzen des Prompt-Feldes, damit die Aktualisierung sichtbar ist.
function flashPrompt() {
  const el = $("m2Prompt");
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth; // Reflow → Animation neu starten
  el.classList.add("flash");
}

// Prompt-Feld auf seinen Inhalt wachsen lassen — ganzer Prompt sichtbar (Seite scrollt).
function autoGrow() {
  const el = $("m2Prompt");
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.max(el.scrollHeight + 2, 320) + "px";
}

// ── Kopieren in die Zwischenablage (identisch zu Modus 1) ───────────────────
const COPY_LABEL = "📋 Prompt kopieren";

function flashCopied() {
  const b = $("m2Copy");
  b.textContent = "✓ Kopiert!";
  b.classList.add("copied");
  setTimeout(() => { b.textContent = COPY_LABEL; b.classList.remove("copied"); }, 1600);
}

function fallbackCopy(done) {
  const ta = $("m2Prompt");
  ta.focus(); ta.select();
  try { document.execCommand("copy"); done(); ta.setSelectionRange(0, 0); }
  catch { notify("Kopieren nicht möglich — bitte Text manuell markieren (Cmd/Ctrl+A, dann Cmd/Ctrl+C)", "error"); }
}

function copyPrompt() {
  const text = $("m2Prompt").value;
  if (!text.trim()) return notify("Noch kein Prompt — erst analysieren", "info");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flashCopied).catch(() => fallbackCopy(flashCopied));
  } else {
    fallbackCopy(flashCopied);
  }
}

export function initMode2() {
  const file = $("m2File");
  $("m2Drop").addEventListener("click", () => file.click());
  file.addEventListener("change", () => file.files[0] && onFile(file.files[0]));
  // Upload ohne Dialog: Drag&Drop + Paste (Klick bleibt Fallback).
  wireDropzone($("m2Drop"), onFile);
  wirePaste($("panel-mode2"), onFile);

  $("m2Analyze").addEventListener("click", analyze);
  $("m2Rebuild").addEventListener("click", rebuildPrompt);
  $("m2Copy").addEventListener("click", copyPrompt);
  // Manuelle Prompt-Änderungen: Höhe mitwachsen lassen.
  $("m2Prompt").addEventListener("input", autoGrow);
}
