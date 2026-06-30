// Batch Studio (Beta) — Stapel-PROMPT-Erzeugung für den parallelen ChatGPT-
// Workflow. Mehrere Flyer hochladen → pro Flyer EIN Paket aus Originalbild +
// erzeugtem Prompt (gleiche Nummer) + optional Varianten. KEINE Bildgenerierung.
// Ruft NUR die bestehende Modus-2-Logik auf: /admin/analyze (Stil-Anker + Haupt-
// Prompt) und /admin/auto-variants (Varianten). Nichts daran wird verändert.
// Läuft nacheinander (klarer Fortschritt), Fehler pro Bild im Klartext.

import { post } from "./studioApi.js";
import { fileToDataUrl, downloadDataUrl, wireDropzoneMulti, wirePaste, notify } from "./studioUi.js";

const $ = (id) => document.getElementById(id);

let files = [];   // [{ name, dataUrl }] hochgeladene Flyer
let packs = [];   // [{ idx, dataUrl, prompt, variants:[] }]
let running = false;

// ── Upload (mehrere) ─────────────────────────────────────────────
async function addFiles(fileList) {
  for (const f of fileList) {
    try { files.push({ name: f.name || "flyer", dataUrl: await fileToDataUrl(f) }); }
    catch (e) { notify(e.message, "error"); }
  }
  renderThumbs();
}

function renderThumbs() {
  const row = $("bThumbs");
  row.innerHTML = "";
  files.forEach((f, i) => {
    const t = document.createElement("div");
    t.className = "batch-thumb";
    const img = document.createElement("img"); img.src = f.dataUrl; img.alt = "";
    const x = document.createElement("button");
    x.type = "button"; x.className = "batch-thumb-x"; x.textContent = "✕"; x.title = "Entfernen";
    x.addEventListener("click", () => { if (!running) { files.splice(i, 1); renderThumbs(); } });
    t.appendChild(img); t.appendChild(x); row.appendChild(t);
  });
  row.hidden = !files.length;
  $("bDropLabel").textContent = files.length
    ? files.length + " Bild(er) gewählt — weitere hinzufügen oder unten starten"
    : "Mehrere Flyer hierher ziehen, einfügen (⌘/Ctrl+V) oder klicken — PNG/JPG/WebP, ≤10 MB je Bild";
}

// ── Kopieren (+ optionale Markierung) ────────────────────────────
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand("copy"); done(); } catch { notify("Kopieren nicht möglich — bitte manuell markieren", "error"); }
  ta.remove();
}
function copyText(text, btn, onCopied) {
  if (!text || !text.trim()) return notify("Nichts zu kopieren", "info");
  const restore = btn.textContent;
  const ok = () => {
    btn.textContent = "✓ Kopiert!"; btn.classList.add("copied");
    if (typeof onCopied === "function") onCopied();
    setTimeout(() => { btn.textContent = restore; btn.classList.remove("copied"); }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok).catch(() => fallbackCopy(text, ok));
  } else fallbackCopy(text, ok);
}

// ── Pakete rendern ───────────────────────────────────────────────
function renderPacks() {
  const list = $("bList");
  list.innerHTML = "";
  packs.forEach((p) => list.appendChild(packCard(p)));
}

function packCard(p) {
  const card = document.createElement("div");
  card.className = "batch-pack";
  card.dataset.idx = p.idx;

  const head = document.createElement("div");
  head.className = "batch-pack-head";
  const num = document.createElement("span"); num.className = "batch-pack-num"; num.textContent = "Flyer " + p.idx;
  const status = document.createElement("span"); status.className = "batch-status"; status.id = "bStatus" + p.idx; status.textContent = "wartet";
  head.appendChild(num); head.appendChild(status);

  const bodyEl = document.createElement("div");
  bodyEl.className = "batch-pack-body";

  // Bild + Download
  const imgCol = document.createElement("div");
  imgCol.className = "batch-pack-img";
  const img = document.createElement("img"); img.src = p.dataUrl; img.alt = "Flyer " + p.idx;
  const dl = document.createElement("button");
  dl.type = "button"; dl.className = "rbtn rbtn-ghost"; dl.textContent = "⬇ Bild";
  dl.addEventListener("click", () => downloadDataUrl(p.dataUrl, "flyer-" + p.idx + ".png"));
  imgCol.appendChild(img); imgCol.appendChild(dl);

  // Prompt + Kopieren → markiert das ganze Paket grün
  const promptCol = document.createElement("div");
  promptCol.className = "batch-pack-prompt";
  const ta = document.createElement("textarea");
  ta.className = "st-prompt"; ta.readOnly = true; ta.id = "bPrompt" + p.idx; ta.rows = 10;
  ta.value = p.prompt || "… wartet …";
  const copy = document.createElement("button");
  copy.type = "button"; copy.className = "rbtn rbtn-primary"; copy.textContent = "📋 Prompt kopieren";
  copy.addEventListener("click", () => copyText(ta.value, copy, () => card.classList.add("batch-copied")));
  promptCol.appendChild(ta); promptCol.appendChild(copy);

  bodyEl.appendChild(imgCol); bodyEl.appendChild(promptCol);

  const varBox = document.createElement("div");
  varBox.className = "batch-variants"; varBox.id = "bVars" + p.idx;

  card.appendChild(head); card.appendChild(bodyEl); card.appendChild(varBox);
  return card;
}

