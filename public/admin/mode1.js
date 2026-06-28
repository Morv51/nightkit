// Modus 1: Flyer → Template (invers zum Produktivpfad).
// Upload fertiger Flyer → Vision erkennt Textzonen + Rollen → editierbarer
// Platzhalter-Prompt → bestehender edit()-Flow ersetzt die echten Texte durch
// unsere Platzhalter (Design/Typo bleiben).

import { post } from "./studioApi.js";
import { fileToDataUrl, downloadDataUrl, toJpeg, notify, wireDropzone, wirePaste } from "./studioUi.js";
import { createBrushTool, correctImage, saveTemplate } from "./studioBrush.js";
import { createCompare } from "./studioCompare.js";

const $ = (id) => document.getElementById(id);
let compare; // Vorher/Nachher-Slider (in initMode1 erzeugt)

// Pflicht-Platzhalter (Soll-Liste) — ein Template muss sie alle enthalten.
const MANDATORY = ["HEADLINE", "SUBLINE", "DATUM", "UHRZEIT", "LOCATION",
  "DJ NAME 1", "DJ NAME 2", "DJ NAME 3", "CLUBNAME", "WEBSITE"];
// Dropdown je Zone: Pflichtrollen + "ENTFERNEN" (markiert die Zone fürs LaMa-Removal).
const ROLES = [...MANDATORY, "ENTFERNEN"];

const state = {
  current: null, zones: [],
  // Schritt 1a (9:16-Normalisierung)
  pendingOriginal: null, normDims: null, normResult: null, normPending: false,
  // Vorher-Bild (Build-Eingang) für den Vorher/Nachher-Vergleich
  beforeImage: null,
  // Font-Referenz für ergänzte Felder (Index in state.zones, -1 = automatisch)
  fontRefIdx: -1,
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
  if (compare) compare.reset(); // neues Bild → zurück in den Nachher-Zustand
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
      o.value = r; o.textContent = r === "ENTFERNEN" ? "✕ ENTFERNEN" : r;
      if (r === z.role) o.selected = true;
      sel.appendChild(o);
    }
    const markRemove = () => row.classList.toggle("zone-remove", sel.value === "ENTFERNEN");
    sel.addEventListener("change", () => { state.zones[i].role = sel.value; markRemove(); updateMissing(); scheduleRebuild(); });
    markRemove();
    row.appendChild(text);
    row.appendChild(sel);
    wrap.appendChild(row);
  });
  $("m1ZonesCard").hidden = state.zones.length === 0;
  updateMissing();
}

// Soll-Abgleich: welche Pflicht-Platzhalter sind noch keiner Zone zugewiesen?
// Die werden beim Bauen aktiv ergänzt — hier sichtbar gemacht.
function updateMissing() {
  const el = $("m1Missing");
  if (!el) return;
  const assigned = new Set(state.zones.map((z) => z.role).filter((r) => MANDATORY.includes(r)));
  const missing = MANDATORY.filter((r) => !assigned.has(r));
  el.innerHTML = "";
  if (!state.zones.length) { el.hidden = true; return; }
  el.hidden = false;
  if (!missing.length) {
    el.innerHTML = '<span class="miss-ok">✓ alle Pflicht-Platzhalter abgedeckt</span>';
    return;
  }
  const head = document.createElement("span");
  head.className = "miss-head";
  head.textContent = `wird ergänzt (${missing.length}):`;
  el.appendChild(head);
  for (const r of missing) {
    const chip = document.createElement("span");
    chip.className = "miss-chip";
    chip.textContent = r;
    el.appendChild(chip);
  }
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
    // bbox behalten (für ENTFERNEN-Maske), font für die Font-Referenz. Nicht-
    // Pflichtrollen (OTHER, Credits) als ENTFERNEN vorbelegen — änderbar.
    state.zones = (zones || []).map((z) => ({
      text: z.text || "",
      role: MANDATORY.includes(z.role) ? z.role : "ENTFERNEN",
      bbox: Array.isArray(z.bbox) && z.bbox.length === 4 ? z.bbox : null,
      font: z.font && typeof z.font === "object" ? z.font : null,
    }));
    state.fontRefIdx = -1;
    renderZones();
    populateFontRef();
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

// Font-Referenz: gewählte Zone als Stil-Anker {text, font} (oder null).
function refForPrompt() {
  const z = state.fontRefIdx >= 0 ? state.zones[state.fontRefIdx] : null;
  return z ? { text: z.text, font: z.font } : null;
}

// Dropdown „Font-Referenz für ergänzte Felder" mit den erkannten Zonen füllen.
function populateFontRef() {
  const sel = $("m1RefInfo"), box = $("m1FontRef");
  if (!sel || !box) return;
  sel.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "-1"; auto.textContent = "automatisch (Sekundär-Stil)";
  sel.appendChild(auto);
  state.zones.forEach((z, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    const hint = z.font ? " · " + [z.font.style, z.font.casing].filter(Boolean).join("/") : "";
    o.textContent = (z.text || "(leer)").slice(0, 28) + hint;
    sel.appendChild(o);
  });
  sel.value = String(state.fontRefIdx);
  box.hidden = state.zones.length === 0;
}

let rebuildSeq = 0;       // Race-Schutz: nur die jeweils LETZTE Antwort gilt
let rebuildTimer = null;  // Debounce für schnelle Mehrfach-Auswahlen

// Prompt aus dem AKTUELLEN Stand (Rollen + ENTFERNEN + Font-Referenz + fehlende
// Platzhalter) neu bauen. silent = leise (kein Toast) für Live-Updates.
async function rebuildPrompt({ silent = false } = {}) {
  if (!state.zones.length) return;
  const seq = ++rebuildSeq;
  try {
    const { prompt } = await post("/admin/build-placeholder-prompt", {
      zones: state.zones,
      infoRef: refForPrompt(),
    });
    if (seq !== rebuildSeq) return; // veraltete Antwort verwerfen
    $("m1Prompt").value = prompt;
    flashPrompt();
    if (!silent) notify("Prompt neu gebaut (Rollen + Font-Referenz)", "success");
  } catch (e) {
    if (seq === rebuildSeq) notify(e.message, "error");
  }
}

// Jede UI-Auswahl stößt den Neuaufbau leise an — gebündelt, damit schnelle
// Klicks den Server nicht fluten; die letzte Auswahl gewinnt.
function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { rebuildTimer = null; rebuildPrompt({ silent: true }); }, 220);
}

