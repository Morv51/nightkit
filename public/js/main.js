import { initDom, els, on } from "./dom.js";
import { loadTemplates, renderPicker, applyCurrentTemplate, initPicker, maybeAutoOpenPicker } from "./templates.js";
import { generate, resetToPreview } from "./generator.js";
import { download, copyImage } from "./download.js";
import { renderStyleButtons, previewVideo, exportVideo, exitStageVideo } from "./video.js";
import { initLogo } from "./logo.js";
import { initDatePicker } from "./datepicker.js";
import { initCaption } from "./caption.js";
import { initCorrect } from "./correct.js";
import { initFormats } from "./formats.js";
import { initCompare } from "./compare.js";
import { initHints } from "./hints.js";

function bindActions() {
  on(els.genBtn, "click", generate);
  on(document.getElementById("btnDlPng"),   "click", () => download("png"));
  on(document.getElementById("btnDlJpg"),   "click", () => download("jpg"));
  on(els.copyBtn, "click", copyImage);
  on(document.getElementById("btnReset"),   "click", resetToPreview);
  on(document.getElementById("btnPv"),      "click", previewVideo);
  on(els.exportBtn, "click", exportVideo);
  on(document.getElementById("videoBackBtn"), "click", exitStageVideo);
}

async function init() {
  initDom();
  bindActions();
  renderStyleButtons();
  initLogo();
  initDatePicker();
  initCaption();
  initCorrect();
  initFormats();
  initCompare();
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
