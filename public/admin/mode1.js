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

const state = { current: null, zones: [] };

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
    showImage(dataUrl); // Flyer ist der Startpunkt im Ergebnis
  } catch (e) {
    notify(e.message, "error");
  }
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
