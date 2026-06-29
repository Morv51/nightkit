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
  // Ein automatischer Wiederholversuch überlebt einen einmaligen Aussetzer beim
  // Seitenaufbau (langsames Netz, kurzer Timeout) — sonst bliebe die Galerie für
  // diesen User dauerhaft leer, bis er die Seite neu lädt.
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await getTemplates();
      state.templates = data.templates;
      state.categories = data.categories;
      if (!state.currentTemplateFile && state.templates[0]) {
        state.currentTemplateFile = state.templates[0].file;
      }
      return;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

// Galerie + Picker komplett neu laden (für den "Erneut versuchen"-Button, wenn
// das Laden fehlgeschlagen war).
export async function reloadTemplates(btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Lädt…"; }
  try {
    await loadTemplates();
  } catch (e) {
    console.error("Templates konnten nicht geladen werden:", e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Erneut versuchen"; }
  }
  renderPicker();
  renderGallery();
  applyCurrentTemplate();
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

// ── Inline-Galerie (Empty State) ─────────────────────────────────
// Skalierbar bei großen Bibliotheken: kuratierte "Beliebt"-Startauswahl,
// Kategorie-Filter, Live-Suche und Lazy-Loading (Batches + IntersectionObserver).
// Ein Klick nutzt dieselbe Auswahl-Logik wie der Modal-Picker (selectTemplate).
const GALLERY_BATCH = 18;       // Templates pro Lade-Schritt
const FEATURED_FALLBACK = 12;   // erste N, falls kein Template "featured" gesetzt ist
let galleryCategory = "Beliebt";
let gallerySearch = "";
let galleryList = [];           // aktuell gefilterte Liste
let galleryShown = 0;           // bereits gerenderte Anzahl
let galleryObserver = null;

function galleryFeatured() {
  const feat = state.templates.filter((t) => t.featured);
  return feat.length ? feat : state.templates.slice(0, FEATURED_FALLBACK);
}

// Aktuelle Trefferliste: Suche hat Vorrang (Name + Kategorie), sonst der
// gewählte Filter ("Beliebt" = kuratiert, "Alle" = komplett, sonst Kategorie).
function galleryFiltered() {
  const q = gallerySearch.trim().toLowerCase();
  if (q) {
    return state.templates.filter((t) =>
      (t.name || "").toLowerCase().includes(q) || (t.category || "").toLowerCase().includes(q));
  }
  if (galleryCategory === "Beliebt") return galleryFeatured();
  if (galleryCategory === "Alle") return state.templates;
  return state.templates.filter((t) => t.category === galleryCategory);
}

function galleryCard(t, i) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "tg-card";
  card.dataset.file = t.file;
  card.style.animationDelay = Math.min(i * 18, 280) + "ms"; // schneller Stagger
  const img = document.createElement("img");
  img.alt = t.name || "";
  img.loading = "lazy"; // wichtig bei großen Bibliotheken — nur Sichtbares laden
  const done = () => card.classList.add("loaded"); // entfernt das Skeleton-Shimmer
  img.addEventListener("load", done, { once: true });
  img.addEventListener("error", done, { once: true });
  img.src = t.src;
  if (img.complete && img.naturalWidth) done();
  card.appendChild(img);
  card.addEventListener("click", () => selectTemplate(t.file));
  return card;
}

function galleryRenderNext() {
  const grid = $("tgGrid");
  if (!grid) return;
  const slice = galleryList.slice(galleryShown, galleryShown + GALLERY_BATCH);
  const frag = document.createDocumentFragment();
  slice.forEach((t, i) => frag.appendChild(galleryCard(t, galleryShown + i)));
  grid.appendChild(frag);
  galleryShown += slice.length;
  galleryObserve();
}

// IntersectionObserver am letzten gerenderten Element: lädt beim Heranscrollen
// die nächste Charge nach. Wird bei jedem Filter-/Suchwechsel zurückgesetzt.
function galleryObserve() {
  if (galleryObserver) { galleryObserver.disconnect(); galleryObserver = null; }
  if (galleryShown >= galleryList.length) return; // alles gerendert
  const grid = $("tgGrid");
  const last = grid && grid.lastElementChild;
  if (!last || typeof IntersectionObserver === "undefined") return;
  galleryObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      galleryObserver.disconnect(); galleryObserver = null;
      galleryRenderNext();
    }
  }, { root: grid, rootMargin: "300px" });
  galleryObserver.observe(last);
}

// Filter/Suche anwenden: Liste neu bestimmen, Lazy-Counter zurück, erste Charge.
function galleryApply() {
  galleryList = galleryFiltered();
  galleryShown = 0;
  if (galleryObserver) { galleryObserver.disconnect(); galleryObserver = null; }
  const grid = $("tgGrid"), empty = $("tgEmpty");
  if (grid) { grid.scrollTop = 0; grid.innerHTML = ""; grid.style.display = galleryList.length ? "" : "none"; }
  if (empty) empty.hidden = galleryList.length > 0;
  galleryRenderNext();
}

export function renderGallery() {
  if (!$("tgGrid")) return;
  // Der Katalog ist nie legitim leer. Ist er hier leer, ist das Laden
  // fehlgeschlagen (Netz/Cache/Blocker) → klare Meldung + Retry zeigen, statt
  // stumm eine leere Galerie (oder ein irreführendes "passe deine Suche an").
  const err = $("tgError");
  if (!state.templates.length) {
    if (err) err.hidden = false;
    const grid = $("tgGrid"); if (grid) { grid.innerHTML = ""; grid.style.display = "none"; }
    const empty = $("tgEmpty"); if (empty) empty.hidden = true;
    const cnt = $("tgCount"); if (cnt) cnt.textContent = "";
    return;
  }
  if (err) err.hidden = true;
  const count = $("tgCount");
  if (count) count.textContent = state.templates.length ? state.templates.length + " Vorlagen" : "";
  const cats = $("tgCats");
  if (cats) {
    cats.innerHTML = "";
    for (const c of ["Beliebt", "Alle", ...state.categories]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tg-cat" + (c === galleryCategory ? " active" : "");
      b.dataset.cat = c;
      b.textContent = c;
      cats.appendChild(b);
    }
  }
  galleryApply();
}

// Suche + Filter-Pills verdrahten (aus initPicker aufgerufen).
export function bindGalleryControls() {
  const search = $("tgSearch");
  if (search) search.addEventListener("input", () => { gallerySearch = search.value; galleryApply(); });
  const retry = $("tgRetry");
  if (retry) retry.addEventListener("click", () => reloadTemplates(retry));
  // Lazy-Load-Fallback: zusätzlich zum IntersectionObserver auch auf Scroll
  // nahe dem Ende nachladen (robust, falls IO mal nicht greift).
  const grid = $("tgGrid");
  if (grid) grid.addEventListener("scroll", () => {
    if (galleryShown < galleryList.length && grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 400) {
      galleryRenderNext();
    }
  });
  const cats = $("tgCats");
  if (cats) {
    cats.addEventListener("click", (e) => {
      const b = e.target.closest(".tg-cat");
      if (!b) return;
      galleryCategory = b.dataset.cat;
      gallerySearch = "";
      const s = $("tgSearch"); if (s) s.value = ""; // Kategorie-Klick setzt die Suche zurück
      for (const p of cats.querySelectorAll(".tg-cat")) p.classList.toggle("active", p === b);
      galleryApply();
    });
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

  // Suche + Filter-Pills der Inline-Galerie (Empty State)
  bindGalleryControls();

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
