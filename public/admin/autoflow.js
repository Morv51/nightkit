// Auto-Flow (Beta) — je hochgeladenem Flyer automatisch 1 HAUPTFLYER + 6 VARIANTEN
// (7 Bilder), alle über die OpenAI-Bild-API (GPT Image). Nutzt NUR bestehende
// Routen (nichts neu gebaut): /admin/analyze (Stil-Anker + Haupt-Prompt, Sonnet),
// /admin/auto-variants (6 Varianten-Prompts aus demselben Anker, variiert in Farbe/
// Motiv/Layout), /admin/auto-generate (je Bild, mit Referenzbild als Stilanker,
// wort-entschärft, asynchron mit Polling = timeout-sicher). Ein blockiertes/
// fehlgeschlagenes Einzelbild bricht den Satz NICHT ab. Der produktive Ideogram-
// Befüllflow im Haupt-Tool bleibt unberührt.

import { post, getToken } from "./studioApi.js";
import { fileToDataUrl, downloadDataUrl, toJpeg, wireDropzoneMulti, wirePaste, notify } from "./studioUi.js";

const $ = (id) => document.getElementById(id);
const MODEL = "sonnet";     // Sprachmodell FEST auf Sonnet
const VARIANTS = 6;         // je Flyer 6 Varianten

let files = [];   // [{ name, dataUrl }]
let packs = [];   // [{ idx, label, kind:"main"|"variant", dataUrl, prompt, sentPrompt, status, image, ms, reason }]
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
    ? files.length + " Bild(er) gewählt — je Bild werden Hauptflyer + " + VARIANTS + " Varianten erzeugt"
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
  try { document.execCommand("copy"); done(); } catch { notify("Kopieren nicht möglich — bitte manuell markieren", "error"); }
  ta.remove();
}
function copyText(text, btn) {
  const restore = btn.textContent;
  const ok = () => { btn.textContent = "Kopiert ✓"; btn.classList.add("copied"); setTimeout(() => { btn.textContent = restore; btn.classList.remove("copied"); }, 1600); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok).catch(() => fallbackCopy(text, ok));
  else fallbackCopy(text, ok);
}

