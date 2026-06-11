import { initDom, els, on } from "./dom.js";
import { state } from "./state.js";
import { loadTemplates, renderPicker, applyCurrentTemplate, initPicker, maybeAutoOpenPicker } from "./templates.js";
import { generate, resetToPreview } from "./generator.js";
import { download, copyImage } from "./download.js";
import { renderStyleButtons, toggleVideo, previewVideo, exportVideo } from "./video.js";
import { initLogo } from "./logo.js";
import { initDatePicker } from "./datepicker.js";
import { initCaption } from "./caption.js";
import { initCorrect } from "./correct.js";
import { initFormats } from "./formats.js";
import { initHints } from "./hints.js";

// V3/V4-Umschalter: setzt state.engine, das beim Generieren mitgeschickt wird.
function initEngineToggle() {
  const row = document.getElementById("engineToggle");
  if (!row) return;
  row.addEventListener("click", (e) => {
    const b = e.target.closest(".eng-pill");
    if (!b) return;
    state.engine = b.dataset.engine === "v4" ? "v4" : "v3";
    for (const p of row.querySelectorAll(".eng-pill")) p.classList.toggle("active", p === b);
  });
}

function bindActions() {
  on(els.genBtn, "click", generate);
  on(document.getElementById("btnDlPng"),   "click", () => download("png"));
  on(document.getElementById("btnDlJpg"),   "click", () => download("jpg"));
  on(els.copyBtn, "click", copyImage);
  on(document.getElementById("btnReset"),   "click", resetToPreview);
  on(document.querySelector(".video-head"), "click", toggleVideo);
  on(document.getElementById("btnPv"),      "click", previewVideo);
  on(els.exportBtn, "click", exportVideo);
}

async function init() {
  initDom();
  bindActions();
  initEngineToggle();
  renderStyleButtons();
  initLogo();
  initDatePicker();
  initCaption();
  initCorrect();
  initFormats();
  initHints();
  initPicker();

  try {
    await loadTemplates();
  } catch (e) {
    console.error("Templates konnten nicht geladen werden:", e);
  }
  renderPicker();
  applyCurrentTemplate();
  maybeAutoOpenPicker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
