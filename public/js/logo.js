import { state } from "./state.js";
import { els } from "./dom.js";

// Logo handling: upload, plus drag-to-move and corner-resize of the logo on
// the preview. The position/size (cx, cy, w as fractions of the flyer) is
// remembered per template in localStorage, so it's auto-placed next time.
//
// Dazu inv: invertiert das Logo (schwarzes Logo auf dunklem Flyer und
// umgekehrt). Der Schalter liegt im SELBEN Objekt wie cx/cy/w und wird damit
// genauso pro Template gespeichert. Aeltere gespeicherte Boxen haben das Feld
// nicht -- fehlend gilt als "nicht invertiert", siehe applyLogoForTemplate.

const DEFAULT_BOX = { cx: 0.5, cy: 0.15, w: 0.3, inv: false };
const keyFor = (file) => "nk_logobox_" + file;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function initLogo() {
  if (els.fLogo) {
    els.fLogo.addEventListener("change", () => {
      const file = els.fLogo.files && els.fLogo.files[0];
      if (file) setLogo(URL.createObjectURL(file));
      else clearLogo();
    });
  }
  bindDrag();
  bindResize();
  bindRemove();
  bindInvert();
  applyBox();
}

// Dritter Griff: schaltet die Invertierung um. Wie die beiden anderen haelt er
// seinen pointerdown zurueck, damit bindDrag kein Ziehen unter dem Klick
// startet.
function bindInvert() {
  const h = els.logoInvert;
  if (!h) return;
  h.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  h.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    state.logoBox.inv = !state.logoBox.inv;
    applyBox();
    saveBox();   // gleiche Ablage wie Position und Groesse
  });
}

// Entfernt das Logo NUR aus diesem Flyer. Die Datei am Club (R2) bleibt
// unangetastet: clearLogo() fasst ausschliesslich Anzeige-Zustand an, kein
// Netz, kein user_metadata. Beim naechsten Clubwechsel oder Neuladen holt
// clubs.js sie wieder.
function bindRemove() {
  const h = els.logoRemove;
  if (!h) return;
  // Wie beim Skalieren-Griff: der pointerdown darf nicht bis zum Overlay
  // hochblubbern, sonst startet bindDrag ein Ziehen unter dem Klick.
  h.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  h.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearLogo();
  });
}

// Meldet jeden Wechsel des Buehnen-Logos. Ein Ereignis statt eines Rueckrufs:
// clubs.js muss wissen, ob gerade eines liegt (fuer den Knopf "Clublogo
// einfuegen"), darf hier aber nicht importiert werden -- clubs.js importiert
// bereits logo.js, das gaebe einen Ringschluss.
function meldeLogoWechsel() {
  try { document.dispatchEvent(new CustomEvent("nk:logo")); } catch (e) { /* egal */ }
}

// Exportiert, damit ein am Club gespeichertes Logo denselben Weg nimmt wie
// eine frisch hochgeladene Datei (clubs.js reicht einen Blob-URL herein).
export function setLogo(url) {
  if (state.logoUrl) URL.revokeObjectURL(state.logoUrl);
  state.logoUrl = url;
  if (els.logoPreview) {
    els.logoPreview.src = url;
    els.logoPreview.style.display = "block";
  }
  if (els.logoOverlayImg) els.logoOverlayImg.src = url;
  if (els.logoOverlay) els.logoOverlay.classList.add("has-logo");
  // Reveal the sharp template preview so the logo can be positioned on it
  // (the placeholder is hidden while a logo is present).
  if (els.previewCol) els.previewCol.classList.add("has-logo");
  meldeLogoWechsel();
}

