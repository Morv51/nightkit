// Auto-Flow (Beta) — vollautomatischer Ein-Flyer-Durchlauf. Ruft die BESTEHENDE
// Modus-2-Analyse/Prompt-Route (/admin/analyze, refType "single") nur auf und
// danach die isolierte Generier-Route (/admin/auto-generate, offizielle OpenAI-
// Bild-API / GPT Image). Jeder Schritt zeigt seinen Status im Klartext, Fehler
// werden sichtbar gemacht (kein stilles Hängen). KEIN Ideogram, KEINE ChatGPT-
// Weboberfläche. Bewusst nur EIN Bild (Vorstufe zur späteren Stapelverarbeitung).

import { post, getToken } from "./studioApi.js";
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

// Den asynchronen Generier-Job pollen, bis er fertig ist oder fehlschlägt.
// Großzügige Gesamt-Obergrenze (6 Min), Status mit laufender Sekundenanzeige.
async function pollAutoGenerate(jobId, startedAt) {
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    let res;
    try {
      res = await fetch("/admin/auto-generate/" + encodeURIComponent(jobId), {
        headers: { "X-Admin-Token": getToken() },
      });
    } catch {
      continue; // kurzer Netz-Aussetzer → weiter pollen
    }
    const job = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error(job.error || "Auftrag nicht mehr gefunden — bitte erneut starten.");
    if (!res.ok) throw new Error(job.error || ("HTTP " + res.status));
    if (job.status === "done") return job;
    if (job.status === "error") throw new Error(job.error || "Generierung fehlgeschlagen");
    setStep("afS2", "afStep2", "running", "läuft … (" + Math.round((Date.now() - startedAt) / 1000) + " s)");
  }
  throw new Error("Zeitüberschreitung — die Generierung hat über 6 Minuten gedauert.");
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

  // ── Schritt 2: Generierung (Nano Banana über Segmind, Referenz + Prompt) ──
  const engine = $("afEngine") ? $("afEngine").value : "nano-banana-pro";
  const engineName = ($("afEngine") && $("afEngine").selectedOptions[0])
    ? $("afEngine").selectedOptions[0].text.split("·")[0].trim() : "Nano Banana Pro";
  if ($("afStep2Label")) $("afStep2Label").textContent = "Bildgenerierung (" + engineName + ")";
  setStep("afS2", "afStep2", "running", "läuft … " + engineName + " (kann 1–2 Min dauern)");
  const t0 = Date.now();
  try {
    // Asynchron: Auftrag starten (sofortige 202-Antwort) und dann pollen — so kappt
    // der Render-Gateway den langen Lauf nicht mehr mit 502. Gewähltes Bildmodell mit.
    const start = await post("/admin/auto-generate", { image: imageDataUrl, prompt, model: engine });
    if (!start || !start.jobId) throw new Error("Kein Auftrag gestartet");
    const job = await pollAutoGenerate(start.jobId, t0);
    if (!job.image) throw new Error("Kein Bild erhalten");
    const secs = job.ms ? Math.round(job.ms / 1000) : Math.round((Date.now() - t0) / 1000);
    resultImage = job.image;
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
