import { state } from "./state.js";
import { $, els, on } from "./dom.js";
import { postAdjust } from "./api.js";
import { addToHistory } from "./history.js";
import { setMaster, selectFormat } from "./formats.js";
import { exitStageVideo } from "./video.js";
import { toast } from "./toast.js";

// "Text anpassen" (gezielte Nachkorrektur): der User malt mit einem PINSEL über
// die fehlerhafte Textstelle und folgt dabei der echten Form (auch Schnörkel,
// Tropfen, überlappende Effekt-Schriften). Die übermalte Fläche ist die Maske.
// Es geht ein gezielter edit()-Aufruf (bestehender Flow, magic_prompt OFF) auf
// den ganzen Flyer raus, der die Zone neu rendert — danach werden NUR die
// übermalten (maskierten) Pixel ins Original zurückkopiert (Canvas-Composite mit
// weicher Kante), sodass der Rest pixelgenau unverändert bleibt. Getrennt vom
// bestehenden "Korrigieren" (Pinsel/LaMa-Entfernen) — eigene Logik, kein Import.
//
// Brush-Mechanik gespiegelt aus correct.js: Canvas in nativer Auflösung, per CSS
// skaliert; Koordinaten pro Event umgerechnet; Striche werden deckend gemalt,
// das Canvas-Element steht auf 45% (CSS), sodass die Markierung halbtransparent
// über dem Flyer liegt.

const BRUSH_MIN_FRACTION = 0.005;
const BRUSH_MAX_FRACTION = 0.085;
const MAX_UPLOAD = 9.5 * 1024 * 1024;

let canvas, ctx, frame, flyerCol, cursorEl, busyEl;
let strokes = [];   // [{ r, pts: [[x,y], …] }] in nativen Bildpixeln
let drawing = null; // aktiver Strich während eines Pointer-Drags
let busy = false;

function isActive() {
  return frame && frame.classList.contains("adjusting");
}

function brushRadius() {
  const t = Math.max(0, Math.min(1, Number($("adjustSize").value) || 0));
  const frac = BRUSH_MIN_FRACTION + (BRUSH_MAX_FRACTION - BRUSH_MIN_FRACTION) * t;
  return Math.max(2, canvas.width * frac);
}

function toNative(e) {
  const r = canvas.getBoundingClientRect();
  return [
    (e.clientX - r.left) * (canvas.width / r.width),
    (e.clientY - r.top) * (canvas.height / r.height),
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
  exitStageVideo();
  if (state.currentFormat !== "story") selectFormat("story"); // immer auf dem 9:16-Master
  const img = els.resultImg;
  if (!img.complete || !img.naturalWidth) {
    img.addEventListener("load", enterMode, { once: true });
    return;
  }
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  strokes = [];
  drawing = null;
  redraw();
  const ti = $("adjustText");
  if (ti) ti.value = "";

  frame.classList.add("adjusting");
  flyerCol.classList.add("adjust-mode");
  hideToast();
}

function exitMode() {
  frame.classList.remove("adjusting");
  flyerCol.classList.remove("adjust-mode");
  cursorEl.style.display = "none";
  strokes = [];
  drawing = null;
  hideToast();
}

// Beim Wechsel auf ein neues Generierungs-Ergebnis: Modus verlassen.
export function resetAdjustState() {
  if (isActive()) exitMode();
}

// ── Toast ─────────────────────────────────────────────────────────
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

// Fehler im Klartext zeigen (kein stilles Nichts): spezifische Server-, Timeout-
// und Limit-Meldungen bevorzugen, nur unbekannte Netzfehler abfangen.
function adjustErrorMessage(e) {
  if (!e) return "Das hat nicht geklappt. Bitte nochmal versuchen.";
  if (["http", "limit", "auth", "timeout"].includes(e.code)) return e.message;
  return (e.message && e.message.length < 160) ? e.message : "Verbindungsproblem — bitte nochmal versuchen.";
}

// ── Bild-Helfer + Masken-Composite ───────────────────────────────
function blobToDataUrl(blob) {
  if (blob.size > MAX_UPLOAD) throw new Error("Das Bild ist zu groß (max. 10 MB).");
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

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
    i.src = src;
  });
}

// Zwei Masken aus denselben Pinsel-Strichen:
// 1) Ideogram-Maske fürs echte Inpainting — SCHWARZ = bearbeiten, WEISS =
//    behalten (Ideogram-Konvention!), deckend, gleiche Größe wie der Flyer.
function buildIdeogramMaskDataUrl() {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  const mx = c.getContext("2d");
  mx.fillStyle = "#ffffff"; mx.fillRect(0, 0, c.width, c.height); // behalten
  drawStrokes(mx, "#000000");                                     // bearbeiten
  return c.toDataURL("image/png");
}

