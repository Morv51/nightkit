import { state } from "./state.js";
import { $, els, on } from "./dom.js";
import { postCorrect } from "./api.js";
import { addToHistory } from "./history.js";

// Korrektur-Modus (Inpainting): der User malt mit einem Pinsel über
// fehlerhafte Stellen des generierten Flyers; die markierten Bereiche werden
// per Ideogram V3 Edit entfernt oder ersetzt, der Rest bleibt unverändert.
//
// Maskenkonvention laut Ideogram-Doku: SCHWARZE Pixel werden neu generiert,
// WEISSE Pixel bleiben erhalten — die Maske wird daher mit weißem Hintergrund
// und schwarzen Strichen aufgebaut.
//
// Das Mal-Canvas läuft intern in der nativen Bildauflösung und wird per CSS
// auf die Anzeigegröße skaliert; Koordinaten werden pro Event umgerechnet,
// damit Markierung und Maske auch bei responsiver Skalierung deckungsgleich
// bleiben.

const BRUSH_FRACTIONS = [0.022, 0.045, 0.085]; // Radius als Anteil der Bildbreite
const MAX_UPLOAD = 9.5 * 1024 * 1024;          // Ideogram-Limit: 10MB pro Datei

let strokes = [];     // [{ r, pts: [[x,y], …] }] in nativen Bildpixeln
let drawing = null;   // aktiver Strich während eines Pointer-Drags
let busy = false;
let showingPrev = false;

let canvas, ctx, frame, flyerCol, cursorEl, busyEl;
let toastEl, toastMsg, toastRetry;

function isActive() {
  return frame && frame.classList.contains("correcting");
}

function brushRadius() {
  const idx = Math.max(0, Math.min(2, Number($("correctSize").value) || 0));
  return Math.max(4, canvas.width * BRUSH_FRACTIONS[idx]);
}

function toNative(e) {
  const rect = canvas.getBoundingClientRect();
  return [
    (e.clientX - rect.left) * (canvas.width / rect.width),
    (e.clientY - rect.top) * (canvas.height / rect.height),
  ];
}

function drawStrokes(c, color) {
  c.fillStyle = color;
  c.strokeStyle = color;
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const s of strokes) {
    if (s.pts.length === 1) {
      c.beginPath();
      c.arc(s.pts[0][0], s.pts[0][1], s.r, 0, Math.PI * 2);
      c.fill();
      continue;
    }
    c.lineWidth = s.r * 2;
    c.beginPath();
    c.moveTo(s.pts[0][0], s.pts[0][1]);
    for (let i = 1; i < s.pts.length; i++) c.lineTo(s.pts[i][0], s.pts[i][1]);
    c.stroke();
  }
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawStrokes(ctx, "#CCFF00"); // deckend gemalt; das Canvas selbst steht auf 45%
}

// ── Cursor-Ring (Pinsel-Vorschau) ────────────────────────────────
function moveCursor(e) {
  const rect = canvas.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const d = brushRadius() * 2 * (rect.width / canvas.width);
  cursorEl.style.width = d + "px";
  cursorEl.style.height = d + "px";
  cursorEl.style.left = (e.clientX - frameRect.left) + "px";
  cursorEl.style.top = (e.clientY - frameRect.top) + "px";
  cursorEl.style.display = "block";
}

// ── Modus betreten / verlassen ───────────────────────────────────
function enterMode() {
  if (busy || !state.last) return;
  const img = els.resultImg;
  if (!img.complete || !img.naturalWidth) {
    // Bild dekodiert noch (z.B. direkt nach Versions-Wechsel) → nachholen
    img.addEventListener("load", enterMode, { once: true });
    return;
  }

  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  strokes = [];
  drawing = null;
  redraw();

  frame.classList.add("correcting");
  flyerCol.classList.add("correct-mode");
  hideToast();
}

