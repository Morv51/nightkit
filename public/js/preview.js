import { els } from "./dom.js";
import { getCurrentTemplate } from "./templates.js";

// Shows the selected template at its native resolution. The browser scales
// the 1080×1920 source down via CSS object-fit:contain, so the preview stays
// sharp and keeps its true 9:16 proportions — no canvas, no upscaling, no
// stretched text overlay.
export function updateLivePreview() {
  const t = getCurrentTemplate();
  if (!t || !t.src || !els.previewImg) return;
  if (els.previewImg.getAttribute("src") !== t.src) {
    els.previewImg.src = t.src;
  }
}
