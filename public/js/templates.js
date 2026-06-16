import { state } from "./state.js";
import { $ } from "./dom.js";
import { getTemplates } from "./api.js";
import { updateLivePreview } from "./preview.js";
import { applyLogoForTemplate } from "./logo.js";
import { resetToPreview } from "./generator.js";

// Template catalogue + fullscreen picker modal. The sidebar shows only the
// current template as a small chip; choosing happens in the modal (search +
// category filter + grid). Selecting updates the stage preview immediately.

let activeCategory = "Alle";

export async function loadTemplates() {
  const data = await getTemplates();
  state.templates = data.templates;
  state.categories = data.categories;
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

// Apply the current template to the sidebar chip + stage preview + logo box,
// WITHOUT touching the modal (used on init).
export function applyCurrentTemplate() {
  const t = getCurrentTemplate();
  const thumb = $("tplCurrentThumb"), name = $("tplCurrentName");
  if (t) {
    if (thumb) thumb.src = t.src;
    if (name) name.textContent = t.name;
  }
  updateLivePreview();
  if (state.currentTemplateFile) applyLogoForTemplate(state.currentTemplateFile);
}

export function selectTemplate(file) {
  state.currentTemplateFile = file;
  for (const card of document.querySelectorAll(".pk-card")) {
    card.classList.toggle("selected", card.dataset.file === file);
  }
  // An explicit pick reveals the sharp preview (placeholder only shows until
  // the user has chosen a template).
  const pc = $("previewCol");
  if (pc) pc.classList.add("template-chosen");
  // Vollständig in den leeren Vorschau-State zurück — entkoppelt davon, ob
  // schon ein Flyer generiert wurde. Reset zuerst (verwirft das alte Ergebnis),
  // dann das neue Template anwenden. Formularfelder bleiben erhalten.
  resetToPreview();
  applyCurrentTemplate();
  closePicker();
}

// ── picker modal ─────────────────────────────────────────────────
export function renderPicker() {
  // Premium placeholder shows how many templates are available.
  const count = $("tplphCount");
  if (count) count.textContent = state.templates.length ? state.templates.length + " Vorlagen verfügbar" : "";

  const cats = $("pickerCats"), grid = $("pickerGrid");
  if (!cats || !grid) return;

  cats.innerHTML = "";
  for (const c of ["Alle", ...state.categories]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pk-cat" + (c === activeCategory ? " active" : "");
    b.dataset.cat = c;
    b.textContent = c;
    cats.appendChild(b);
  }

  grid.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const t of state.templates) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "pk-card" + (t.file === state.currentTemplateFile ? " selected" : "");
    card.dataset.file = t.file;
    card.dataset.cat = t.category;
    card.dataset.name = (t.name || "").toLowerCase();
    card.innerHTML =
      '<div class="pk-thumb"><img src="' + t.src + '" alt="" loading="lazy"></div>' +
      '<div class="pk-name"></div>';
    card.querySelector(".pk-name").textContent = t.name;
    card.addEventListener("click", () => selectTemplate(t.file));
    frag.appendChild(card);
  }
  grid.appendChild(frag);
  filterPicker();
}

function filterPicker() {
  const search = $("pickerSearch");
  const q = (search ? search.value : "").trim().toLowerCase();
  for (const card of document.querySelectorAll(".pk-card")) {
    const okCat = activeCategory === "Alle" || card.dataset.cat === activeCategory;
    const okSearch = !q || card.dataset.name.includes(q);
    card.style.display = okCat && okSearch ? "" : "none";
  }
}

export function openPicker() {
  const modal = $("pickerModal");
  if (!modal) return;
  for (const card of document.querySelectorAll(".pk-card")) {
    card.classList.toggle("selected", card.dataset.file === state.currentTemplateFile);
  }
  modal.classList.add("open");
  const s = $("pickerSearch");
  if (s) setTimeout(() => s.focus(), 60);
}

export function closePicker() {
  if (!state.currentTemplateFile) return; // can't close before any template exists
  const modal = $("pickerModal");
  if (modal) modal.classList.remove("open");
  try { localStorage.setItem("nk_template_picked", "1"); } catch {}
}

export function initPicker() {
  const x = $("pickerClose");
  if (x) x.addEventListener("click", closePicker);
  const bd = $("pickerBackdrop");
  if (bd) bd.addEventListener("click", closePicker);
  const sw = $("tplSwitch");
  if (sw) sw.addEventListener("click", openPicker);
  const ph = $("tplPlaceholder");
  if (ph) ph.addEventListener("click", openPicker);

  const search = $("pickerSearch");
  if (search) search.addEventListener("input", filterPicker);

  const cats = $("pickerCats");
  if (cats) {
    cats.addEventListener("click", (e) => {
      const b = e.target.closest(".pk-cat");
      if (!b) return;
      activeCategory = b.dataset.cat;
      for (const p of cats.querySelectorAll(".pk-cat")) p.classList.toggle("active", p === b);
      filterPicker();
    });
  }

  document.addEventListener("keydown", (e) => {
    const modal = $("pickerModal");
    if (e.key === "Escape" && modal && modal.classList.contains("open")) closePicker();
  });
}

// Auto-open the picker the first time the tool is used.
export function maybeAutoOpenPicker() {
  let seen = false;
  try { seen = !!localStorage.getItem("nk_template_picked"); } catch {}
  if (!seen) openPicker();
}