export function clearLogo() {
  if (state.logoUrl) {
    URL.revokeObjectURL(state.logoUrl);
    state.logoUrl = null;
  }
  if (els.logoPreview) {
    els.logoPreview.removeAttribute("src");
    els.logoPreview.style.display = "none";
  }
  if (els.logoOverlayImg) els.logoOverlayImg.removeAttribute("src");
  if (els.logoOverlay) els.logoOverlay.classList.remove("has-logo");
  // Dateifeld leeren, sonst kann DIESELBE Datei danach nicht erneut gewaehlt
  // werden: der Wert aendert sich nicht, also feuert der Browser kein change.
  // Ein programmatisches value = "" loest selbst KEIN change aus, der Handler
  // oben ruft sich also nicht im Kreis.
  if (els.fLogo) els.fLogo.value = "";
  // Keep the preview if a template was explicitly chosen; only drop the
  // logo-specific state (hint + logo-driven reveal).
  if (els.previewCol) els.previewCol.classList.remove("has-logo");
  meldeLogoWechsel();
}

// Load the saved box for a template (or the default) and apply it.
export function applyLogoForTemplate(file) {
  let box = null;
  try {
    box = JSON.parse(localStorage.getItem(keyFor(file)) || "null");
  } catch {}
  const roh =
    box && Number.isFinite(box.cx) && Number.isFinite(box.cy) && Number.isFinite(box.w)
      ? box
      : DEFAULT_BOX;
  // inv ausdruecklich zu einem Boolean machen: aeltere Boxen haben das Feld
  // gar nicht (undefined -> false), und ein unerwarteter Wert kann nicht
  // durchrutschen.
  state.logoBox = { cx: roh.cx, cy: roh.cy, w: roh.w, inv: !!roh.inv };
  applyBox();
}

function applyBox() {
  const o = els.logoOverlay;
  if (!o) return;
  const b = state.logoBox;
  o.style.left = b.cx * 100 + "%";
  o.style.top = b.cy * 100 + "%";
  o.style.width = b.w * 100 + "%";
  // Auf der Buehne macht das ein CSS-Filter; composite.js rechnet dasselbe
  // beim Komponieren nach, damit Ergebnis und Vorschau uebereinstimmen.
  o.classList.toggle("inverted", !!b.inv);
  if (els.logoInvert) els.logoInvert.setAttribute("aria-pressed", b.inv ? "true" : "false");
}

function saveBox() {
  if (!state.currentTemplateFile) return;
  try {
    localStorage.setItem(keyFor(state.currentTemplateFile), JSON.stringify(state.logoBox));
  } catch {}
}

function bindDrag() {
  const o = els.logoOverlay;
  if (!o) return;
  o.addEventListener("pointerdown", (e) => {
    // Alle drei Griffe haben eigene Handler und duerfen kein Ziehen ausloesen.
    if (e.target === els.logoResize || e.target === els.logoRemove ||
        e.target === els.logoInvert) return;
    e.preventDefault();
    const stage = els.previewStage.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, cx: state.logoBox.cx, cy: state.logoBox.cy };
    try { o.setPointerCapture(e.pointerId); } catch {}
    o.classList.add("dragging");

    const move = (ev) => {
      state.logoBox.cx = clamp(start.cx + (ev.clientX - start.x) / stage.width, 0.04, 0.96);
      state.logoBox.cy = clamp(start.cy + (ev.clientY - start.y) / stage.height, 0.04, 0.96);
      applyBox();
    };
    const up = () => {
      o.classList.remove("dragging");
      o.removeEventListener("pointermove", move);
      o.removeEventListener("pointerup", up);
      saveBox();
    };
    o.addEventListener("pointermove", move);
    o.addEventListener("pointerup", up);
  });
}

function bindResize() {
  const h = els.logoResize;
  if (!h) return;
  h.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const stage = els.previewStage.getBoundingClientRect();
    const start = { x: e.clientX, w: state.logoBox.w };
    try { h.setPointerCapture(e.pointerId); } catch {}

    const move = (ev) => {
      // centre-anchored: moving the corner by d changes half-width by d
      state.logoBox.w = clamp(start.w + ((ev.clientX - start.x) / stage.width) * 2, 0.08, 0.7);
      applyBox();
    };
    const up = () => {
      h.removeEventListener("pointermove", move);
      h.removeEventListener("pointerup", up);
      saveBox();
    };
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", up);
  });
}
