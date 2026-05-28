// Tiny DOM helpers. `$` looks up an element by id, `val` reads a trimmed
// input value, `on` binds a listener. `els` is a populated map of cached
// references so call sites don't repeat getElementById.

export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const val = (id) => {
  const e = $(id);
  return e ? e.value.trim() : "";
};

export const on = (el, type, handler) => {
  if (!el) return;
  el.addEventListener(type, handler);
};

export const setText = (el, text) => { if (el) el.textContent = text; };
export const setHtml = (el, html) => { if (el) el.innerHTML = html; };
export const show = (el, display = "block") => { if (el) el.style.display = display; };
export const hide = (el) => { if (el) el.style.display = "none"; };
export const toggleClass = (el, cls, on) => { if (el) el.classList.toggle(cls, on); };

export const els = {};

const IDS = [
  "ov", "ovTimer",
  "fPrefix", "fName", "fGenre", "fDay", "fDate", "fDj", "fTime", "fEntry", "fContact",
  "tplGrid", "emptyCat", "catTabs",
  "panelBody", "statePreview", "stateResult",
  "previewCanvas", "resultImg",
  "copyBtn", "histWrap", "histRow",
  "videoChevron", "videoBody", "videoCanvas", "videoStatus", "previewWrap", "exportBtn",
  "genBtn", "genTxt", "errBox",
];

export function initDom() {
  for (const id of IDS) els[id] = document.getElementById(id);
}
