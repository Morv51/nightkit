import { state } from "./state.js";
import { els } from "./dom.js";

// Logo handling: upload, plus drag-to-move and corner-resize of the logo on
// the preview. The position/size (cx, cy, w as fractions of the flyer) is
// remembered per template in localStorage, so it's auto-placed next time.

const DEFAULT_BOX = { cx: 0.5, cy: 0.15, w: 0.3 };
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
  applyBox();
}

function setLogo(url) {
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
}

function clearLogo() {
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
  // Keep the preview if a template was explicitly chosen; only drop the
  // logo-specific state (hint + logo-driven reveal).
  if (els.previewCol) els.previewCol.classList.remove("has-logo");
}

// Load the saved box for a template (or the default) and apply it.
export function applyLogoForTemplate(file) {
  let box = null;
  try {
    box = JSON.parse(localStorage.getItem(keyFor(file)) || "null");
  } catch {}
  state.logoBox =
    box && Number.isFinite(box.cx) && Number.isFinite(box.cy) && Number.isFinite(box.w)
      ? box
      : { ...DEFAULT_BOX };
  applyBox();
}

function applyBox() {
  const o = els.logoOverlay;
  if (!o) return;
  const b = state.logoBox;
  o.style.left = b.cx * 100 + "%";
  o.style.top = b.cy * 100 + "%";
  o.style.width = b.w * 100 + "%";
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
    if (e.target === els.logoResize) return; // resize has its own handler
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
