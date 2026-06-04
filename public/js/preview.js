import { els } from "./dom.js";

// Single fixed template — the preview image just points at it. Kept as a
// function so generator.js can restore the preview after viewing a result.
const TEMPLATE_SRC = "/templates/birthday-pink.jpg";

export function updateLivePreview() {
  if (els.previewImg && els.previewImg.getAttribute("src") !== TEMPLATE_SRC) {
    els.previewImg.src = TEMPLATE_SRC;
  }
}
