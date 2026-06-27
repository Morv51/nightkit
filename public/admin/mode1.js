// Modus 1: Flyer → Template (invers zum Produktivpfad).
// Upload fertiger Flyer → Vision erkennt Textzonen + Rollen → editierbarer
// Platzhalter-Prompt → bestehender edit()-Flow ersetzt die echten Texte durch
// unsere Platzhalter (Design/Typo bleiben).

import { post } from "./studioApi.js";
import { fileToDataUrl, downloadDataUrl, toJpeg, notify, wireDropzone, wirePaste } from "./studioUi.js";
import { createBrushTool, correctImage, saveTemplate } from "./studioBrush.js";
import { buildZoneMask, compositeRegions } from "./studioMask.js";

// Ideogram-V3-Edit-Maskenkonvention: SCHWARZ = editieren (laut Doku). Falls das
// Ergebnis zeigt, dass nichts ersetzt wird, hier auf false kippen. Der Composite
// macht eine falsche Polarität ungefährlich (schlimmstenfalls: keine Änderung).
const MASK_EDIT_BLACK = true;

const $ = (id) => document.getElementById(id);

// Pflicht-Platzhalter (Soll-Liste) — ein Template muss sie alle enthalten.
const MANDATORY = ["HEADLINE", "SUBLINE", "DATUM", "UHRZEIT", "LOCATION",
  "DJ NAME 1", "DJ NAME 2", "DJ NAME 3", "CLUBNAME", "WEBSITE"];
// Dropdown je Zone: Pflichtrollen + "ENTFERNEN" (markiert die Zone fürs LaMa-Removal).
const ROLES = [...MANDATORY, "ENTFERNEN"];

const state = {
  current: null, zones: [],
  // Schritt 1a (9:16-Normalisierung)
  pendingOriginal: null, normDims: null, normResult: null, normPending: false,
  // Font-Referenzen (Index in state.zones, -1 = automatisch)
  infoRefIdx: -1, headlineRefIdx: -1,
  // bereits via Add-Schritt ergänzte Rollen (für Soll-Abgleich)
  addedRoles: [],
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
      o.value = r; o.textContent = r === "ENTFERNEN" ? "✕ ENTFERNEN" : r;
      if (r === z.role) o.selected = true;
      sel.appendChild(o);
    }
    const markRemove = () => row.classList.toggle("zone-remove", sel.value === "ENTFERNEN");
    sel.addEventListener("change", () => { state.zones[i].role = sel.value; markRemove(); updateMissing(); });
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
function missingRoles() {
  const covered = new Set([
    ...state.zones.map((z) => z.role).filter((r) => MANDATORY.includes(r)),
    ...state.addedRoles,
  ]);
  return MANDATORY.filter((r) => !covered.has(r));
}

function updateMissing() {
  populateAddRoles();
  const el = $("m1Missing");
  if (!el) return;
  const missing = missingRoles();
  el.innerHTML = "";
  if (!state.zones.length) { el.hidden = true; return; }
  el.hidden = false;
  if (!missing.length) {
    el.innerHTML = '<span class="miss-ok">✓ alle Pflicht-Platzhalter abgedeckt</span>';
    return;
  }
  const head = document.createElement("span");
  head.className = "miss-head";
  head.textContent = `fehlt — gezielt ergänzen (${missing.length}):`;
  el.appendChild(head);
  for (const r of missing) {
    const chip = document.createElement("span");
    chip.className = "miss-chip";
    chip.textContent = r;
    el.appendChild(chip);
  }
}

// Font-Referenz-Dropdowns mit den erkannten Zonen befüllen (Stil-Anker).
function fillRefSelect(sel, savedIdx) {
  if (!sel) return;
  sel.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "-1"; auto.textContent = "automatisch";
  sel.appendChild(auto);
  state.zones.forEach((z, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    const hint = z.font ? " · " + [z.font.style, z.font.casing].filter(Boolean).join("/") : "";
    o.textContent = (z.text || "(leer)").slice(0, 26) + hint;
    sel.appendChild(o);
  });
  sel.value = String(savedIdx);
}