function exitMode() {
  frame.classList.remove("correcting");
  flyerCol.classList.remove("correct-mode");
  cursorEl.style.display = "none";
  strokes = [];
  drawing = null;
  updatePrevLink();
  hideToast();
}

// Beim Wechsel auf ein neues Generierungs-Ergebnis: Modus + Verlauf der
// Korrektur zurücksetzen (der "Vorherige Version"-Schritt gehört zum alten Flyer).
export function resetCorrectState() {
  state.correctPrev = null;
  state.correctPrevImg = null;
  showingPrev = false;
  if (isActive()) exitMode(); else updatePrevLink();
}

// ── Vorherige Version (ein Schritt zurück) ───────────────────────
function updatePrevLink() {
  const link = $("correctPrevLink");
  if (!link) return;
  if (!state.correctPrev || isActive()) {
    link.style.display = "none";
    return;
  }
  link.textContent = showingPrev ? "↪ Korrigierte Version" : "↩ Vorherige Version";
  link.style.display = "block";
}

function togglePrev(e) {
  e.preventDefault();
  if (busy || !state.correctPrev) return;
  [state.last, state.correctPrev] = [state.correctPrev, state.last];
  [state.lastImg, state.correctPrevImg] = [state.correctPrevImg, state.lastImg];
  els.resultImg.src = state.last;
  showingPrev = !showingPrev;
  updatePrevLink();
}

// ── Toast (Fehler mit Retry) ─────────────────────────────────────
function showToast(msg, withRetry) {
  toastMsg.textContent = msg;
  toastRetry.style.display = withRetry ? "" : "none";
  toastEl.classList.add("on");
}

function hideToast() {
  toastEl.classList.remove("on");
}

// ── Maske + Bild-Payload ─────────────────────────────────────────
function buildMaskDataUrl() {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  const mctx = c.getContext("2d");
  mctx.fillStyle = "#FFFFFF"; // weiß = unverändert lassen
  mctx.fillRect(0, 0, c.width, c.height);
  drawStrokes(mctx, "#000000"); // schwarz = neu generieren
  return c.toDataURL("image/png");
}

function blobToDataUrl(blob) {
  if (blob.size > MAX_UPLOAD) {
    throw new Error("Das Bild ist zu groß für die Korrektur (max. 10 MB).");
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    r.readAsDataURL(blob);
  });
}

async function currentImageDataUrl() {
  return blobToDataUrl(await (await fetch(state.last)).blob());
}

// Entfernen-Härtung: vor dem Senden die maskierten Flächen im Bild mit der
// Durchschnittsfarbe der direkt angrenzenden Randpixel füllen. Ideogram sieht
// dort dann schon eine neutrale Fläche statt des alten Texts, was das
// Neu-Erfinden von Text in der Leerfläche deutlich reduziert.
async function neutralizedImageDataUrl() {
  const W = canvas.width, H = canvas.height;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const cx = c.getContext("2d");
  cx.drawImage(els.resultImg, 0, 0, W, H);

  // Maske als Alphakanal (gleiche Strich-Geometrie wie die gesendete Maske)
  const mc = document.createElement("canvas");
  mc.width = W; mc.height = H;
  const mx = mc.getContext("2d");
  drawStrokes(mx, "#000000");
  const mask = mx.getImageData(0, 0, W, H).data;
  const masked = (i) => mask[i * 4 + 3] > 127;

  const id = cx.getImageData(0, 0, W, H);
  const d = id.data;

  // Durchschnittsfarbe der Randpixel (unmaskiert mit maskiertem 4er-Nachbarn)
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (masked(i)) continue;
      if ((x > 0 && masked(i - 1)) || (x < W - 1 && masked(i + 1)) ||
          (y > 0 && masked(i - W)) || (y < H - 1 && masked(i + W))) {
        r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; n++;
      }
    }
  }
  if (n) {
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    for (let i = 0; i < W * H; i++) {
      if (masked(i)) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
    }
    cx.putImageData(id, 0, 0);
  }

  let blob = await new Promise((res) => c.toBlob(res, "image/png"));
  if (blob && blob.size > MAX_UPLOAD) {
    blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.92));
  }
  if (!blob) throw new Error("Bild konnte nicht exportiert werden.");
  return blobToDataUrl(blob);
}

