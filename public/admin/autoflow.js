// Auto-Flow (Beta) — je hochgeladenem Flyer 1 HAUPTFLYER + 6 VARIANTEN, kompakt als
// EINE ZEILE mit kleinen Vorschaubildern. Klick = Lightbox. Prompt nur per Kopier-
// Button (exakt gesendeter Prompt). Download: je Bild, je Zeile als ZIP, alles als
// ZIP. Nutzt NUR bestehende Routen (analyze / auto-variants / auto-generate) —
// keine Änderung an Prompt-/Generierungslogik. Ideogram-Befüllflow unberührt.

import { post, getToken } from "./studioApi.js";
import { fileToDataUrl, downloadDataUrl, wireDropzoneMulti, wirePaste, notify } from "./studioUi.js";

const $ = (id) => document.getElementById(id);
const MODEL = "sonnet";
const VARIANTS = 9;

let files = [];   // [{ name, dataUrl }]
let rows = [];    // [{ idx, fnum, prefix, dataUrl, tiles:[tile] }]
let running = false;

// ── Upload ───────────────────────────────────────────────────────
async function addFiles(fileList) {
  for (const f of fileList) {
    try { files.push({ name: f.name || "flyer", dataUrl: await fileToDataUrl(f) }); }
    catch (e) { notify(e.message, "error"); }
  }
  renderThumbs();
}
function renderThumbs() {
  const row = $("afThumbs");
  row.innerHTML = "";
  files.forEach((f, i) => {
    const t = document.createElement("div"); t.className = "batch-thumb";
    const img = document.createElement("img"); img.src = f.dataUrl; img.alt = "";
    const x = document.createElement("button");
    x.type = "button"; x.className = "batch-thumb-x"; x.textContent = "✕"; x.title = "Entfernen";
    x.addEventListener("click", () => { if (!running) { files.splice(i, 1); renderThumbs(); } });
    t.appendChild(img); t.appendChild(x); row.appendChild(t);
  });
  row.hidden = !files.length;
  $("afDropLabel").textContent = files.length
    ? files.length + " Bild(er) gewählt — je Bild Hauptflyer + " + VARIANTS + " Varianten"
    : "Flyer hierher ziehen, einfügen (⌘/Ctrl+V) oder klicken — ein oder mehrere · PNG/JPG/WebP, ≤10 MB je Bild";
}

function isBlocked(msg) {
  return /safety|moderation|content.?polic|rejected|blocked|\[sexual\]|not allowed|violat/i.test(msg || "");
}

// ── Kopieren (+ "Kopiert ✓") ──
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand("copy"); done(); } catch { notify("Kopieren nicht möglich", "error"); }
  ta.remove();
}
function copyText(text, btn) {
  if (!text) return notify("Kein Prompt vorhanden", "info");
  const restore = btn.textContent;
  const ok = () => { btn.textContent = "Kopiert ✓"; btn.classList.add("copied"); setTimeout(() => { btn.textContent = restore; btn.classList.remove("copied"); }, 1600); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok).catch(() => fallbackCopy(text, ok));
  else fallbackCopy(text, ok);
}

