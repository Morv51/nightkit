// Auto-Flow (Beta) — Flyer-Erstellung über die OpenAI-Bild-API (GPT Image), EINZIGE
// Engine. Sprachmodell fest = Sonnet. Ein ODER mehrere Bilder: je Bild Analyse +
// Prompt (bestehende Modus-2-Route, nur aufgerufen) → asynchrone OpenAI-Generierung
// mit Polling (timeout-sicher, kein 502). Ein blockiertes/fehlerhaftes Bild bricht
// den Stapel NICHT ab — es wird übersprungen; am Ende die Erfolgsquote. Der
// produktive Ideogram-Befüllflow im Haupt-Tool bleibt unberührt.

import { post, getToken } from "./studioApi.js";
import { fileToDataUrl, downloadDataUrl, toJpeg, wireDropzoneMulti, wirePaste, notify } from "./studioUi.js";

const $ = (id) => document.getElementById(id);
const MODEL = "sonnet"; // Sprachmodell FEST auf Sonnet

let files = [];   // [{ name, dataUrl }]
let packs = [];   // [{ idx, dataUrl, status, image, ms, reason }]
let running = false;

// ── Upload (ein oder mehrere) ────────────────────────────────────
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
    ? files.length + " Bild(er) gewählt — weitere hinzufügen oder unten starten"
    : "Flyer hierher ziehen, einfügen (⌘/Ctrl+V) oder klicken — ein oder mehrere · PNG/JPG/WebP, ≤10 MB je Bild";
}

// Inhaltliche Ablehnung ("blockiert") von technischem Fehler unterscheiden.
function isBlocked(msg) {
  return /safety|moderation|content.?polic|rejected|blocked|\[sexual\]|not allowed|violat/i.test(msg || "");
}

// ── Pakete (ein Block je Bild: Original + Ergebnis, gleiche Nummer) ──
function renderPacks() {
  const list = $("afList"); list.innerHTML = "";
  packs.forEach((p) => list.appendChild(packCard(p)));
}
function packCard(p) {
  const card = document.createElement("div"); card.className = "batch-pack"; card.dataset.idx = p.idx;
  const head = document.createElement("div"); head.className = "batch-pack-head";
  head.innerHTML = '<span class="batch-pack-num">Flyer ' + p.idx +
    '</span><span class="batch-status" id="afStatus' + p.idx + '">wartet</span>';
  const bodyEl = document.createElement("div"); bodyEl.className = "batch-pack-body";
  const orig = document.createElement("div"); orig.className = "batch-pack-img";
  const oi = document.createElement("img"); oi.src = p.dataUrl; oi.alt = "Original " + p.idx;
  orig.appendChild(oi);
  const resCol = document.createElement("div"); resCol.className = "batch-pack-prompt"; resCol.id = "afRes" + p.idx;
  resCol.innerHTML = '<div class="af-res-wait">… wartet …</div>';
  bodyEl.appendChild(orig); bodyEl.appendChild(resCol);
  const promptBox = document.createElement("div");
  promptBox.className = "af-pack-prompt"; promptBox.id = "afPromptBox" + p.idx; promptBox.hidden = true;
  card.appendChild(head); card.appendChild(bodyEl); card.appendChild(promptBox);
  return card;
}
function setStatus(idx, state, text) {
  const el = $("afStatus" + idx);
  const card = document.querySelector('.batch-pack[data-idx="' + idx + '"]');
  if (el) el.textContent = text;
  if (card) { card.classList.remove("running", "done", "error", "blocked"); if (state) card.classList.add(state); }
}
function setResult(idx, image, secs) {
  const col = $("afRes" + idx); if (!col) return;
  col.innerHTML = "";
  const img = document.createElement("img"); img.className = "af-result-img"; img.src = image; img.alt = "Ergebnis " + idx;
  const row = document.createElement("div"); row.className = "prompt-actions";
  const png = document.createElement("button"); png.type = "button"; png.className = "rbtn rbtn-primary"; png.textContent = "⬇ PNG";
  png.addEventListener("click", () => downloadDataUrl(image, "auto-flow-" + idx + ".png"));
  const jpg = document.createElement("button"); jpg.type = "button"; jpg.className = "rbtn rbtn-ghost"; jpg.textContent = "⬇ JPG";
  jpg.addEventListener("click", async () => {
    try { downloadDataUrl(await toJpeg(image), "auto-flow-" + idx + ".jpg"); }
    catch (e) { notify(e.message, "error"); }
  });
  const t = document.createElement("div"); t.className = "af-time"; t.textContent = "· generiert in " + secs + " s";
  row.appendChild(png); row.appendChild(jpg);
  col.appendChild(img); col.appendChild(row); col.appendChild(t);
}
function setReason(idx, blocked, reason) {
  const col = $("afRes" + idx); if (!col) return;
  col.innerHTML = "";
  const box = document.createElement("div"); box.className = blocked ? "af-blocked" : "af-error";
  box.textContent = (blocked ? "⚠ Blockiert (Inhaltsfilter): " : "✗ Fehler: ") + reason;
  col.appendChild(box);
}