function populateFontRefs() {
  const box = $("m1FontRef");
  if (!box) return;
  fillRefSelect($("m1RefInfo"), state.infoRefIdx);
  fillRefSelect($("m1RefHead"), state.headlineRefIdx);
  box.hidden = state.zones.length === 0;
}

function refFromIdx(idx) {
  const z = idx >= 0 ? state.zones[idx] : null;
  return z ? { text: z.text, font: z.font } : null;
}

// Add-Schritt: Dropdown mit den noch fehlenden Platzhaltern befüllen.
function populateAddRoles() {
  const sel = $("m1AddRole"), box = $("m1AddPh");
  if (!sel || !box) return;
  const missing = missingRoles();
  sel.innerHTML = "";
  if (!missing.length) {
    const o = document.createElement("option");
    o.value = ""; o.textContent = "(alle vorhanden)";
    sel.appendChild(o);
  } else {
    for (const r of missing) {
      const o = document.createElement("option");
      o.value = r; o.textContent = r;
      sel.appendChild(o);
    }
  }
  box.hidden = state.zones.length === 0;
}

// Zielbox aufs Ergebnis ziehen → maskierter Add-Edit nur dort + Composite.
function startPlaceBox() {
  const role = $("m1AddRole").value;
  if (!role) return notify("Erst einen Platzhalter wählen", "error");
  if (!state.current) return notify("Kein Bild zum Ergänzen", "error");

  const stage = $("m1Stage");
  let ov = $("m1PlaceOverlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "m1PlaceOverlay"; ov.className = "place-overlay";
    ov.innerHTML = '<div class="place-rect" id="m1PlaceRect"></div>';
    stage.appendChild(ov);
  }
  const rect = $("m1PlaceRect");
  ov.style.display = "block"; rect.style.display = "none";
  notify("Rechteck aufs Bild ziehen (wo der Text hin soll)", "info");

  let start = null, cur = null;
  const toLocal = (e) => {
    const r = ov.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const draw = (a, b) => {
    const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
    const w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]);
    rect.style.left = x * 100 + "%"; rect.style.top = y * 100 + "%";
    rect.style.width = w * 100 + "%"; rect.style.height = h * 100 + "%";
    return [x, y, w, h];
  };
  const onDown = (e) => { start = toLocal(e); rect.style.display = "block"; draw(start, start); try { ov.setPointerCapture(e.pointerId); } catch {} };
  const onMove = (e) => { if (start) cur = draw(start, toLocal(e)); };
  const onUp = async () => {
    ov.removeEventListener("pointerdown", onDown);
    ov.removeEventListener("pointermove", onMove);
    ov.removeEventListener("pointerup", onUp);
    ov.style.display = "none";
    if (!start || !cur || cur[2] < 0.02 || cur[3] < 0.02) { return notify("Box zu klein — abgebrochen", "error"); }
    await addPlaceholder(role, cur);
  };
  ov.addEventListener("pointerdown", onDown);
  ov.addEventListener("pointermove", onMove);
  ov.addEventListener("pointerup", onUp);
}

