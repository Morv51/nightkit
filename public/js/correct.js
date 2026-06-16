import { state } from "./state.js";
import { $, els, on } from "./dom.js";
import { postRemove, friendlyMessage } from "./api.js";
import { addToHistory } from "./history.js";
import { setMaster, selectFormat } from "./formats.js";
import { exitStageVideo } from "./video.js";
import { toast } from "./toast.js";

// Korrektur-Modus (Inpainting): der User malt mit einem Pinsel über Stellen
// des Flyers; die markierten Bereiche werden per LaMa (Replicate /api/remove)
// sauber entfernt und content-aware mit Hintergrund aufgefüllt, der Rest
// bleibt unverändert. LaMa-Maske: WEISS = entfernen, SCHWARZ = behalten.
//
// Das Mal-Canvas läuft intern in der nativen Bildauflösung und wird per CSS
// auf die Anzeigegröße skaliert; Koordinaten werden pro Event umgerechnet,
// damit Markierung und Maske auch bei responsiver Skalierung deckungsgleich
// bleiben.

// Pinselradius als Anteil der Bildbreite — stufenlos vom feinen bis zum
// groben Pinsel (der Slider liefert t = 0…1).
const BRUSH_MIN_FRACTION = 0.005;
const BRUSH_MAX_FRACTION = 0.085;
const MAX_UPLOAD = 9.5 * 1024 * 1024; // Limit: 10MB pro Datei

let strokes = [];     // [{ r, pts: [[x,y], …] }] in nativen Bildpixeln
let drawing = null;   // aktiver Strich während eines Pointer-Drags
let busy = false;
let showingPrev = false;

let canvas, ctx, frame, flyerCol, cursorEl, busyEl;

function isActive() {
  return frame && frame.classList.contains("correcting");
}

function brushRadius() {
  const t = Math.max(0, Math.min(1, Number($("correctSize").value) || 0));
  const frac = BRUSH_MIN_FRACTION + (BRUSH_MAX_FRACTION - BRUSH_MIN_FRACTION) * t;
  return Math.max(2, canvas.width * frac);
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
  exitStageVideo(); // läuft gerade ein Bühnen-Video, erst zurück zum Flyer
  // Korrektur arbeitet immer auf dem 9:16-Master — falls gerade ein
  // abgeleitetes Format angezeigt wird, erst zurückschalten.
  if (state.currentFormat !== "story") selectFormat("story");
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
  const prevUrl = state.correctPrev;
  state.correctPrev = state.master;
  state.correctPrevImg = state.masterImg;
  setMaster(prevUrl); // Master-Wechsel → gecachte Formate verfallen
  showingPrev = !showingPrev;
  updatePrevLink();
}

// ── Toast (Fehler, optional mit Retry) ───────────────────────────
let dismissToast = null;

function showToast(msg, withRetry) {
  hideToast();
  dismissToast = toast(msg, withRetry
    ? { type: "error", action: { label: "Erneut versuchen", onClick: apply } }
    : { type: "error" });
}

function hideToast() {
  if (dismissToast) { dismissToast(); dismissToast = null; }
}

// ── Maske + Bild-Payload ─────────────────────────────────────────
// LaMa-Maske (Replicate remove-object): SCHWARZ = behalten, WEISS = entfernen.
function buildRemoveMaskDataUrl() {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  const mctx = c.getContext("2d");
  mctx.fillStyle = "#000000"; // schwarz = behalten
  mctx.fillRect(0, 0, c.width, c.height);
  drawStrokes(mctx, "#FFFFFF"); // weiß = entfernen
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

// ── Entfernen anwenden ───────────────────────────────────────────
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
    // LaMa via Replicate: Original-Bild + Maske (weiß = entfernen).
    const corrected = await postRemove({
      image: await currentImageDataUrl(),
      mask: buildRemoveMaskDataUrl(),
    });

    // Alte Version für einen Schritt zurück behalten, dann als neues Master
    // übernehmen: Downloads, Video und Formate nutzen ab jetzt das bereinigte
    // Bild; gecachte Reframe-Formate verfallen.
    state.correctPrev = state.master;
    state.correctPrevImg = state.masterImg;
    showingPrev = false;
    setMaster(corrected);
    addToHistory(corrected);

    exitMode();
  } catch (e) {
    showToast(friendlyMessage(e), true); // Striche bleiben für Retry erhalten
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

  // Korrigieren-Kachel öffnet den Modus; beendet wird über die Korrektur-
  // Controls in der Sidebar (Entfernen/Abbrechen).
  on($("btnCorrect"), "click", enterMode);
  on($("correctCancel"), "click", () => { if (!busy) exitMode(); });
  on($("correctUndo"), "click", () => { if (!busy) { strokes.pop(); drawing = null; redraw(); } });
  on($("correctClear"), "click", () => { if (!busy) { strokes = []; drawing = null; redraw(); } });
  on($("correctApply"), "click", apply);
  on($("correctPrevLink"), "click", togglePrev);
  on($("correctSize"), "input", () => { if (cursorEl.style.display === "block") cursorEl.style.display = "none"; });

  on(canvas, "pointerdown", onPointerDown);
  on(canvas, "pointermove", onPointerMove);
  on(canvas, "pointerup", onPointerUp);
  on(canvas, "pointercancel", onPointerUp);
  on(canvas, "pointerleave", () => { cursorEl.style.display = "none"; });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isActive() && !busy) exitMode();
  });
}