// Kopieren + kurze "Kopiert ✓"-Bestätigung.
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand("copy"); done(); } catch { notify("Kopieren nicht möglich — bitte manuell markieren", "error"); }
  ta.remove();
}
function copyText(text, btn) {
  const restore = btn.textContent;
  const ok = () => { btn.textContent = "Kopiert ✓"; btn.classList.add("copied"); setTimeout(() => { btn.textContent = restore; btn.classList.remove("copied"); }, 1600); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok).catch(() => fallbackCopy(text, ok));
  else fallbackCopy(text, ok);
}

// GENAU den an die API gesendeten (entschärften) Prompt anzeigen + kopierbar —
// vollständig (Textfeld, scrollbar, nicht abgeschnitten), auch im Block-Fall.
function setPrompt(idx, prompt) {
  const box = $("afPromptBox" + idx);
  if (!box || !prompt) return;
  box.hidden = false;
  box.innerHTML = "";
  const label = document.createElement("div");
  label.className = "af-pp-label"; label.textContent = "Verwendeter Prompt (exakt an die API gesendet)";
  const ta = document.createElement("textarea");
  ta.className = "st-prompt af-pp-text"; ta.readOnly = true; ta.rows = 10; ta.value = prompt;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "rbtn rbtn-ghost af-pp-copy"; btn.textContent = "📋 Prompt kopieren";
  btn.addEventListener("click", () => copyText(prompt, btn));
  box.appendChild(label); box.appendChild(ta); box.appendChild(btn);
}

// ── Asynchrone Generierung pollen (timeout-sicher) ──
async function pollJob(jobId, startedAt, idx) {
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
    setStatus(idx, "running", "generiert … (" + Math.round((Date.now() - startedAt) / 1000) + " s)");
  }
  throw new Error("Zeitüberschreitung — über 6 Minuten gedauert.");
}

// ── Ein Flyer: Analyse → Prompt → Generierung. Fängt eigene Fehler ab. ──
async function processOne(p) {
  setStatus(p.idx, "running", "Analyse + Prompt …");
  let prompt;
  try {
    const r = await post("/admin/analyze", { images: [p.dataUrl], refType: "single", model: MODEL });
    prompt = r && r.prompt;
    if (!prompt) throw new Error("Kein Prompt erhalten");
  } catch (e) {
    p.status = "error"; p.reason = e.message;
    setStatus(p.idx, "error", "✗ Fehler"); setReason(p.idx, false, e.message);
    return;
  }
  setStatus(p.idx, "running", "generiert …");
  const t0 = Date.now();
  try {
    const start = await post("/admin/auto-generate", { image: p.dataUrl, prompt });
    if (!start || !start.jobId) throw new Error("Kein Auftrag gestartet");
    p.sentPrompt = start.prompt || prompt;   // EXAKT der (entschärfte) Prompt, der an die API ging
    setPrompt(p.idx, p.sentPrompt);          // sofort sichtbar — bleibt auch, wenn danach blockiert wird
    const job = await pollJob(start.jobId, t0, p.idx);
    if (!job.image) throw new Error("Kein Bild erhalten");
    const secs = job.ms ? Math.round(job.ms / 1000) : Math.round((Date.now() - t0) / 1000);
    p.status = "done"; p.image = job.image; p.ms = secs;
    setStatus(p.idx, "done", "✓ fertig in " + secs + " s"); setResult(p.idx, job.image, secs);
  } catch (e) {
    const blocked = isBlocked(e.message);
    p.status = blocked ? "blocked" : "error"; p.reason = e.message;
    setStatus(p.idx, blocked ? "blocked" : "error", blocked ? "⚠ blockiert" : "✗ Fehler");
    setReason(p.idx, blocked, e.message);
  }
}

function updateProgress(done, total) { $("afProgress").textContent = done + " von " + total + " verarbeitet"; }
function showSummary() {
  const ok = packs.filter((p) => p.status === "done").length;
  const blocked = packs.filter((p) => p.status === "blocked").length;
  const err = packs.filter((p) => p.status === "error").length;
  let s = ok + " von " + packs.length + " erfolgreich";
  if (blocked) s += " · " + blocked + " blockiert";
  if (err) s += " · " + err + " Fehler";
  $("afSummary").textContent = s;
  $("afSummaryCard").hidden = false;
}

// ── Lauf: nacheinander; ein blockiertes/fehlerhaftes Bild bricht NICHT ab ──
async function run() {
  if (running) return;
  if (!files.length) return notify("Erst Flyer hochladen", "info");
  running = true; $("afStart").disabled = true;
  packs = files.map((f, i) => ({ idx: i + 1, dataUrl: f.dataUrl, status: "pending", image: "", ms: 0, reason: "" }));
  renderPacks();
  $("afSummaryCard").hidden = true;
  const total = packs.length; let done = 0;
  updateProgress(0, total);
  for (const p of packs) {
    await processOne(p); // fängt Fehler selbst ab → Schleife läuft weiter
    done++; updateProgress(done, total);
  }
  showSummary();
  running = false; $("afStart").disabled = false;
  notify("Auto-Flow fertig", "success");
}

export function initAutoflow() {
  const file = $("afFile");
  if (file) file.addEventListener("change", () => {
    const picked = Array.from(file.files); // synchron kopieren, DANN value leeren
    file.value = "";
    if (picked.length) addFiles(picked);
  });
  wireDropzoneMulti($("afDrop"), addFiles);
  wirePaste($("panel-auto"), (f) => addFiles([f]));
  if ($("afStart")) $("afStart").addEventListener("click", run);
}
