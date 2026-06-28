// Modus 2: Moodboard → Generieren.
// Upload Moodboard → Vision-Analyse extrahiert NUR die Stil-DNA (Look, nicht
// Inhalt) → editierbarer Generierungs-Prompt → REINE Text-zu-Bild-Generierung
// (GPT Image 2 oder Ideogram, KEIN Edit/keine Maske; das Moodboard wird NICHT als
// Bild durchgereicht). Ergebnis = ein NEUER Flyer im Stil, keine Reproduktion.

import { post } from "./studioApi.js";
import { fileToDataUrl, downloadDataUrl, toJpeg, notify, wireDropzone, wirePaste } from "./studioUi.js";
import { createBrushTool, correctImage, saveTemplate } from "./studioBrush.js";
import { createCompare } from "./studioCompare.js";

const $ = (id) => document.getElementById(id);
let compare; // Vorher/Nachher: Moodboard ⇄ Ergebnis (in initMode2 erzeugt)

const state = { moodboard: null, dna: null, result: null };

function setBusy(on, msg) {
  $("m2Busy").hidden = !on;
  if (msg) $("m2BusyMsg").textContent = msg;
}

function showResult(dataUrl) {
  state.result = dataUrl;
  const img = $("m2Result");
  img.src = dataUrl;
  img.hidden = false;
  $("m2Empty").hidden = true;
  $("m2Actions").hidden = false;
  if (compare) compare.reset();
}

async function onFile(file) {
  try {
    const dataUrl = await fileToDataUrl(file);
    state.moodboard = dataUrl;
    const t = $("m2Thumb");
    t.src = dataUrl;
    t.hidden = false;
    $("m2DropLabel").textContent = file.name;
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
    // NUR Stil-DNA (Look) — das Moodboard-Bild dient hier reiner Vision-Analyse,
    // nicht als zu generierendes Bild.
    const { dna, prompt } = await post("/admin/analyze", {
      mode: "moodboard",
      image: state.moodboard,
      model: $("m2Model").value,
    });
    state.dna = dna;
    $("m2Prompt").value = prompt;
    $("m2Rebuild").hidden = false;
    notify("Analyse fertig — Prompt bereit zum Feinschliff", "success");
  } catch (e) {
    notify(e.message, "error");
  } finally {
    btn.disabled = false;
    setBusy(false);
  }
}

async function rebuildPrompt() {
  if (!state.dna) return;
  try {
    const { prompt } = await post("/admin/build-prompt", { dna: state.dna });
    $("m2Prompt").value = prompt;
    notify("Prompt aus Stil-DNA neu gebaut", "success");
  } catch (e) {
    notify(e.message, "error");
  }
}

// ── Generierung mit Abbruch + Client-Timeout (kein ewiges Laden) ────────────
let genAbort = null;
let genTimedOut = false;

function engineLabel() {
  return (($("m2Engine") && $("m2Engine").value) === "ideogram") ? "Ideogram" : "GPT Image 2";
}

function setGenerating(on) {
  setBusy(on, on ? `Generiere Flyer mit ${engineLabel()} …` : "");
  $("m2Generate").disabled = on;
  $("m2Cancel").hidden = !on;
}

function cancelGenerate() {
  if (genAbort) genAbort.abort();
}

async function generate() {
  const prompt = $("m2Prompt").value.trim();
  if (!prompt) return notify("Prompt ist leer — erst analysieren", "error");
  const engine = (($("m2Engine") && $("m2Engine").value) === "ideogram") ? "ideogram" : "openai";
  if (compare) compare.reset();

  genAbort = new AbortController();
  genTimedOut = false;
  // Client-Sicherheitsnetz etwas über dem Server-Timeout (90 s) → nie ewiges Laden.
  const timer = setTimeout(() => { genTimedOut = true; genAbort.abort(); }, 95000);
  setGenerating(true);
  try {
    // KEIN Moodboard-Bild mitsenden — reine Text-zu-Bild-Generierung.
    const { image } = await post("/admin/generate", { prompt, engine }, { signal: genAbort.signal });
    showResult(image);
    $("m2Compare").hidden = false; // Moodboard ⇄ Ergebnis vergleichbar
    notify(`Flyer generiert (${engineLabel()})`, "success");
  } catch (e) {
    if (genAbort && genAbort.signal.aborted) {
      notify(genTimedOut
        ? "Zeitüberschreitung — nach 95 s abgebrochen. Bitte erneut versuchen."
        : "Generierung abgebrochen", "info");
    } else {
      // e.message trägt die Klartext-Server-/OpenAI-Meldung ("Generierung fehlgeschlagen: …").
      notify(e.message, "error");
    }
  } finally {
    clearTimeout(timer);
    genAbort = null;
    genTimedOut = false;
    setGenerating(false);
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
  $("m2Generate").addEventListener("click", generate);
  $("m2Cancel").addEventListener("click", cancelGenerate);

  // Vorher/Nachher: Moodboard ⇄ generiertes Ergebnis.
  compare = createCompare({
    resultImg: $("m2Result"),
    getBefore: () => state.moodboard,
    getAfter: () => state.result,
    button: $("m2Compare"),
  });
  $("m2Compare").addEventListener("click", () => compare.toggle());

  // Bereinigen (LaMa-Brush) + Korrigieren (re-edit) auf dem generierten Ergebnis.
  const brush = createBrushTool({
    stage: $("m2Stage"), img: $("m2Result"),
    getImage: () => state.result, setImage: showResult, setBusy,
  });
  $("m2Clean").addEventListener("click", () => brush.open());
  $("m2Correct").addEventListener("click", () =>
    correctImage({ getImage: () => state.result, setImage: showResult, setBusy }));
  $("m2Save").addEventListener("click", () =>
    saveTemplate({
      getImage: () => state.result, mode: "moodboard",
      getMeta: () => ({ prompt: $("m2Prompt").value, dna: state.dna }),
    }));

  $("m2ExportPng").addEventListener("click", () => {
    if (state.result) downloadDataUrl(state.result, "nightkit-studio.png");
  });
  $("m2ExportJpg").addEventListener("click", async () => {
    if (!state.result) return;
    try { downloadDataUrl(await toJpeg(state.result), "nightkit-studio.jpg"); }
    catch (e) { notify(e.message, "error"); }
  });
}

// Für andere Module erreichbar.
export function getResult() { return state.result; }
export function setResult(dataUrl) { showResult(dataUrl); }
