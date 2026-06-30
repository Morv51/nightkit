// Auto-Flow (Beta) — vollautomatischer Ein-Flyer-Durchlauf. Ruft die BESTEHENDE
// Modus-2-Analyse/Prompt-Route (/admin/analyze, refType "single") nur auf und
// danach die isolierte Generier-Route (/admin/auto-generate, offizielle OpenAI-
// Bild-API / GPT Image). Jeder Schritt zeigt seinen Status im Klartext, Fehler
// werden sichtbar gemacht (kein stilles Hängen). KEIN Ideogram, KEINE ChatGPT-
// Weboberfläche. Bewusst nur EIN Bild (Vorstufe zur späteren Stapelverarbeitung).

import { post } from "./studioApi.js";
import { fileToDataUrl, downloadDataUrl, toJpeg, wireDropzone, wirePaste, notify } from "./studioUi.js";

const $ = (id) => document.getElementById(id);

let imageDataUrl = "";   // hochgeladener Referenz-Flyer
let resultImage = "";    // generiertes Template (data URL)
let running = false;

function setStep(stateId, stepId, state, text) {
  const st = $(stateId), step = $(stepId);
  if (st) st.textContent = text;
  if (step) {
    step.classList.remove("running", "done", "error");
    if (state) step.classList.add(state);
  }
}

function resetSteps() {
  setStep("afS1", "afStep1", "", "wartet");
  setStep("afS2", "afStep2", "", "wartet");
  const e = $("afError"); e.hidden = true; e.textContent = "";
  $("afPromptCard").hidden = true;
  $("afResultCard").hidden = true;
  resultImage = "";
}

function showError(msg) {
  const e = $("afError");
  e.textContent = "✗ " + msg;
  e.hidden = false;
}

function setThumb(dataUrl) {
  imageDataUrl = dataUrl;
  const t = $("afThumb");
  t.src = dataUrl; t.hidden = false;
  $("afDropLabel").textContent = "Anderen Flyer wählen — ziehen, einfügen (⌘/Ctrl+V) oder klicken";
}

async function pickFile(file) {
  try { setThumb(await fileToDataUrl(file)); }
  catch (e) { notify(e.message, "error"); }
}

async function run() {
  if (running) return;
  if (!imageDataUrl) return notify("Erst einen Referenz-Flyer hochladen", "info");
  running = true;
  $("afStart").disabled = true;
  resetSteps();

  // ── Schritt 1: Analyse + Prompt (bestehende Modus-2-Logik, refType "single") ──
  setStep("afS1", "afStep1", "running", "läuft …");
  let prompt;
  try {
    const r = await post("/admin/analyze", {
      images: [imageDataUrl], refType: "single", model: $("afModel").value,
    });
    prompt = r && r.prompt;
    if (!prompt) throw new Error("Kein Prompt erhalten");
    $("afPrompt").value = prompt;
    $("afPromptCard").hidden = false;
    setStep("afS1", "afStep1", "done", "✓ fertig");
  } catch (e) {
    setStep("afS1", "afStep1", "error", "✗ Fehler");
    showError(e.message); // Server-Meldung ist bereits aussagekräftig ("Analyse fehlgeschlagen: …")
    running = false; $("afStart").disabled = false;
    return;
  }

  // ── Schritt 2: Generierung (offizielle OpenAI-Bild-API, Referenz + Prompt) ──
  setStep("afS2", "afStep2", "running", "läuft … (kann bis ~2 Min dauern)");
  const t0 = Date.now();
  try {
    const r = await post("/admin/auto-generate", { image: imageDataUrl, prompt });
    if (!r || !r.image) throw new Error("Kein Bild erhalten");
    const secs = r.ms ? Math.round(r.ms / 1000) : Math.round((Date.now() - t0) / 1000);
    resultImage = r.image;
    $("afResultImg").src = resultImage;
    $("afResultCard").hidden = false;
    $("afTime").textContent = "· generiert in " + secs + " s";
    setStep("afS2", "afStep2", "done", "✓ fertig in " + secs + " s");
    notify("Auto-Flow fertig", "success");
  } catch (e) {
    setStep("afS2", "afStep2", "error", "✗ Fehler");
    showError(e.message); // Server-Meldung ist bereits aussagekräftig ("Generierung (GPT Image) fehlgeschlagen: …")
  } finally {
    running = false;
    $("afStart").disabled = false;
  }
}

export function initAutoflow() {
  const file = $("afFile");
  if (file) file.addEventListener("change", () => { if (file.files[0]) pickFile(file.files[0]); });
  wireDropzone($("afDrop"), pickFile);
  wirePaste($("panel-auto"), pickFile);
  if ($("afStart")) $("afStart").addEventListener("click", run);
  if ($("afDownloadPng")) $("afDownloadPng").addEventListener("click", () => {
    if (resultImage) downloadDataUrl(resultImage, "auto-flow-template.png");
  });
  if ($("afDownloadJpg")) $("afDownloadJpg").addEventListener("click", async () => {
    if (!resultImage) return;
    try { downloadDataUrl(await toJpeg(resultImage), "auto-flow-template.jpg"); }
    catch (e) { notify(e.message, "error"); }
  });
}