// ── ZIP (STORE, ohne Kompression — PNGs sind bereits komprimiert) ──
function dataUrlToBytes(dataUrl) {
  const b64 = (dataUrl || "").split(",")[1] || "";
  const bin = atob(b64); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(entries) { // entries: [{ name, bytes }]
  const enc = new TextEncoder();
  const chunks = []; const central = []; let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name); const data = e.bytes; const crc = crc32(data); const size = data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, nameBytes.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer)); chunks.push(nameBytes); chunks.push(data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, 0, true); cd.setUint16(14, 0, true); cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true); cd.setUint16(34, 0, true); cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
    central.push({ header: new Uint8Array(cd.buffer), name: nameBytes });
    offset += 30 + nameBytes.length + size;
  }
  const centralStart = offset; let centralSize = 0;
  for (const c of central) { chunks.push(c.header); chunks.push(c.name); centralSize += c.header.length + c.name.length; }
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); eo.setUint16(4, 0, true); eo.setUint16(6, 0, true);
  eo.setUint16(8, central.length, true); eo.setUint16(10, central.length, true); eo.setUint32(12, centralSize, true); eo.setUint32(16, centralStart, true); eo.setUint16(20, 0, true);
  chunks.push(new Uint8Array(eo.buffer));
  return new Blob(chunks, { type: "application/zip" });
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Lightbox ─────────────────────────────────────────────────────
function ensureLightbox() {
  if ($("afLightbox")) return;
  const ov = document.createElement("div"); ov.id = "afLightbox"; ov.className = "af-lightbox"; ov.hidden = true;
  const inner = document.createElement("div"); inner.className = "af-lb-inner";
  const close = document.createElement("button"); close.className = "af-lb-close"; close.title = "Schließen"; close.textContent = "✕";
  const img = document.createElement("img"); img.className = "af-lb-img"; img.alt = "";
  const bar = document.createElement("div"); bar.className = "af-lb-bar";
  inner.appendChild(close); inner.appendChild(img); inner.appendChild(bar); ov.appendChild(inner);
  ov.addEventListener("click", (e) => { if (e.target === ov) closeLightbox(); });
  close.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });
  document.body.appendChild(ov);
}
function openLightbox(tile) {
  ensureLightbox();
  const ov = $("afLightbox");
  ov.querySelector(".af-lb-img").src = tile.image;
  const bar = ov.querySelector(".af-lb-bar"); bar.innerHTML = "";
  const lab = document.createElement("span"); lab.className = "af-lb-label"; lab.textContent = tile.label; bar.appendChild(lab);
  const dl = document.createElement("button"); dl.className = "rbtn rbtn-primary"; dl.textContent = "⬇ Herunterladen"; dl.addEventListener("click", () => downloadTile(tile)); bar.appendChild(dl);
  const cp = document.createElement("button"); cp.className = "rbtn rbtn-ghost"; cp.textContent = "📋 Prompt kopieren"; cp.addEventListener("click", () => copyText(tile.sentPrompt, cp)); bar.appendChild(cp);
  ov.hidden = false;
}
function closeLightbox() { const ov = $("afLightbox"); if (ov) ov.hidden = true; }

// ── Kacheln ──────────────────────────────────────────────────────
function tileFilename(t) { return t.kind === "main" ? "hauptflyer.png" : "variante-" + t.num + ".png"; }
function downloadTile(t) { if (t.image) downloadDataUrl(t.image, "flyer-" + t.fnum + "-" + tileFilename(t)); }
function iconBtn(icon, title, onClick) {
  const b = document.createElement("button"); b.type = "button"; b.className = "af-icon-btn"; b.title = title; b.textContent = icon;
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(b); });
  return b;
}
function tileDom(t) {
  const el = document.createElement("div"); el.id = t.domId; el.className = "af-tile " + t.status;
  renderTileInner(el, t);
  return el;
}
function renderTileInner(el, t) {
  el.className = "af-tile " + t.status;
  el.innerHTML = "";
  const badge = document.createElement("div"); badge.className = "af-tile-badge" + (t.kind === "main" ? " main" : "");
  badge.textContent = t.badge; el.appendChild(badge);
  if (t.status === "done" && t.image) {
    const img = document.createElement("img"); img.className = "af-tile-img"; img.src = t.image; img.alt = t.label; img.title = "Zum Vergrößern klicken";
    img.addEventListener("click", () => openLightbox(t)); el.appendChild(img);
    const acts = document.createElement("div"); acts.className = "af-tile-acts";
    acts.appendChild(iconBtn("⬇", "Herunterladen", () => downloadTile(t)));
    acts.appendChild(iconBtn("📋", "Prompt kopieren", (b) => copyText(t.sentPrompt, b)));
    el.appendChild(acts);
  } else if (t.status === "blocked" || t.status === "error") {
    const mk = document.createElement("div"); mk.className = "af-tile-mark"; mk.title = t.reason || "";
    mk.textContent = t.status === "blocked" ? "⚠ blockiert" : "✗ Fehler"; el.appendChild(mk);
    if (t.sentPrompt) { const acts = document.createElement("div"); acts.className = "af-tile-acts"; acts.appendChild(iconBtn("📋", "Prompt kopieren", (b) => copyText(t.sentPrompt, b))); el.appendChild(acts); }
  } else {
    const ph = document.createElement("div"); ph.className = "af-tile-ph"; ph.textContent = t.status === "running" ? "…" : ""; el.appendChild(ph);
  }
}
function updateTile(t) { const el = $(t.domId); if (el) renderTileInner(el, t); }