// ── Korrektur anwenden ───────────────────────────────────────────
function setBusy(b) {
  busy = b;
  busyEl.classList.toggle("on", b);
  $("correctApply").disabled = b;
}

async function apply() {
  if (busy || !isActive()) return;
  if (!strokes.length) {
    showToast("Bitte markiere zuerst mindestens einen Bereich auf dem Flyer.", false);
    return;
  }
  hideToast();
  setBusy(true);
  try {
    const instruction = $("correctInstruction").value.trim();
    const corrected = await postCorrect({
      // Beim Entfernen (keine Anweisung) die markierten Flächen vorab
      // neutralisieren; beim Ersetzen das Original unverändert mitschicken.
      image: instruction ? await currentImageDataUrl() : await neutralizedImageDataUrl(),
      mask: buildMaskDataUrl(),
      instruction,
    });

    // Alte Version für einen Schritt zurück behalten, dann übernehmen:
    // Downloads, Kopieren und Video nutzen ab jetzt das korrigierte Bild.
    state.correctPrev = state.last;
    state.correctPrevImg = state.lastImg;
    showingPrev = false;
    state.last = corrected;
    state.lastImg = new Image();
    state.lastImg.crossOrigin = "anonymous";
    state.lastImg.src = corrected;
    els.resultImg.src = corrected;
    addToHistory(corrected);

    $("correctInstruction").value = "";
    exitMode();
  } catch (e) {
    showToast(e.message || "Korrektur fehlgeschlagen.", true); // Striche bleiben für Retry erhalten
  } finally {
    setBusy(false);
  }
}

// ── Malen (Pointer Events: Maus + Touch + Stift) ─────────────────
function onPointerDown(e) {
  if (busy) return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  drawing = { r: brushRadius(), pts: [toNative(e)] };
  strokes.push(drawing);
  redraw();
  moveCursor(e);
}

function onPointerMove(e) {
  moveCursor(e);
  if (!drawing || busy) return;
  e.preventDefault();
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events.length ? events : [e]) drawing.pts.push(toNative(ev));
  redraw();
}

function onPointerUp() {
  drawing = null;
}

// ── Init ─────────────────────────────────────────────────────────
export function initCorrect() {
  canvas = $("correctCanvas");
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  frame = $("flyerFrame");
  flyerCol = document.querySelector(".result-flyer");
  cursorEl = $("correctCursor");
  busyEl = $("correctBusy");
  toastEl = $("correctToast");
  toastMsg = $("correctToastMsg");
  toastRetry = $("correctToastRetry");

  on($("btnCorrect"), "click", enterMode);
  on($("correctCancel"), "click", () => { if (!busy) exitMode(); });
  on($("correctUndo"), "click", () => { if (!busy) { strokes.pop(); drawing = null; redraw(); } });
  on($("correctClear"), "click", () => { if (!busy) { strokes = []; drawing = null; redraw(); } });
  on($("correctApply"), "click", apply);
  on($("correctPrevLink"), "click", togglePrev);
  on($("correctToastRetry"), "click", () => { hideToast(); apply(); });
  on($("correctToastClose"), "click", hideToast);
  on($("correctSize"), "input", () => { if (cursorEl.style.display === "block") cursorEl.style.display = "none"; });
  on($("correctInstruction"), "keydown", (e) => { if (e.key === "Enter") apply(); });

  on(canvas, "pointerdown", onPointerDown);
  on(canvas, "pointermove", onPointerMove);
  on(canvas, "pointerup", onPointerUp);
  on(canvas, "pointercancel", onPointerUp);
  on(canvas, "pointerleave", () => { cursorEl.style.display = "none"; });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isActive() && !busy) exitMode();
  });
}
