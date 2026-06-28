// Modus 2: Referenz(en) → PROMPT. Reiner PROMPT-GENERATOR (wie Modus 1).
// Upload von einer ODER mehreren visuellen Referenzen (Einzelbild, mehrere
// Bilder oder ein Moodboard) → Vision abstrahiert die Stil-Sprache (je nach
// Referenzart enger/abstrakter) → fertiger Club-Event-Flyer-Prompt zum Kopieren.
// Plus: Stil-Anker speichern + schnell mehrere Varianten (Farbwelt/Motive/
// Stimmung) im selben Stil erzeugen, ohne neu zu analysieren.

import { post } from "./studioApi.js";
import { fileToDataUrl, notify, wireDropzoneMulti, wirePaste } from "./studioUi.js";

const $ = (id) => document.getElementById(id);
const MAX_REFS = 8;

const state = { refs: [], refType: "moodboard", dna: null, varCount: 0 };

function setBusy(on, msg) {
  $("m2Busy").hidden = !on;
  if (msg) $("m2BusyMsg").textContent = msg;
}

// ── Referenzen (Mehrfach-Upload) ────────────────────────────────────────────
function renderThumbs() {
  const wrap = $("m2Thumbs");
  wrap.innerHTML = "";
  state.refs.forEach((r, i) => {
    const cell = document.createElement("div");
    cell.className = "thumb-cell";
    const img = document.createElement("img");
    img.src = r.dataUrl; img.alt = "";
    const rm = document.createElement("button");
    rm.type = "button"; rm.className = "thumb-rm"; rm.textContent = "✕"; rm.title = "Entfernen";
    rm.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      state.refs.splice(i, 1); renderThumbs(); updateRefCount();
    });
    cell.appendChild(img); cell.appendChild(rm);
    wrap.appendChild(cell);
  });
  wrap.hidden = state.refs.length === 0;
}

function updateRefCount() {
  $("m2DropLabel").textContent = state.refs.length
    ? `${state.refs.length} Referenz(en) geladen — weitere hinzufügbar`
    : "Bild(er) hierher ziehen, einfügen (⌘/Ctrl+V) oder klicken — ein Bild, mehrere Bilder oder ein Moodboard · PNG/JPG/WebP, ≤10 MB je Bild";
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  for (const f of files) {
    if (state.refs.length >= MAX_REFS) { notify(`Maximal ${MAX_REFS} Bilder`, "info"); break; }
    try { state.refs.push({ dataUrl: await fileToDataUrl(f) }); }
    catch (e) { notify(e.message, "error"); }
  }
  renderThumbs(); updateRefCount();
  if (state.refs.length) notify(`${state.refs.length} Referenz(en) geladen`, "success");
}

// ── Analyse → Stil-DNA + Prompt ─────────────────────────────────────────────
async function analyze() {
  if (!state.refs.length) return notify("Erst mindestens ein Bild hochladen", "error");
  const btn = $("m2Analyze");
  btn.disabled = true;
  setBusy(true, "Analysiere Stil-Sprache …");
  try {
    const { dna, prompt, refType } = await post("/admin/analyze", {
      mode: "moodboard",
      images: state.refs.map((r) => r.dataUrl),
      refType: state.refType,
      model: $("m2Model").value,
    });
    state.dna = dna;
    if (refType) state.refType = refType;
    $("m2Prompt").value = prompt || "";
    autoGrow();
    $("m2Rebuild").hidden = false;
    showAnchor(dna);
    clearVariants();
    notify("Analyse fertig — Prompt bereit zum Kopieren", "success");
  } catch (e) {
    notify(e.message, "error");
  } finally {
    btn.disabled = false;
    setBusy(false);
  }
}

// Hauptprompt aus DNA + aktueller Referenzart neu bauen (kein Varianten-Override).
async function rebuildPrompt() {
  if (!state.dna) return notify("Erst eine Referenz analysieren", "info");
  try {
    const { prompt } = await post("/admin/build-prompt", { dna: state.dna, refType: state.refType });
    $("m2Prompt").value = prompt;
    autoGrow();
    flashPrompt();
    notify("Prompt aktualisiert", "success");
  } catch (e) {
    notify(e.message, "error");
  }
}

// ── Stil-Anker (gespeicherte Stil-DNA, sichtbar) ────────────────────────────
const DNA_LABELS = {
  look_mood: "Stimmung", color_world: "Farbwelt", imagery_style: "Bildsprache",
  typography_character: "Typografie", composition: "Komposition", visual_hierarchy: "Hierarchie",
  texture_grain_light: "Textur/Licht", editorial_club_look: "Editorial/Club",
};

