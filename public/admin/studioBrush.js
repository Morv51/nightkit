// Geteiltes Bereinigen-Werkzeug (LaMa-Removal-Brush), gespiegelt aus
// public/js/correct.js. Pro Ergebnis-Bühne instanziierbar (beide Modi).
// Maskenkonvention LaMa: WEISS = entfernen, SCHWARZ = behalten.

import { post } from "./studioApi.js";
import { notify } from "./studioUi.js";

const BRUSH_MIN = 0.006; // Anteil der Bildbreite (fein)
const BRUSH_MAX = 0.09;  // (grob)

export function createBrushTool({ stage, img, getImage, setImage, setBusy }) {
  let canvas, cursor, bar, sizeInput;
  let strokes = [];
  let drawing = null;

  function brushRadius() {
    const t = sizeInput ? Math.max(0, Math.min(1, Number(sizeInput.value) || 0)) : 0.3;
    return Math.max(2, canvas.width * (BRUSH_MIN + (BRUSH_MAX - BRUSH_MIN) * t));
  }

  function toNative(e) {
    const r = canvas.getBoundingClientRect();
    return [
      (e.clientX - r.left) * (canvas.width / r.width),
      (e.clientY - r.top) * (canvas.height / r.height),
    ];
  }

  function paint(ctx, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes) {
      ctx.lineWidth = s.r * 2;
      ctx.beginPath();
      s.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      for (const p of s.pts) { ctx.beginPath(); ctx.arc(p[0], p[1], s.r, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  function redraw() {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paint(ctx, "rgba(204,255,0,0.55)"); // sichtbare Markierung
  }

  function maskDataUrl() {
    const c = document.createElement("canvas");
    c.width = canvas.width; c.height = canvas.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, c.width, c.height); // behalten
    paint(ctx, "#FFFFFF"); // entfernen
    return c.toDataURL("image/png");
  }

  function moveCursor(e) {
    if (!cursor) return;
    const r = canvas.getBoundingClientRect();
    const d = brushRadius() * 2 * (r.width / canvas.width);
    cursor.style.width = d + "px";
    cursor.style.height = d + "px";
    cursor.style.left = (e.clientX - r.left) + "px";
    cursor.style.top = (e.clientY - r.top) + "px";
    cursor.style.display = "block";
  }

  function onDown(e) {
    drawing = { r: brushRadius(), pts: [toNative(e)] };
    strokes.push(drawing);
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    redraw();
  }
  function onMove(e) { moveCursor(e); if (drawing) { drawing.pts.push(toNative(e)); redraw(); } }
  function onUp() { drawing = null; }
  function onLeave() { if (cursor) cursor.style.display = "none"; }

  function build() {
    canvas = document.createElement("canvas");
    canvas.className = "studio-brush-canvas";
    cursor = document.createElement("div");
    cursor.className = "studio-brush-cursor";
    stage.appendChild(canvas);
    stage.appendChild(cursor);

    bar = document.createElement("div");
    bar.className = "studio-brush-bar";
    bar.hidden = true;
    bar.innerHTML =
      '<label class="sbb-size">Pinsel <input type="range" min="0" max="1" step="0.01" value="0.3"></label>' +
      '<button class="rbtn rbtn-ghost" data-act="undo" type="button">↩ Zurück</button>' +
      '<button class="rbtn rbtn-ghost" data-act="clear" type="button">⊘ Leeren</button>' +
      '<button class="rbtn rbtn-primary" data-act="apply" type="button">✓ Entfernen</button>' +
      '<button class="rbtn rbtn-ghost" data-act="done" type="button">Fertig</button>';
    stage.after(bar);
    sizeInput = bar.querySelector('input[type="range"]');

    bar.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const a = b.dataset.act;
      if (a === "undo") { strokes.pop(); redraw(); }
      else if (a === "clear") { strokes = []; redraw(); }
      else if (a === "apply") apply();
      else if (a === "done") close();
    });

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
  }

  function open() {
    if (!getImage()) return notify("Kein Bild zum Bereinigen", "error");
    if (!canvas) build();
    canvas.width = img.naturalWidth || 1080;
    canvas.height = img.naturalHeight || 1920;
    strokes = [];
    redraw();
    bar.hidden = false;
    canvas.style.display = "block";
    stage.classList.add("brushing");
  }

  function close() {
    if (bar) bar.hidden = true;
    if (canvas) canvas.style.display = "none";
    if (cursor) cursor.style.display = "none";
    stage.classList.remove("brushing");
  }

  async function apply() {
    if (!strokes.length) return notify("Erst markieren, was entfernt werden soll", "error");
    setBusy(true, "Entferne markierte Bereiche …");
    try {
      const { image } = await post("/admin/remove", { image: getImage(), mask: maskDataUrl() });
      setImage(image);
      strokes = [];
      redraw();
      notify("Bereich entfernt", "success");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return { open, close };
}

// „Korrigieren": hängt das aktuelle Ergebnis erneut in den bestehenden
// edit()-Flow (eine freie Korrektur-Anweisung). Beide Modi.
export async function correctImage({ getImage, setImage, setBusy }) {
  const img = getImage();
  if (!img) return notify("Kein Bild zum Korrigieren", "error");
  const instruction = window.prompt(
    "Was soll korrigiert werden? (z. B. 'Headline kleiner machen' oder 'das rote Element entfernen')"
  );
  if (!instruction || !instruction.trim()) return;
  setBusy(true, "Korrigiere …");
  try {
    const { image } = await post("/admin/edit", { image: img, prompt: instruction.trim() });
    setImage(image);
    notify("Korrektur angewandt", "success");
  } catch (e) {
    notify(e.message, "error");
  } finally {
    setBusy(false);
  }
}

// Optionales Speichern in die Galerie (additiv). Reicht Bild + Metadaten an
// /admin/save. Zeigt den Ephemer-Hinweis vom Server als Toast.
export async function saveTemplate({ getImage, mode, getMeta }) {
  const img = getImage();
  if (!img) return notify("Kein Bild zum Speichern", "error");
  const name = window.prompt("Template-Name für die Galerie:", "");
  if (name === null) return; // abgebrochen
  const meta = getMeta ? getMeta() : {};
  try {
    const r = await post("/admin/save", Object.assign({ image: img, name: name.trim(), mode }, meta));
    notify(r.warning || "Gespeichert", "success");
  } catch (e) {
    notify(e.message, "error");
  }
}
