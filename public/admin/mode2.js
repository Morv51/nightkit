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

// promptMode: "vibe" = Modus A (Standard, unveraendert), "independent" = Modus B (eigenstaendig).
const state = { refs: [], refType: "moodboard", promptMode: "vibe", dna: null, varCount: 0 };

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
      promptMode: state.promptMode, // Modus A (Standard) oder B (eigenstaendig)
      model: $("m2Model").value,
    });
    // NEUER Stil-Anker → alles Alte verwerfen: Varianten-Liste leeren UND die
    // manuellen Varianten-Eingaben zurücksetzen (kein alter Wert sickert durch).
    state.dna = dna;
    if (refType) state.refType = refType;
    $("m2Prompt").value = prompt || "";
    autoGrow();
    $("m2Rebuild").hidden = false;
    showAnchor(dna);
    clearVariants();
    resetVariantInputs();
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
    const { prompt } = await post("/admin/build-prompt", { dna: state.dna, refType: state.refType, promptMode: state.promptMode });
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
  $("m2CopyAll").hidden = true;
}

// Manuelle Varianten-Eingaben leeren — beim Anker-Wechsel, damit keine alten
// Werte aus einem früheren Stil-Anker durchsickern.
function resetVariantInputs() {
  ["m2VarColor", "m2VarImagery", "m2VarMood", "m2VarColors"].forEach((id) => {
    const el = $(id);
    if (el) el.value = "";
  });
}

function addVariant(label, variant, precomputedPrompt) {
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

  card.appendChild(head); card.appendChild(ta);
  $("m2VariantList").appendChild(card); // natürliche Reihenfolge (1, 2, 3 …)
  $("m2CopyAll").hidden = false;

  // Nach erfolgreichem Kopieren die GANZE Karte dauerhaft als "kopiert" markieren
  // (grün), damit man bei vielen Varianten den Überblick behält. Bleibt bestehen,
  // bis ein neuer Varianten-Satz erzeugt wird (clearVariants leert die Liste).
  copyBtn.addEventListener("click", () => copyToClipboard(ta.value, copyBtn, () => card.classList.add("variant-copied")));

  // Prompt entweder vorab geliefert (Auto-Varianten) oder hier einzeln bauen.
  if (precomputedPrompt != null) {
    ta.value = precomputedPrompt;
  } else {
    ta.value = "… Prompt wird gebaut …";
    post("/admin/build-prompt", { dna: state.dna, refType: state.refType, variant })
      .then(({ prompt }) => { ta.value = prompt; })
      .catch((e) => { ta.value = "Fehler: " + e.message; notify(e.message, "error"); });
  }
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

// Vollautomatisch: N fertige Varianten (Default 10) — gleicher Stil-Anker,
// automatisch verschieden in Farbe / Illustration / Aufbau. Ein Klick, nichts
// eintippen. Ersetzt die aktuelle Varianten-Liste durch den frischen Satz.
async function autoVariants() {
  if (!state.dna) return notify("Erst eine Referenz analysieren", "info");
  const count = Math.max(1, Math.min(24, parseInt($("m2AutoCount").value, 10) || 10));
  const btn = $("m2AutoBtn");
  btn.disabled = true;
  setBusy(true, `Erzeuge ${count} Varianten …`);
  try {
    const { variants } = await post("/admin/auto-variants", {
      dna: state.dna, refType: state.refType, count, model: $("m2Model").value,
    });
    clearVariants();
    (variants || []).forEach((vrt) => addVariant(vrt.label, null, vrt.prompt));
    notify(`${(variants || []).length} Varianten automatisch erzeugt`, "success");
  } catch (e) {
    notify(e.message, "error");
  } finally {
    btn.disabled = false;
    setBusy(false);
  }
}

// Alle Varianten-Prompts als nummerierte Liste in die Zwischenablage.
function copyAll() {
  const cards = Array.from(document.querySelectorAll("#m2VariantList .variant-card"));
  if (!cards.length) return notify("Keine Varianten zum Kopieren", "info");
  const parts = cards.map((c) => {
    const label = c.querySelector(".variant-label").textContent;
    const prompt = c.querySelector(".variant-prompt").value;
    return `=== ${label} ===\n${prompt}`;
  });
  copyToClipboard(parts.join("\n\n\n"), $("m2CopyAll"));
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

function copyToClipboard(text, btn, onCopied) {
  if (!text || !text.trim()) return notify("Noch kein Prompt zum Kopieren", "info");
  const restore = btn.textContent;
  const flash = () => {
    btn.textContent = "✓ Kopiert!"; btn.classList.add("copied");
    if (typeof onCopied === "function") onCopied(); // z.B. Varianten-Karte grün markieren
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
  // WICHTIG (iOS Safari): #m2Drop ist ein <label> um den Input — der Tipp oeffnet den
  // Dialog schon nativ. Ein zusaetzliches file.click() erzeugte einen Doppel-Trigger,
  // den iOS verwirft (Auswahl kommt nie als change an). Darum KEIN file.click() mehr —
  // wie die funktionierenden Auto-Flows.
  file.addEventListener("change", () => { if (file.files && file.files.length) { addFiles(file.files); file.value = ""; } });
  // Mehrfach-Upload ohne Dialog: Drag&Drop (alle Dateien) + Paste (Klick laeuft ueber die Label-Assoziation).
  wireDropzoneMulti($("m2Drop"), addFiles);
  wirePaste($("panel-mode2"), (f) => addFiles([f]));

  $("m2RefType").addEventListener("change", () => {
    state.refType = $("m2RefType").value;
    if (state.dna) rebuildPrompt(); // Hauptprompt an Referenzart anpassen
  });

  // Prompt-Modus A/B umschalten. Nur der Hauptprompt aendert sich; ist schon eine DNA
  // da, wird der Prompt direkt neu gebaut (gleicher Ablauf wie beim Referenzart-Wechsel).
  const pm = $("m2PromptMode");
  if (pm) pm.addEventListener("change", () => {
    state.promptMode = pm.value;
    if (state.dna) rebuildPrompt();
  });

  $("m2Analyze").addEventListener("click", analyze);
  $("m2Rebuild").addEventListener("click", rebuildPrompt);
  $("m2Copy").addEventListener("click", () => copyToClipboard($("m2Prompt").value, $("m2Copy")));
  $("m2Prompt").addEventListener("input", autoGrow);

  $("m2VarAdd").addEventListener("click", addVariantFromInputs);
  $("m2VarBatch").addEventListener("click", addBatchVariants);
  $("m2VarClear").addEventListener("click", clearVariants);
  $("m2AutoBtn").addEventListener("click", autoVariants);
  $("m2CopyAll").addEventListener("click", copyAll);
}
