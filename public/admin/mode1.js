// Modus 1: Flyer → Template (invers zum Produktivpfad).
// Upload fertiger Flyer → Vision erkennt Textzonen + Rollen → editierbarer
// Platzhalter-Prompt → bestehender edit()-Flow ersetzt die echten Texte durch
// unsere Platzhalter (Design/Typo bleiben).

import { post } from "./studioApi.js";
import { fileToDataUrl, downloadDataUrl, toJpeg, notify } from "./studioUi.js";
import { createBrushTool, correctImage, saveTemplate } from "./studioBrush.js";

const $ = (id) => document.getElementById(id);

const ROLES = ["HEADLINE", "SUBLINE", "DATUM", "UHRZEIT", "LOCATION",
  "DJ NAME 1", "DJ NAME 2", "DJ NAME 3", "CLUBNAME", "WEBSITE", "OTHER"];

const state = {
  current: null, zones: [],
  // Schritt 1a (9:16-Normalisierung)
  pendingOriginal: null, normDims: null, normResult: null, normPending: false,
};

const TARGET = 9 / 16; // 0.5625

// Maße eines data-URL-Bildes lesen.
function imgSize(dataUrl) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => rej(new Error("Bild konnte nicht gelesen werden"));
    i.src = dataUrl;
  });
}

// Schon 9:16 (mit kleiner Toleranz)? → keine Normalisierung nötig.
function isNineSixteen(w, h) {
  return Math.abs((w / h) / TARGET - 1) <= 0.02; // ≤2% Abweichung
}

// Pixel-Erweiterung je Seite, um VERLUSTFREI auf 9:16 zu kommen (kein Crop).
function computeExpand(w, h, direction) {
  const r = w / h;
  if (r > TARGET) {
    // zu kurz → Höhe ergänzen (Richtung wählbar)
    const extra = Math.round(w * 16 / 9) - h;
    let top = 0, bottom = 0;
    if (direction === "top") top = extra;
    else if (direction === "bottom") bottom = extra;
    else { top = Math.floor(extra / 2); bottom = extra - top; }
    return { top, bottom, left: 0, right: 0, vertical: true };
  }
  // zu hoch/schmal → Breite ergänzen (symmetrisch)
  const extra = Math.round(h * 9 / 16) - w;
  const left = Math.floor(extra / 2);
  return { top: 0, bottom: 0, left, right: extra - left, vertical: false };
}

function setBusy(on, msg) {
  $("m1Busy").hidden = !on;
  if (msg) $("m1BusyMsg").textContent = msg;
}

function showImage(dataUrl) {
  state.current = dataUrl;
  const img = $("m1Result");
  img.src = dataUrl;
  img.hidden = false;
  $("m1Empty").hidden = true;
  $("m1Actions").hidden = false;
}

async function onFile(file) {
  try {
    const dataUrl = await fileToDataUrl(file);
    $("m1DropLabel").textContent = file.name;
    const { w, h } = await imgSize(dataUrl);

    if (isNineSixteen(w, h)) {
      // Bereits 9:16 → Schritt 1a überspringen, direkt weiter.
      state.normPending = false;
      $("m1NormCard").hidden = true;
      showImage(dataUrl);
      return;
    }

    // Abweichend → Schritt 1a zeigen; Flow ist bis zur Bestätigung blockiert.
    state.pendingOriginal = dataUrl;
    state.normDims = { w, h };
    state.normResult = null;
    state.normPending = true;
    const e = computeExpand(w, h, "symmetric");
    $("m1NormDir").style.display = e.vertical ? "" : "none"; // Richtung nur bei Höhen-Erweiterung
    $("m1NormBefore").src = dataUrl;
    $("m1NormAfter").removeAttribute("src");
    $("m1NormApply").disabled = true;
    $("m1NormInfo").textContent = `aktuell ${w}×${h} — nicht 9:16`;
    $("m1NormCard").hidden = false;
    showImage(dataUrl); // Original schon sichtbar in der Bühne
    notify("Flyer ist nicht 9:16 — erst auf 9:16 erweitern (Schritt 1a)", "info");
  } catch (e) {
    notify(e.message, "error");
  }
}

async function normRun() {
  if (!state.pendingOriginal) return;
  const dir = (document.querySelector('input[name="m1NormDir"]:checked') || {}).value || "symmetric";
  const e = computeExpand(state.normDims.w, state.normDims.h, dir);
  $("m1NormRun").disabled = true;
  setBusy(true, "Erweitere verlustfrei auf 9:16 …");
  try {
    const { image } = await post("/admin/normalize", {
      image: state.pendingOriginal, top: e.top, bottom: e.bottom, left: e.left, right: e.right,
    });
    state.normResult = image;
    $("m1NormAfter").src = image;
    $("m1NormApply").disabled = false;
    notify("9:16-Version erstellt — prüfen und übernehmen", "success");
  } catch (err) {
    notify(err.message, "error");
  } finally {
    setBusy(false);
    $("m1NormRun").disabled = false;
  }
}

