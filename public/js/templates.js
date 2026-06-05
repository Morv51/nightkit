import { state } from "./state.js";
import { els } from "./dom.js";
import { getTemplates } from "./api.js";
import { updateLivePreview } from "./preview.js";
import { applyLogoForTemplate } from "./logo.js";

export async function loadTemplates() {
  state.templates = await getTemplates();
  if (!state.currentTemplateFile && state.templates[0]) {
    state.currentTemplateFile = state.templates[0].file;
  }
}

export function getCurrentTemplate() {
  return (
    state.templates.find((t) => t.file === state.currentTemplateFile) ||
    state.templates[0] ||
    null
  );
}

export function renderTemplateGrid() {
  const grid = els.tplGrid;
  if (!grid) return;
  grid.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const t of state.templates) {
    const card = document.createElement("div");
    card.className = "tpl-card" + (t.file === state.currentTemplateFile ? " selected" : "");
    card.dataset.file = t.file;
    card.addEventListener("click", () => selectTemplate(t.file));

    const thumb = document.createElement("div");
    thumb.className = "tpl-thumb";
    const img = document.createElement("img");
    img.src = t.src;
    img.alt = t.label;
    img.loading = "lazy";
    thumb.appendChild(img);

    const name = document.createElement("div");
    name.className = "tpl-name";
    name.textContent = t.label;

    card.append(thumb, name);
    frag.appendChild(card);
  }
  grid.appendChild(frag);
}

export function selectTemplate(file) {
  state.currentTemplateFile = file;
  for (const c of document.querySelectorAll(".tpl-card")) {
    c.classList.toggle("selected", c.dataset.file === file);
  }
  updateLivePreview();
  applyLogoForTemplate(file);
}