function setStatus(idx, state, text) {
  const el = $("bStatus" + idx);
  const card = document.querySelector('.batch-pack[data-idx="' + idx + '"]');
  if (el) el.textContent = text;
  if (card) { card.classList.remove("running", "done", "error"); if (state) card.classList.add(state); }
}

function setVariants(idx, variants) {
  const box = $("bVars" + idx);
  if (!box) return;
  box.innerHTML = "";
  if (!variants || !variants.length) return;
  const head = document.createElement("div");
  head.className = "batch-var-head"; head.textContent = "Varianten (" + variants.length + ")";
  box.appendChild(head);
  variants.forEach((v, k) => {
    const row = document.createElement("div");
    row.className = "batch-var";
    const lab = document.createElement("div");
    lab.className = "batch-var-label";
    lab.textContent = "Flyer " + idx + " · Variante " + (k + 1) + (v.label ? " — " + v.label : "");
    const ta = document.createElement("textarea");
    ta.className = "st-prompt"; ta.readOnly = true; ta.rows = 6; ta.value = v.prompt || "";
    const copy = document.createElement("button");
    copy.type = "button"; copy.className = "rbtn rbtn-ghost variant-copy"; copy.textContent = "📋 Kopieren";
    copy.addEventListener("click", () => copyText(ta.value, copy, () => row.classList.add("batch-copied")));
    row.appendChild(lab); row.appendChild(ta); row.appendChild(copy);
    box.appendChild(row);
  });
}

// ── Fortschritt ──────────────────────────────────────────────────
function setProgress(done, total) {
  $("bProgressCard").hidden = false;
  $("bProgress").textContent = done + " von " + total + " Prompts erzeugt";
  const fill = $("bProgressFill");
  if (fill) fill.style.width = total ? Math.round((done / total) * 100) + "%" : "0%";
}

// ── Lauf (nacheinander, klarer Fortschritt) ──────────────────────
async function runBatch() {
  if (running) return;
  if (!files.length) return notify("Erst Flyer hochladen", "info");
  running = true;
  $("bStart").disabled = true;
  const model = $("bModel").value;
  const varCount = Math.max(0, Math.min(5, parseInt($("bVarCount").value, 10) || 0));

  packs = files.map((f, i) => ({ idx: i + 1, dataUrl: f.dataUrl, prompt: "", variants: [] }));
  renderPacks();
  const total = packs.length;
  let done = 0;
  setProgress(0, total);

  for (const p of packs) {
    setStatus(p.idx, "running", "Analyse + Prompt …");
    try {
      const r = await post("/admin/analyze", { images: [p.dataUrl], refType: "single", model });
      if (!r.prompt) throw new Error("Kein Prompt erhalten");
      p.prompt = r.prompt;
      const ta = $("bPrompt" + p.idx); if (ta) ta.value = r.prompt;
      if (varCount > 0) {
        setStatus(p.idx, "running", "Varianten …");
        const vr = await post("/admin/auto-variants", { dna: r.dna, count: varCount, refType: "single", model });
        p.variants = vr.variants || [];
        setVariants(p.idx, p.variants);
      }
      setStatus(p.idx, "done", "✓ fertig");
    } catch (e) {
      setStatus(p.idx, "error", "✗ " + e.message);
    }
    done++;
    setProgress(done, total);
  }

  running = false;
  $("bStart").disabled = false;
  notify("Batch fertig — " + done + " Flyer verarbeitet", "success");
}

// ── Export ───────────────────────────────────────────────────────
function packsText() {
  return packs.map((p) => {
    let s = "=== FLYER " + p.idx + " ===\nBilddatei: flyer-" + p.idx + ".png\n\nPROMPT:\n" + (p.prompt || "(kein Prompt)");
    if (p.variants.length) {
      s += "\n\n" + p.variants.map((v, k) =>
        "VARIANTE " + (k + 1) + (v.label ? " — " + v.label : "") + ":\n" + v.prompt).join("\n\n");
    }
    return s;
  }).join("\n\n\n");
}
function copyAll() {
  if (!packs.length) return notify("Noch nichts erzeugt", "info");
  copyText(packsText(), $("bExportAll"));
}
function exportTxt() {
  if (!packs.length) return notify("Noch nichts erzeugt", "info");
  downloadDataUrl("data:text/plain;charset=utf-8," + encodeURIComponent(packsText()), "batch-prompts.txt");
}

export function initBatch() {
  const file = $("bFile");
  if (file) file.addEventListener("change", () => {
    // Dateien SYNCHRON in ein Array kopieren, BEVOR file.value geleert wird —
    // sonst leert das Zurücksetzen die Live-FileList, während addFiles sie noch
    // asynchron liest (sonst gehen bei Mehrfach-Auswahl Dateien verloren).
    const picked = Array.from(file.files);
    file.value = "";
    if (picked.length) addFiles(picked);
  });
  wireDropzoneMulti($("bDrop"), addFiles);
  wirePaste($("panel-batch"), (f) => addFiles([f]));
  if ($("bStart")) $("bStart").addEventListener("click", runBatch);
  if ($("bExportAll")) $("bExportAll").addEventListener("click", copyAll);
  if ($("bExportTxt")) $("bExportTxt").addEventListener("click", exportTxt);
}
