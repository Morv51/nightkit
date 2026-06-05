import { state } from "./state.js";
import { els } from "./dom.js";

// Points the preview image at the currently selected template. Reads state
// directly (no import of templates.js) to avoid an import cycle.
export function updateLivePreview() {
  const t =
    state.templates.find((x) => x.file === state.currentTemplateFile) ||
    state.templates[0];
  if (t && els.previewImg && els.previewImg.getAttribute("src") !== t.src) {
    els.previewImg.src = t.src;
  }
}
