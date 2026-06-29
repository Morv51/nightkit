import { initDom, els, on } from "./dom.js";
import { loadTemplates, renderPicker, renderGallery, applyCurrentTemplate, initPicker } from "./templates.js";
import { generate } from "./generator.js";
import { download, copyImage } from "./download.js";
import { renderStyleButtons, previewVideo, exportVideo, exitStageVideo } from "./video.js";
import { initLogo } from "./logo.js";
import { initDatePicker } from "./datepicker.js";
import { initCaption } from "./caption.js";
import { initCorrect } from "./correct.js";
import { initAdjust } from "./adjust.js";
import { initFormats } from "./formats.js";
import { initCompare } from "./compare.js";
import { initHints } from "./hints.js";
import { initMoreFields } from "./moreFields.js";

function bindActions() {
  on(els.genBtn, "click", generate);
  on(document.getElementById("btnDlPng"),   "click", () => download("png"));
  on(document.getElementById("btnDlJpg"),   "click", () => download("jpg"));
  on(els.copyBtn, "click", copyImage);
  on(document.getElementById("btnPv"),      "click", previewVideo);
  on(els.exportBtn, "click", exportVideo);
  on(document.getElementById("videoBackBtn"), "click", exitStageVideo);
  // "Neu generieren": reine Navigation — Formular nach oben + Fokus aufs Generieren.
  on(document.getElementById("btnRegen"), "click", () => {
    const scroll = document.querySelector(".col-left-scroll");
    (scroll || window).scrollTo({ top: 0, behavior: "smooth" });
    if (els.genBtn) els.genBtn.focus();
  });
}

// Responsive-Tabs der Toolbar (< 1024px): Klick zeigt die jeweilige Gruppe.
function initTabs() {
  for (const tab of document.querySelectorAll(".tool-tab")) {
    on(tab, "click", () => {
      const g = tab.dataset.group;
      for (const t of document.querySelectorAll(".tool-tab")) t.classList.toggle("active", t === tab);
      for (const grp of document.querySelectorAll(".tool-group")) grp.classList.toggle("active", grp.dataset.group === g);
    });
  }
}

async function init() {
  initDom();
  bindActions();
  renderStyleButtons();
  initLogo();
  initDatePicker();
  initCaption();
  initCorrect();
  initAdjust();
  initFormats();
  initCompare();
  initTabs();
  initHints();
  initMoreFields();
  initPicker();

  try {
    await loadTemplates();
  } catch (e) {
    console.error("Templates konnten nicht geladen werden:", e);
  }
  renderPicker();
  renderGallery();
  applyCurrentTemplate();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