// Kurzes Aufblitzen des Prompt-Feldes, damit die Live-Aktualisierung sichtbar ist.
function flashPrompt() {
  const el = $("m1Prompt");
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth; // Reflow → Animation neu starten
  el.classList.add("flash");
}

// LaMa-Maske aus den bboxes der ENTFERNEN-Zonen (WEISS = entfernen). bbox ist
// normiert [x,y,w,h]; leichte Polsterung für saubere Abdeckung.
async function buildRemoveMask(dataUrl, zones) {
  const { w, h } = await imgSize(dataUrl);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, w, h); // behalten
  ctx.fillStyle = "#FFFFFF"; // entfernen
  const pad = 0.012;
  for (const z of zones) {
    if (!z.bbox) continue;
    const [bx, by, bw, bh] = z.bbox;
    const x = Math.max(0, bx - pad) * w;
    const y = Math.max(0, by - pad) * h;
    const rw = Math.min(1, bw + 2 * pad) * w;
    const rh = Math.min(1, bh + 2 * pad) * h;
    ctx.fillRect(x, y, rw, rh);
  }
  return c.toDataURL("image/png");
}

async function insertPlaceholders() {
  if (!state.current) return notify("Kein Flyer geladen", "error");
  if (state.normPending) return notify("Erst auf 9:16 erweitern (Schritt 1a)", "error");
  const prompt = $("m1Prompt").value.trim();
  if (!prompt) return notify("Prompt ist leer — erst Textzonen erkennen", "error");

  const removeZones = state.zones.filter((z) => z.role === "ENTFERNEN" && z.bbox);
  const btn = $("m1Insert");
  btn.disabled = true;
  if (compare) compare.reset();
  // Vorher-Bild = der Build-Eingang (Original-/9:16-Upload) für den Vergleich.
  state.beforeImage = state.current;
  try {
    let img = state.current;
    // 1) Als ENTFERNEN markierte Zonen aktiv via LaMa rauslöschen (Credits/Logos).
    if (removeZones.length) {
      setBusy(true, `Entferne ${removeZones.length} markierte Zone(n) …`);
      const mask = await buildRemoveMask(img, removeZones);
      const r = await post("/admin/remove", { image: img, mask });
      img = r.image;
      state.current = img;
      showImage(img);
    }
    // 2) Texte ersetzen + fehlende ergänzen — je nach gewählter Engine.
    const engine = ($("m1Engine") && $("m1Engine").value) || "ideogram";
    const endpoint = engine === "openai" ? "/admin/edit-openai" : "/admin/edit";
    setBusy(true, engine === "openai"
      ? "GPT Image 2 baut das Template …"
      : "Setze Platzhalter ein + ergänze fehlende …");
    const r2 = await post(endpoint, { image: img, prompt });
    showImage(r2.image);
    $("m1Compare").hidden = false; // Vorher/Nachher jetzt verfügbar
    notify("Template gebaut — '⇄ Vorher/Nachher' zum Vergleichen, sonst Korrigieren/Bereinigen", "success");
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
  // Upload ohne Dialog: Drag&Drop + Paste (Klick bleibt Fallback).
  wireDropzone($("m1Drop"), onFile);
  wirePaste($("panel-mode1"), onFile);

  // Schritt 1a: 9:16-Normalisierung
  $("m1NormRun").addEventListener("click", normRun);
  $("m1NormApply").addEventListener("click", normApply);

  $("m1Analyze").addEventListener("click", analyze);
  $("m1Rebuild").addEventListener("click", rebuildPrompt);
  $("m1Insert").addEventListener("click", insertPlaceholders);

  // Font-Referenz für ergänzte Felder: Auswahl → Prompt neu bauen.
  $("m1RefInfo").addEventListener("change", (e) => { state.fontRefIdx = Number(e.target.value); scheduleRebuild(); });

  // Vorher/Nachher-Vergleich über der Ergebnis-Bühne.
  compare = createCompare({
    resultImg: $("m1Result"),
    getBefore: () => state.beforeImage,
    getAfter: () => state.current,
    button: $("m1Compare"),
  });
  $("m1Compare").addEventListener("click", () => compare.toggle());

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