// 2) Alpha-Maske fürs Zurückkopieren — deckend weiße Striche auf transparentem
//    Grund, weiche Kante (Blur) für nahtlosen Übergang. Garantiert, dass nur die
//    übermalte Fläche aus dem Ergebnis übernommen wird, der Rest = Original.
function buildAlphaMaskCanvas() {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  const mx = c.getContext("2d");
  const feather = Math.max(2, Math.round(canvas.width * 0.006));
  try { mx.filter = `blur(${feather}px)`; } catch {}
  drawStrokes(mx, "#ffffff");
  return c;
}

// Nur die maskierte (übermalte) Fläche aus dem editierten Ergebnis übernehmen,
// der Rest bleibt das Original. So ist garantiert nur die Zone geändert.
async function compositeMask(masterUrl, editedUrl, maskCanvas) {
  const [m, e] = await Promise.all([loadImg(masterUrl), loadImg(editedUrl)]);
  const W = m.naturalWidth, H = m.naturalHeight;
  // editiertes Bild auf Master-Maße bringen
  const layer = document.createElement("canvas");
  layer.width = W; layer.height = H;
  const lx = layer.getContext("2d");
  lx.drawImage(e, 0, 0, W, H);
  // nur dort behalten, wo die Maske deckend ist (übermalte Fläche)
  lx.globalCompositeOperation = "destination-in";
  lx.drawImage(maskCanvas, 0, 0, W, H);
  lx.globalCompositeOperation = "source-over";
  // Original unten, maskiertes Edit oben
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ox = out.getContext("2d");
  ox.drawImage(m, 0, 0);
  ox.drawImage(layer, 0, 0);
  return out.toDataURL("image/png");
}

// ── Anwenden ──────────────────────────────────────────────────────
function setBusy(b) {
  busy = b;
  busyEl.classList.toggle("on", b);
  $("adjustApply").disabled = b;
}

async function apply() {
  if (busy || !isActive()) return;
  if (!strokes.length) {
    showToast("Bitte male zuerst mit dem Pinsel über die Stelle, die du anpassen willst.", false);
    return;
  }
  const text = ($("adjustText").value || "").trim();
  if (!text) {
    showToast("Bitte gib den korrigierten Text ein.", false);
    return;
  }
  hideToast();
  setBusy(true);
  try {
    const masterUrl = await currentImageDataUrl();
    // Beide Masken aus den aktuellen Strichen bauen (vor dem Async-Call).
    const maskUrl = buildIdeogramMaskDataUrl(); // SCHWARZ = bearbeiten → an Ideogram
    const alphaMask = buildAlphaMaskCanvas();   // fürs pixelgenaue Zurückkopieren

    // Echtes Inpainting: nur die maskierte Zone neu rendern. Danach zusätzlich nur
    // die übermalte Fläche ins Original zurückkopieren (Rest bleibt unverändert).
    const edited = await postAdjust({ image: masterUrl, text, mask: maskUrl });
    const composited = await compositeMask(masterUrl, edited, alphaMask);

    setMaster(composited);
    addToHistory(composited);

    // Im Modus bleiben → direkt die nächste Stelle übermalen.
    strokes = [];
    drawing = null;
    $("adjustText").value = "";
    redraw();
    toast("Stelle angepasst — du kannst direkt die nächste übermalen.", { type: "success" });
  } catch (e) {
    showToast(adjustErrorMessage(e), true);
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
export function initAdjust() {
  canvas = $("adjustCanvas");
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  frame = $("flyerFrame");
  flyerCol = document.querySelector(".result-flyer");
  cursorEl = $("adjustCursor");
  busyEl = $("adjustBusy");

  on($("btnAdjust"), "click", enterMode);
  on($("adjustCancel"), "click", () => { if (!busy) exitMode(); });
  on($("adjustUndo"), "click", () => { if (!busy) { strokes.pop(); drawing = null; redraw(); } });
  on($("adjustClear"), "click", () => { if (!busy) { strokes = []; drawing = null; redraw(); } });
  on($("adjustApply"), "click", apply);
  on($("adjustSize"), "input", () => { if (cursorEl.style.display === "block") cursorEl.style.display = "none"; });

  on(canvas, "pointerdown", onPointerDown);
  on(canvas, "pointermove", onPointerMove);
  on(canvas, "pointerup", onPointerUp);
  on(canvas, "pointercancel", onPointerUp);
  on(canvas, "pointerleave", () => { cursorEl.style.display = "none"; });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isActive() && !busy) exitMode();
  });
}
