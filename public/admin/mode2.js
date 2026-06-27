// Modus 2: Moodboard → Generieren.
// Upload Moodboard → Vision-Analyse (Stil-DNA + Default-Prompt) → editierbarer
// Prompt → Ideogram-V3-Generierung mit Moodboard als Style-Reference.

import { post } from "./studioApi.js";
import { fileToDataUrl, downloadDataUrl, toJpeg, notify } from "./studioUi.js";
import { createBrushTool, correctImage, saveTemplate } from "./studioBrush.js";

const $ = (id) => document.getElementById(id);

const state = { moodboard: null, dna: null, result: null };

function styleLabel(v) {
  if (v < 0.34) return "locker";
  if (v > 0.66) return "eng";
  return "mittel";
}

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
    const { dna, prompt } = await post("/admin/analyze", {
      mode: "moodboard",
      image: state.moodboard,
      model: $("m2Model").value,
      styleAdherence: Number($("m2Style").value),
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
    const { prompt } = await post("/admin/build-prompt", {
      dna: state.dna,
      styleAdherence: Number($("m2Style").value),
    });
    $("m2Prompt").value = prompt;
    notify("Prompt aus DNA neu gebaut", "success");
  } catch (e) {
    notify(e.message, "error");
  }
}

async function generate() {
  const prompt = $("m2Prompt").value.trim();
  if (!prompt) return notify("Prompt ist leer", "error");
  if (!state.moodboard) return notify("Moodboard fehlt (dient als Style-Reference)", "error");
  const btn = $("m2Generate");
  btn.disabled = true;
  setBusy(true, "Generiere Flyer (V3, höchste Qualität) …");
  try {
    const { image } = await post("/admin/generate", { prompt, styleImage: state.moodboard });
    showResult(image);
    notify("Flyer generiert", "success");
  } catch (e) {
    notify(e.message, "error");
  } finally {
    btn.disabled = false;
    setBusy(false);
  }
}

export function initMode2() {
  const file = $("m2File");
  $("m2Drop").addEventListener("click", () => file.click());
  file.addEventListener("change", () => file.files[0] && onFile(file.files[0]));

  $("m2Analyze").addEventListener("click", analyze);
  $("m2Rebuild").addEventListener("click", rebuildPrompt);
  $("m2Generate").addEventListener("click", generate);

  const slider = $("m2Style");
  slider.addEventListener("input", () => { $("m2StyleVal").textContent = styleLabel(Number(slider.value)); });

  // Bereinigen (LaMa-Brush) + Korrigieren (re-edit) auf dem aktuellen Ergebnis.
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
      getMeta: () => ({ prompt: $("m2Prompt").value, dna: state.dna, styleAdherence: Number($("m2Style").value) }),
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

// Für andere Module (Task: Bereinigen/Korrigieren) erreichbar.
export function getResult() { return state.result; }
export function setResult(dataUrl) { showResult(dataUrl); }