// ── Zeilen ───────────────────────────────────────────────────────
function appendRow(row) {
  const el = document.createElement("div"); el.className = "af-row"; el.id = "afRow" + row.idx;
  const head = document.createElement("div"); head.className = "af-row-head";
  const title = document.createElement("span"); title.className = "af-row-title"; title.textContent = row.prefix;
  const stat = document.createElement("span"); stat.className = "af-row-stat"; stat.id = "afRowStat" + row.idx; stat.textContent = "…";
  const zip = document.createElement("button"); zip.type = "button"; zip.className = "rbtn rbtn-ghost af-row-zip"; zip.id = "afRowZip" + row.idx; zip.textContent = "⬇ Alle als ZIP"; zip.disabled = true;
  zip.addEventListener("click", () => zipRow(row));
  head.appendChild(title); head.appendChild(stat); head.appendChild(zip);
  const strip = document.createElement("div"); strip.className = "af-row-strip";
  for (const t of row.tiles) strip.appendChild(tileDom(t));
  el.appendChild(head); el.appendChild(strip);
  $("afList").appendChild(el);
}
function setRowStat(row, text) { const el = $("afRowStat" + row.idx); if (el) el.textContent = text; }
function updateRow(row) {
  const done = row.tiles.filter((t) => t.status === "done").length;
  const blocked = row.tiles.filter((t) => t.status === "blocked").length;
  const err = row.tiles.filter((t) => t.status === "error").length;
  let s = done + " / " + row.tiles.length + " fertig";
  if (blocked) s += " · " + blocked + " blockiert";
  if (err) s += " · " + err + " Fehler";
  setRowStat(row, s);
  const zip = $("afRowZip" + row.idx); if (zip) zip.disabled = done === 0;
}
function zipRow(row) {
  const done = row.tiles.filter((t) => t.status === "done" && t.image);
  if (!done.length) return notify("Keine fertigen Bilder in dieser Zeile", "info");
  downloadBlob(makeZip(done.map((t) => ({ name: tileFilename(t), bytes: dataUrlToBytes(t.image) }))), "flyer-" + row.fnum + ".zip");
}
function zipAll() {
  const entries = [];
  for (const row of rows) for (const t of row.tiles) if (t.status === "done" && t.image)
    entries.push({ name: "flyer-" + row.fnum + "/" + tileFilename(t), bytes: dataUrlToBytes(t.image) });
  if (!entries.length) return notify("Noch keine fertigen Bilder", "info");
  downloadBlob(makeZip(entries), "auto-flow-alle.zip");
}

// ── Übersicht (oben) + Fortschritts-Phase ──
function setPhase(text) { $("afProgress").textContent = text; }
function updateOverview() {
  const all = rows.reduce((a, r) => a.concat(r.tiles), []);
  const done = all.filter((t) => t.status === "done").length;
  const blocked = all.filter((t) => t.status === "blocked").length;
  const err = all.filter((t) => t.status === "error").length;
  let s = rows.length + " Flyer · " + all.length + " Bilder · " + done + " fertig";
  if (blocked) s += " · " + blocked + " blockiert";
  if (err) s += " · " + err + " Fehler";
  $("afSummary").textContent = s;
  $("afSummaryCard").hidden = false;
  const za = $("afZipAll"); if (za) za.disabled = done === 0;
}

// ── Poll (timeout-sicher) ──
async function pollJob(jobId) {
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    let res;
    try { res = await fetch("/admin/auto-generate/" + encodeURIComponent(jobId), { headers: { "X-Admin-Token": getToken() } }); }
    catch { continue; }
    const job = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error(job.error || "Auftrag nicht mehr gefunden");
    if (!res.ok) throw new Error(job.error || ("HTTP " + res.status));
    if (job.status === "done") return job;
    if (job.status === "error") throw new Error(job.error || "Generierung fehlgeschlagen");
  }
  throw new Error("Zeitüberschreitung — über 6 Minuten gedauert.");
}

// ── Ein Bild generieren (Referenzbild als Stilanker + Prompt der Kachel) ──
async function genTile(row, tile) {
  tile.status = "running"; updateTile(tile);
  const t0 = Date.now();
  try {
    const start = await post("/admin/auto-generate", { image: row.dataUrl, prompt: tile.prompt });
    if (!start || !start.jobId) throw new Error("Kein Auftrag gestartet");
    tile.sentPrompt = start.prompt || tile.prompt;
    const job = await pollJob(start.jobId);
    if (!job.image) throw new Error("Kein Bild erhalten");
    tile.status = "done"; tile.image = job.image; tile.ms = job.ms ? Math.round(job.ms / 1000) : Math.round((Date.now() - t0) / 1000);
  } catch (e) {
    tile.status = isBlocked(e.message) ? "blocked" : "error"; tile.reason = e.message;
  }
  updateTile(tile);
}

