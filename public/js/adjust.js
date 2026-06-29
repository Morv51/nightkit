import { state } from "./state.js";
import { $, els, on } from "./dom.js";
import { postAdjust, friendlyMessage } from "./api.js";
import { addToHistory } from "./history.js";
import { setMaster, selectFormat } from "./formats.js";
import { exitStageVideo } from "./video.js";
import { toast } from "./toast.js";

// "Text anpassen" (gezielte Nachkorrektur): der User zieht EIN Rechteck über die
// fehlerhafte Stelle und gibt den korrigierten Text ein. Es geht ein gezielter
// edit()-Aufruf (bestehender Flow, magic_prompt OFF) auf den ganzen Flyer raus,
// der die Zone neu rendert — danach wird NUR das markierte Rechteck ins Original
// zurückkopiert (Canvas-Composite), sodass der Rest pixelgenau unverändert
// bleibt. Getrennt vom bestehenden "Korrigieren" (Pinsel/LaMa-Entfernen).
//
// Das Mal-Canvas läuft in nativer Bildauflösung und wird per CSS skaliert;
// Koordinaten werden pro Event umgerechnet (wie beim Korrektur-Pinsel).

let canvas, ctx, frame, flyerCol, busyEl;
let rect = null;   // { x, y, w, h } in nativen Bildpixeln
let start = null;  // Startpunkt während des Ziehens
let busy = false;

function isActive() {
  return frame && frame.classList.contains("adjusting");
}

function toNative(e) {
  const r = canvas.getBoundingClientRect();
  return [
    (e.clientX - r.left) * (canvas.width / r.width),
    (e.clientY - r.top) * (canvas.height / r.height),
  ];
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!rect || rect.w < 1 || rect.h < 1) return;
  ctx.fillStyle = "rgba(204,255,0,0.18)";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = "#CCFF00";
  ctx.lineWidth = Math.max(2, canvas.width * 0.004);
  ctx.setLineDash([canvas.width * 0.02, canvas.width * 0.012]);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.setLineDash([]);
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
  rect = null;
  start = null;
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
  rect = null;
  start = null;
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

// ── Bild-Helfer + Composite ──────────────────────────────────────
const MAX_UPLOAD = 9.5 * 1024 * 1024;

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

// Nur das markierte Rechteck aus dem editierten Ergebnis übernehmen, der Rest
// bleibt das Original. So ist garantiert nur die Zone geändert.
async function compositeRect(masterUrl, editedUrl, r) {
  const [m, e] = await Promise.all([loadImg(masterUrl), loadImg(editedUrl)]);
  const c = document.createElement("canvas");
  c.width = m.naturalWidth;
  c.height = m.naturalHeight;
  const cx = c.getContext("2d");
  cx.drawImage(m, 0, 0); // Original überall
  const sW = e.naturalWidth / m.naturalWidth;
  const sH = e.naturalHeight / m.naturalHeight;
  cx.drawImage(e, r.x * sW, r.y * sH, r.w * sW, r.h * sH, r.x, r.y, r.w, r.h);
  return c.toDataURL("image/png");
}

// ── Anwenden ──────────────────────────────────────────────────────
function setBusy(b) {
  busy = b;
  busyEl.classList.toggle("on", b);
  $("adjustApply").disabled = b;
}

async function apply() {
  if (busy || !isActive()) return;
  if (!rect || rect.w < canvas.width * 0.015 || rect.h < canvas.height * 0.006) {
    showToast("Bitte ziehe zuerst ein Rechteck über die Stelle, die du anpassen willst.", false);
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
    const W = canvas.width, H = canvas.height;
    const r = { ...rect };
    const masterUrl = await currentImageDataUrl();
    const area = { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H };

    // Gezielter edit()-Aufruf (ganzes Bild), dann nur die Zone zurückkopieren.
    const edited = await postAdjust({ image: masterUrl, text, area });
    const composited = await compositeRect(masterUrl, edited, r);

    setMaster(composited);
    addToHistory(composited);

    // Im Modus bleiben → direkt die nächste Stelle markierbar.
    rect = null;
    start = null;
    $("adjustText").value = "";
    redraw();
    toast("Stelle angepasst — du kannst direkt die nächste markieren.", { type: "success" });
  } catch (e) {
    showToast(friendlyMessage(e), true);
  } finally {
    setBusy(false);
  }
}

// ── Rechteck ziehen (Pointer Events) ─────────────────────────────
function onPointerDown(e) {
  if (busy) return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  const [x, y] = toNative(e);
  start = [x, y];
  rect = { x, y, w: 0, h: 0 };
  redraw();
}

function onPointerMove(e) {
  if (!start || busy) return;
  e.preventDefault();
  const [x, y] = toNative(e);
  rect = {
    x: Math.min(start[0], x),
    y: Math.min(start[1], y),
    w: Math.abs(x - start[0]),
    h: Math.abs(y - start[1]),
  };
  redraw();
}

function onPointerUp() {
  start = null;
}

// ── Init ─────────────────────────────────────────────────────────
export function initAdjust() {
  canvas = $("adjustCanvas");
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  frame = $("flyerFrame");
  flyerCol = document.querySelector(".result-flyer");
  busyEl = $("adjustBusy");

  on($("btnAdjust"), "click", enterMode);
  on($("adjustCancel"), "click", () => { if (!busy) exitMode(); });
  on($("adjustApply"), "click", apply);

  on(canvas, "pointerdown", onPointerDown);
  on(canvas, "pointermove", onPointerMove);
  on(canvas, "pointerup", onPointerUp);
  on(canvas, "pointercancel", onPointerUp);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isActive() && !busy) exitMode();
  });
}
