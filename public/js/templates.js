import { state } from "./state.js";
import { els } from "./dom.js";
import { getTemplates } from "./api.js";
import { updateLivePreview } from "./preview.js";

const CATS = ["alle", "techno", "house", "hiphop", "rnb", "halloween", "minimal"];

export async function loadTemplates() {
  state.templates = await getTemplates();
}

export function getCurrentTemplate() {
  return state.templates.find((t) => t.id === state.currentTemplateId) || state.templates[0] || null;
}

export function renderTemplateGrid(cat) {
  state.currentCategory = cat;
  const grid = els.tplGrid;
  const empty = els.emptyCat;
  grid.innerHTML = "";

  const filtered = state.templates.filter(
    (t) => cat === "alle" || (t.cats || []).includes(cat)
  );

  if (!filtered.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const frag = document.createDocumentFragment();
  for (const t of filtered) {
    const card = document.createElement("div");
    card.className = "tpl-card";
    card.id = "tcard-" + t.id;
    card.dataset.id = t.id;
    if (t.id === state.currentTemplateId) card.classList.add("selected");
    card.addEventListener("click", () => selectTemplateById(t.id));

    const thumb = document.createElement("div");
    thumb.className = "tpl-thumb";
    const img = document.createElement("img");
    img.src = t.src || "";
    img.alt = t.name;
    img.loading = "lazy";
    thumb.appendChild(img);

    const chk = document.createElement("div");
    chk.className = "tpl-check";
    chk.textContent = "✓";

    const name = document.createElement("div");
    name.className = "tpl-name";
    name.textContent = t.name;

    card.append(thumb, chk, name);
    frag.appendChild(card);
  }
  grid.appendChild(frag);
}

export function selectTemplateById(id) {
  state.currentTemplateId = id;
  for (const c of document.querySelectorAll(".tpl-card")) c.classList.remove("selected");
  const card = document.getElementById("tcard-" + id);
  if (card) card.classList.add("selected");
  updateLivePreview();
}

export function filterCategory(cat, btn) {
  for (const t of document.querySelectorAll(".cat-tab")) t.classList.remove("active");
  if (btn) btn.classList.add("active");
  renderTemplateGrid(cat);
}

export { CATS };
