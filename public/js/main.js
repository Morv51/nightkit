import { initDom, els, $$, on } from "./dom.js";
import { loadTemplates, renderTemplateGrid, filterCategory } from "./templates.js";
import { updateLivePreview, scheduleLiveUpdate } from "./preview.js";
import { generate, resetToPreview } from "./generator.js";
import { download, copyImage } from "./download.js";
import { renderStyleButtons, toggleVideo, previewVideo, exportVideo } from "./video.js";

const LIVE_FIELDS = ["fName", "fGenre", "fDay", "fDate", "fDj"];

function bindInputs() {
  for (const id of LIVE_FIELDS) on(document.getElementById(id), "input", scheduleLiveUpdate);
}

function bindCategoryTabs() {
  for (const tab of $$(".cat-tab")) {
    on(tab, "click", () => filterCategory(tab.dataset.cat, tab));
  }
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
  bindInputs();
  bindCategoryTabs();
  bindActions();
  renderStyleButtons();

  try {
    await loadTemplates();
  } catch (e) {
    console.error("Templates konnten nicht geladen werden:", e);
  }
  renderTemplateGrid("alle");
  updateLivePreview();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