// ── Ein Paket (= ein Ergebnisbild): Kopf + Ergebnis + Prompt ──
function appendPack(p) {
  const card = document.createElement("div"); card.className = "batch-pack"; card.dataset.idx = p.idx;
  const head = document.createElement("div"); head.className = "batch-pack-head";
  const num = document.createElement("span"); num.className = "batch-pack-num"; num.textContent = p.label;
  const st = document.createElement("span"); st.className = "batch-status"; st.id = "afStatus" + p.idx; st.textContent = "wartet";
  head.appendChild(num); head.appendChild(st);
  const resCol = document.createElement("div"); resCol.className = "af-result-col"; resCol.id = "afRes" + p.idx;
  resCol.innerHTML = '<div class="af-res-wait">… wartet …</div>';
  const promptBox = document.createElement("div"); promptBox.className = "af-pack-prompt"; promptBox.id = "afPromptBox" + p.idx; promptBox.hidden = true;
  card.appendChild(head); card.appendChild(resCol); card.appendChild(promptBox);
  $("afList").appendChild(card);
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
  jpg.addEventListener("click", async () => { try { downloadDataUrl(await toJpeg(image), "auto-flow-" + idx + ".jpg"); } catch (e) { notify(e.message, "error"); } });
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
// GENAU den an die API gesendeten (entschärften) Prompt anzeigen + kopierbar.
function setPrompt(idx, prompt) {
  const box = $("afPromptBox" + idx);
  if (!box || !prompt) return;
  box.hidden = false; box.innerHTML = "";
  const label = document.createElement("div"); label.className = "af-pp-label"; label.textContent = "Verwendeter Prompt (exakt an die API gesendet)";
  const ta = document.createElement("textarea"); ta.className = "st-prompt af-pp-text"; ta.readOnly = true; ta.rows = 8; ta.value = prompt;
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "rbtn rbtn-ghost af-pp-copy"; btn.textContent = "📋 Prompt kopieren";
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

// ── Ein Bild generieren (Referenzbild als Stilanker + der Prompt des Pakets).
//    Fängt eigene Fehler ab → der Satz läuft immer weiter. ──
async function generatePack(p) {
  setStatus(p.idx, "running", "generiert …");
  const t0 = Date.now();
  try {
    const start = await post("/admin/auto-generate", { image: p.dataUrl, prompt: p.prompt });
    if (!start || !start.jobId) throw new Error("Kein Auftrag gestartet");
    p.sentPrompt = start.prompt || p.prompt;   // EXAKT der (entschärfte) Prompt
    setPrompt(p.idx, p.sentPrompt);            // sofort sichtbar (bleibt auch im Block-Fall)
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

function setPhase(text) { $("afProgress").textContent = text; }
function newPack(label, kind, dataUrl, prompt) {
  const p = { idx: packs.length + 1, label, kind, dataUrl, prompt, sentPrompt: "", status: "pending", image: "", ms: 0, reason: "" };
  packs.push(p); appendPack(p); return p;
}
function showSummary() {
  const mains = packs.filter((p) => p.kind === "main");
  const vars = packs.filter((p) => p.kind === "variant");
  const okVar = vars.filter((p) => p.status === "done").length;
  const okMain = mains.filter((p) => p.status === "done").length;
  const blocked = packs.filter((p) => p.status === "blocked").length;
  const err = packs.filter((p) => p.status === "error").length;
  let s;
  if (mains.length === 1) {
    const m = mains[0].status;
    s = "Hauptflyer " + (m === "done" ? "✓" : m === "blocked" ? "⚠ blockiert" : "✗ Fehler") +
      " + " + okVar + " von " + vars.length + " Varianten erfolgreich";
  } else {
    s = (okMain + okVar) + " von " + packs.length + " Bildern erfolgreich";
  }
  if (blocked) s += " · " + blocked + " blockiert";
  if (err) s += " · " + err + " Fehler";
  $("afSummary").textContent = s;
  $("afSummaryCard").hidden = false;
}

// ── Lauf: je Flyer Hauptflyer + 6 Varianten; nacheinander, robust ──
async function run() {
  if (running) return;
  if (!files.length) return notify("Erst Flyer hochladen", "info");
  running = true; $("afStart").disabled = true;
  packs = [];
  $("afList").innerHTML = "";
  $("afSummaryCard").hidden = true;
  const multi = files.length > 1;

  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    const pre = multi ? "Flyer " + (fi + 1) + " · " : "";
    const tag = multi ? "Flyer " + (fi + 1) + ": " : "";

    // 1) Stil-Analyse + Haupt-Prompt (Sonnet, mit Wort-Entschärfung serverseitig)
    const mainPack = newPack(pre + "Hauptflyer", "main", f.dataUrl, "");
    setStatus(mainPack.idx, "running", "Analyse + Prompt …");
    setPhase(tag + "Stil-Analyse + Prompt …");
    let dna, mainPrompt;
    try {
      const r = await post("/admin/analyze", { images: [f.dataUrl], refType: "single", model: MODEL });
      dna = r && r.dna; mainPrompt = r && r.prompt;
      if (!mainPrompt) throw new Error("Kein Prompt erhalten");
    } catch (e) {
      mainPack.status = "error"; mainPack.reason = e.message;
      setStatus(mainPack.idx, "error", "✗ Fehler"); setReason(mainPack.idx, false, e.message);
      continue; // Analyse gescheitert → dieser Flyer wird übersprungen
    }

    // 2) Haupt-Flyer generieren
    setPhase(tag + "Hauptflyer generieren …");
    mainPack.prompt = mainPrompt;
    await generatePack(mainPack);

    // 3) 6 Varianten-Prompts über den bestehenden Varianten-Generator
    setPhase(tag + "Varianten-Prompts …");
    let variants = [];
    try {
      const vr = await post("/admin/auto-variants", { dna, count: VARIANTS, refType: "single", model: MODEL });
      variants = (vr && vr.variants) || [];
    } catch (e) {
      notify(tag + "Varianten-Prompts fehlgeschlagen: " + e.message, "error");
    }

    // 4) Jede Variante generieren (Referenzbild als Stilanker mit)
    for (let vi = 0; vi < variants.length; vi++) {
      const lab = variants[vi].label ? " — " + variants[vi].label : "";
      const vp = newPack(pre + "Variante " + (vi + 1) + lab, "variant", f.dataUrl, variants[vi].prompt);
      setPhase(tag + "generiere Variante " + (vi + 1) + " von " + variants.length + " …");
      await generatePack(vp);
    }
  }

  setPhase("");
  showSummary();
  running = false; $("afStart").disabled = false;
  notify("Auto-Flow fertig", "success");
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
}