function normApply() {
  if (!state.normResult) return notify("Erst auf 9:16 erweitern", "error");
  state.current = state.normResult;
  state.normPending = false;
  $("m1NormCard").hidden = true;
  showImage(state.normResult);
  notify("9:16 übernommen — weiter mit der Analyse", "success");
}

function renderZones() {
  const wrap = $("m1Zones");
  wrap.innerHTML = "";
  state.zones.forEach((z, i) => {
    const row = document.createElement("div");
    row.className = "zone-row";
    const text = document.createElement("span");
    text.className = "zone-text";
    text.textContent = z.text || "(leer)";
    text.title = z.text || "";
    const sel = document.createElement("select");
    sel.className = "zone-role";
    for (const r of ROLES) {
      const o = document.createElement("option");
      o.value = r; o.textContent = r;
      if (r === (z.role || "OTHER")) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => { state.zones[i].role = sel.value; });
    row.appendChild(text);
    row.appendChild(sel);
    wrap.appendChild(row);
  });
  $("m1ZonesCard").hidden = state.zones.length === 0;
}

async function analyze() {
  if (!state.current) return notify("Erst einen Flyer hochladen", "error");
  if (state.normPending) return notify("Erst auf 9:16 erweitern und übernehmen (Schritt 1a)", "error");
  const btn = $("m1Analyze");
  btn.disabled = true;
  setBusy(true, "Erkenne Textzonen …");
  try {
    const { zones, prompt } = await post("/admin/analyze", {
      mode: "flyer",
      image: state.current,
      model: $("m1Model").value,
    });
    state.zones = (zones || []).map((z) => ({ text: z.text || "", role: z.role || "OTHER" }));
    renderZones();
    $("m1Prompt").value = prompt || "";
    $("m1Rebuild").hidden = false;
    notify(`${state.zones.length} Textzonen erkannt`, "success");
  } catch (e) {
    notify(e.message, "error");
  } finally {
    btn.disabled = false;
    setBusy(false);
  }
}

async function rebuildPrompt() {
  if (!state.zones.length) return;
  try {
    const { prompt } = await post("/admin/build-placeholder-prompt", { zones: state.zones });
    $("m1Prompt").value = prompt;
    notify("Prompt aus Rollen neu gebaut", "success");
  } catch (e) {
    notify(e.message, "error");
  }
}

async function insertPlaceholders() {
  if (!state.current) return notify("Kein Flyer geladen", "error");
  const prompt = $("m1Prompt").value.trim();
  if (!prompt) return notify("Prompt ist leer — erst Textzonen erkennen", "error");
  const btn = $("m1Insert");
  btn.disabled = true;
  setBusy(true, "Setze Platzhalter ein …");
  try {
    const { image } = await post("/admin/edit", { image: state.current, prompt });
    showImage(image);
    notify("Platzhalter eingesetzt", "success");
  } catch (e) {
    notify(e.message, "error");
  } finally {
    btn.disabled = false;
    setBusy(false);
  }
}

export function initMode1() {
  const file = $("m1File");
  $("m1Drop").addEventListener("click", () => file.click());
  file.addEventListener("change", () => file.files[0] && onFile(file.files[0]));

  // Schritt 1a: 9:16-Normalisierung
  $("m1NormRun").addEventListener("click", normRun);
  $("m1NormApply").addEventListener("click", normApply);

  $("m1Analyze").addEventListener("click", analyze);
  $("m1Rebuild").addEventListener("click", rebuildPrompt);
  $("m1Insert").addEventListener("click", insertPlaceholders);

  // Bereinigen (LaMa-Brush) + Korrigieren (re-edit) auf dem aktuellen Bild.
  const brush = createBrushTool({
    stage: $("m1Stage"), img: $("m1Result"),
    getImage: () => state.current, setImage: showImage, setBusy,
  });
  $("m1Clean").addEventListener("click", () => brush.open());
  $("m1Correct").addEventListener("click", () =>
    correctImage({ getImage: () => state.current, setImage: showImage, setBusy }));
  $("m1Save").addEventListener("click", () =>
    saveTemplate({
      getImage: () => state.current, mode: "flyer",
      getMeta: () => ({ prompt: $("m1Prompt").value, zones: state.zones }),
    }));

  $("m1ExportPng").addEventListener("click", () => {
    if (state.current) downloadDataUrl(state.current, "nightkit-template.png");
  });
  $("m1ExportJpg").addEventListener("click", async () => {
    if (!state.current) return;
    try { downloadDataUrl(await toJpeg(state.current), "nightkit-template.jpg"); }
    catch (e) { notify(e.message, "error"); }
  });
}

export function getResult() { return state.current; }
export function setResult(dataUrl) { showImage(dataUrl); }