function showAnchor(dna) {
  const box = $("m2Anchor");
  box.innerHTML = "";
  Object.keys(DNA_LABELS).forEach((k) => {
    const val = dna && dna[k];
    if (!val) return;
    const row = document.createElement("div");
    row.className = "anchor-row";
    const key = document.createElement("span");
    key.className = "anchor-key"; key.textContent = DNA_LABELS[k];
    const v = document.createElement("span");
    v.className = "anchor-val"; v.textContent = val;
    row.appendChild(key); row.appendChild(v);
    box.appendChild(row);
  });
  $("m2AnchorCard").hidden = false;
  $("m2VariantsCard").hidden = false;
}

// ── Varianten (gleicher Stil-Anker, gezielt geänderte Aspekte) ──────────────
function clearVariants() {
  $("m2VariantList").innerHTML = "";
  state.varCount = 0;
}

function addVariant(label, variant) {
  state.varCount += 1;
  const n = state.varCount;
  const card = document.createElement("div");
  card.className = "variant-card";

  const head = document.createElement("div");
  head.className = "variant-head";
  const lab = document.createElement("span");
  lab.className = "variant-label";
  lab.textContent = `Variante ${n}${label ? " — " + label : ""}`;
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "rbtn rbtn-primary variant-copy";
  copyBtn.textContent = "📋 Kopieren";
  head.appendChild(lab); head.appendChild(copyBtn);

  const ta = document.createElement("textarea");
  ta.className = "st-prompt variant-prompt";
  ta.readOnly = true;
  ta.value = "… Prompt wird gebaut …";

  card.appendChild(head); card.appendChild(ta);
  $("m2VariantList").prepend(card); // neueste oben

  copyBtn.addEventListener("click", () => copyToClipboard(ta.value, copyBtn));

  post("/admin/build-prompt", { dna: state.dna, refType: state.refType, variant })
    .then(({ prompt }) => { ta.value = prompt; })
    .catch((e) => { ta.value = "Fehler: " + e.message; notify(e.message, "error"); });
}

function addVariantFromInputs() {
  if (!state.dna) return notify("Erst eine Referenz analysieren", "info");
  const color = $("m2VarColor").value.trim();
  const imagery = $("m2VarImagery").value.trim();
  const mood = $("m2VarMood").value.trim();
  if (!color && !imagery && !mood) {
    return notify("Mindestens einen Aspekt ändern (Farbwelt, Motive oder Stimmung)", "info");
  }
  addVariant(color || imagery || mood, { color_world: color, imagery_style: imagery, mood });
}

function addBatchVariants() {
  if (!state.dna) return notify("Erst eine Referenz analysieren", "info");
  const raw = $("m2VarColors").value.trim();
  if (!raw) return notify("Farbwelten kommagetrennt eingeben (z.B. Pastell, Schwarzweiß, Erdtöne, Neon)", "info");
  const colors = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  if (!colors.length) return;
  colors.forEach((c) => addVariant(c, { color_world: c }));
  notify(`${colors.length} Varianten erzeugt`, "success");
}

// ── Anzeige-Helfer ──────────────────────────────────────────────────────────
function flashPrompt() {
  const el = $("m2Prompt");
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

function autoGrow() {
  const el = $("m2Prompt");
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.max(el.scrollHeight + 2, 320) + "px";
}

// ── Kopieren (generisch — Hauptprompt + jede Variante) ──────────────────────
function fallbackCopyText(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand("copy"); done(); }
  catch { notify("Kopieren nicht möglich — bitte Text manuell markieren", "error"); }
  ta.remove();
}

function copyToClipboard(text, btn) {
  if (!text || !text.trim()) return notify("Noch kein Prompt zum Kopieren", "info");
  const restore = btn.textContent;
  const flash = () => {
    btn.textContent = "✓ Kopiert!"; btn.classList.add("copied");
    setTimeout(() => { btn.textContent = restore; btn.classList.remove("copied"); }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flash).catch(() => fallbackCopyText(text, flash));
  } else {
    fallbackCopyText(text, flash);
  }
}

export function initMode2() {
  const file = $("m2File");
  $("m2Drop").addEventListener("click", () => file.click());
  file.addEventListener("change", () => { if (file.files && file.files.length) { addFiles(file.files); file.value = ""; } });
  // Mehrfach-Upload ohne Dialog: Drag&Drop (alle Dateien) + Paste (Klick bleibt Fallback).
  wireDropzoneMulti($("m2Drop"), addFiles);
  wirePaste($("panel-mode2"), (f) => addFiles([f]));

  $("m2RefType").addEventListener("change", () => {
    state.refType = $("m2RefType").value;
    if (state.dna) rebuildPrompt(); // Hauptprompt an Referenzart anpassen
  });

  $("m2Analyze").addEventListener("click", analyze);
  $("m2Rebuild").addEventListener("click", rebuildPrompt);
  $("m2Copy").addEventListener("click", () => copyToClipboard($("m2Prompt").value, $("m2Copy")));
  $("m2Prompt").addEventListener("input", autoGrow);

  $("m2VarAdd").addEventListener("click", addVariantFromInputs);
  $("m2VarBatch").addEventListener("click", addBatchVariants);
  $("m2VarClear").addEventListener("click", clearVariants);
}