function mkTile(rowIdx, fnum, num, kind, badge) {
  return {
    domId: "af_t_" + rowIdx + "_" + num, fnum, num, kind, badge,
    label: (kind === "main" ? "Hauptflyer" : "Variante " + num) + " · Flyer " + fnum,
    prompt: "", sentPrompt: "", status: "pending", image: "", ms: 0, reason: "",
  };
}

// ── Lauf: je Flyer eine Zeile, Hauptflyer + 6 Varianten; robust ──
async function run() {
  if (running) return;
  if (!files.length) return notify("Erst Flyer hochladen", "info");
  running = true; $("afStart").disabled = true;
  rows = []; $("afList").innerHTML = ""; ensureLightbox();
  $("afSummaryCard").hidden = false;
  const multi = files.length > 1;
  const N = files.length;
  const TOTAL = 1 + VARIANTS; // Hauptflyer + Varianten = 10 Bilder je Flyer

  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi]; const fnum = fi + 1;
    const rowIdx = rows.length;
    const row = { idx: rowIdx, fnum, prefix: multi ? "Flyer " + fnum : "Flyer", dataUrl: f.dataUrl, tiles: [] };
    row.tiles.push(mkTile(rowIdx, fnum, 0, "main", "Haupt"));
    for (let k = 1; k <= VARIANTS; k++) row.tiles.push(mkTile(rowIdx, fnum, k, "variant", String(k)));
    rows.push(row); appendRow(row); updateOverview();
    const tag = multi ? "Flyer " + fnum + " von " + N + " · " : "";

    // 1) Analyse + Haupt-Prompt (Sonnet)
    setPhase(tag + "Stil-Analyse + Prompt …"); setRowStat(row, "Analyse …");
    let dna, mainPrompt;
    try {
      const r = await post("/admin/analyze", { images: [f.dataUrl], refType: "single", model: MODEL });
      dna = r && r.dna; mainPrompt = r && r.prompt; if (!mainPrompt) throw new Error("Kein Prompt erhalten");
    } catch (e) {
      for (const t of row.tiles) { t.status = "error"; t.reason = e.message; updateTile(t); }
      setRowStat(row, "✗ Analyse fehlgeschlagen"); updateOverview(); continue;
    }

    // 2) Hauptflyer
    row.tiles[0].prompt = mainPrompt;
    setPhase(tag + "generiere Bild 1 von " + TOTAL + " (Hauptflyer) …");
    await genTile(row, row.tiles[0]); updateRow(row); updateOverview();

    // 3) 6 Varianten-Prompts (bestehender Generator)
    setPhase(tag + "Varianten-Prompts …");
    let variants = [];
    try { const vr = await post("/admin/auto-variants", { dna, count: VARIANTS, refType: "single", model: MODEL }); variants = (vr && vr.variants) || []; }
    catch (e) { notify(tag + "Varianten-Prompts fehlgeschlagen: " + e.message, "error"); }

    // 4) Varianten generieren
    for (let k = 0; k < VARIANTS; k++) {
      const t = row.tiles[k + 1];
      if (!variants[k]) { t.status = "error"; t.reason = "Keine Variante erzeugt"; updateTile(t); updateRow(row); updateOverview(); continue; }
      t.prompt = variants[k].prompt;
      setPhase(tag + "generiere Bild " + (k + 2) + " von " + TOTAL + " (Variante " + (k + 1) + ") …");
      await genTile(row, t); updateRow(row); updateOverview();
    }
    updateRow(row);
  }

  setPhase(""); running = false; $("afStart").disabled = false;
  updateOverview(); notify("Auto-Flow fertig", "success");
}

export function initAutoflow() {
  const file = $("afFile");
  if (file) file.addEventListener("change", () => {
    const picked = Array.from(file.files); file.value = "";
    if (picked.length) addFiles(picked);
  });
  wireDropzoneMulti($("afDrop"), addFiles);
  wirePaste($("panel-auto"), (f) => addFiles([f]));
  if ($("afStart")) $("afStart").addEventListener("click", run);
  if ($("afZipAll")) $("afZipAll").addEventListener("click", zipAll);
}