async function addPlaceholder(role, bbox) {
  setBusy(true, `Setze „${role}" ein …`);
  try {
    const { prompt } = await post("/admin/build-add-prompt", {
      role, infoRef: refFromIdx(state.infoRefIdx), headlineRef: refFromIdx(state.headlineRefIdx),
    });
    const mask = await buildZoneMask(state.current, [bbox], { editBlack: MASK_EDIT_BLACK });
    const r = await post("/admin/edit-masked", { image: state.current, mask, prompt });
    const composited = await compositeRegions(state.current, r.image, [bbox]);
    state.current = composited;
    showImage(composited);
    if (!state.addedRoles.includes(role)) state.addedRoles.push(role);
    updateMissing();
    notify(`„${role}" ergänzt`, "success");
  } catch (e) {
    notify(e.message, "error");
  } finally {
    setBusy(false);
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
    // bbox + font behalten (für ENTFERNEN-Maske bzw. Font-Referenz). Nicht-
    // Pflichtrollen (OTHER, Credits) als ENTFERNEN vorbelegen — änderbar.
    state.zones = (zones || []).map((z) => ({
      text: z.text || "",
      role: MANDATORY.includes(z.role) ? z.role : "ENTFERNEN",
      bbox: Array.isArray(z.bbox) && z.bbox.length === 4 ? z.bbox : null,
      font: z.font && typeof z.font === "object" ? z.font : null,
    }));
    state.infoRefIdx = -1;
    state.headlineRefIdx = -1;
    state.addedRoles = [];
    renderZones();
    populateFontRefs();
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
    const { prompt } = await post("/admin/build-placeholder-prompt", {
      zones: state.zones,
      infoRef: refFromIdx(state.infoRefIdx),
      headlineRef: refFromIdx(state.headlineRefIdx),
    });
    $("m1Prompt").value = prompt;
    notify("Prompt neu gebaut (Rollen + Font-Referenz)", "success");
  } catch (e) {
    notify(e.message, "error");
  }
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

  const removeZones = state.zones.filter((z) => z.role === "ENTFERNEN" && z.bbox);
  const replaceZones = state.zones.filter((z) => MANDATORY.includes(z.role) && z.bbox);
  if (!removeZones.length && !replaceZones.length) {
    return notify("Keine Textzonen mit Position zum Bearbeiten", "error");
  }

  const btn = $("m1Insert");
  btn.disabled = true;
  try {
    let img = state.current;

    // 1) ENTFERNEN-Zonen via LaMa rausnehmen (maskiert, Credits/Logos).
    if (removeZones.length) {
      setBusy(true, `Entferne ${removeZones.length} markierte Zone(n) …`);
      const mask = await buildRemoveMask(img, removeZones);
      const r = await post("/admin/remove", { image: img, mask });
      img = r.image; state.current = img; showImage(img);
    }

    // 2) Ersetzen — NUR die Textzonen maskiert editieren, dann pixelgenau zurück
    //    aufs Original komponieren. Gesichter/Komposition/Hintergrund bleiben.
    if (replaceZones.length) {
      setBusy(true, `Ersetze ${replaceZones.length} Text(e) — nur die Textzonen …`);
      const bboxes = replaceZones.map((z) => z.bbox);
      const mask = await buildZoneMask(img, bboxes, { editBlack: MASK_EDIT_BLACK });
      const prompt = $("m1Prompt").value.trim();
      if (!prompt) return notify("Prompt ist leer — erst Textzonen erkennen", "error");
      const r = await post("/admin/edit-masked", { image: img, mask, prompt });
      const composited = await compositeRegions(img, r.image, bboxes);
      img = composited; state.current = img; showImage(img);
    }

    const assigned = new Set(state.zones.map((z) => z.role));
    const missing = MANDATORY.filter((r) => !assigned.has(r)).length;
    notify(
      `Texte ersetzt — Bild bleibt erhalten.${missing ? ` ${missing} Platzhalter fehlen noch — gezielt mit „Platzhalter einsetzen" ergänzen.` : ""}`,
      "success"
    );
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

  // Font-Referenz: Auswahl einer erkannten Zone als Stil-Anker → Prompt neu bauen.
  $("m1RefInfo").addEventListener("change", (e) => { state.infoRefIdx = Number(e.target.value); rebuildPrompt(); });
  $("m1RefHead").addEventListener("change", (e) => { state.headlineRefIdx = Number(e.target.value); rebuildPrompt(); });

  // Platzhalter gezielt ergänzen (Zielbox ziehen).
  $("m1AddPlace").addEventListener("click", startPlaceBox);

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
