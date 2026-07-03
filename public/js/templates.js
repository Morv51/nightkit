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
    if (thumb) thumb.src = t.thumb || t.src; // kleines Thumbnail reicht für den Chip
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
    // Kleines Thumbnail statt Vollbild (Performance bei 500+).
    card.innerHTML =
      '<div class="pk-thumb"><img src="' + (t.thumb || t.src) + '" alt="" loading="lazy"></div>' +
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
    const okSearch = !q || card.dataset.name.includes(q) || (card.dataset.cat || "").toLowerCase().includes(q);
    card.style.display = okCat && okSearch ? "" : "none";
  }
}

// ── Inline-Galerie (Empty State) — skaliert auf 500+ Flyer ────────
// Start mit KATEGORIE-KACHELN (Cover + Name + Anzahl). Klick öffnet die Kategorie
// und zeigt deren Flyer als dichtes, lazy nachladendes Grid; „← Kategorien" führt
// zurück, „Alle" zeigt kategorieübergreifend. Suche (Name + Kategorie +
// Schlagwort) und Kategorie-Pills wirken zusammen. Klick auf einen Flyer öffnet
// die Großansicht (Lightbox) mit „Diese Vorlage wählen". Auswahl-Weg identisch
// zum Modal-Picker (selectTemplate).
const GALLERY_BATCH = 24;       // Flyer pro Lade-Schritt
let galleryView = "categories"; // "categories" | "flyers"
let galleryCategory = "Alle";   // aktive Kategorie in der Flyer-Ansicht
let gallerySearch = "";
let galleryList = [];
let galleryShown = 0;
let galleryObserver = null;

// Thumbnails laden erst, wenn ihre Karte (fast) im Sichtfeld ist — über die echte
// Bildschirmposition (getBoundingClientRect), unabhängig davon, was scrollt (Seite
// auf Mobil, Grid auf Desktop). Wichtig, damit nicht alle Bilder auf einmal laden.
let pendingImgs = [];
function loadVisibleGalleryImgs() {
  if (!pendingImgs.length) return;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const margin = 800; // etwas vorausladen, damit nichts leer in den Blick scrollt
  pendingImgs = pendingImgs.filter((img) => {
    const r = img.getBoundingClientRect();
    if (r.bottom > -margin && r.top < vh + margin && img.dataset.src) {
      img.src = img.dataset.src;
      img.removeAttribute("data-src");
      // Skeleton-Shimmer erst JETZT (beim echten Laden) — nicht auf hunderten
      // Off-Screen-Karten dauerlaufen lassen (Performance bei 500+).
      const card = img.closest(".tg-card"); if (card) card.classList.add("loading");
    }
    return !!img.dataset.src; // noch ungeladen → in der Warteschlange behalten
  });
}
let imgScrollRaf = 0;
export function onGalleryScroll() {
  if (imgScrollRaf) return;
  imgScrollRaf = requestAnimationFrame(() => { imgScrollRaf = 0; loadVisibleGalleryImgs(); });
}

// Kleines, lazy geladenes Thumbnail (data-src → src erst im Sichtfeld). Nutzt das
// optimierte /api/thumb, nicht die volle Auflösung.
function lazyThumb(t) {
  const img = document.createElement("img");
  img.alt = t.name || "";
  img.loading = "lazy";
  img.dataset.src = t.thumb || t.src;
  pendingImgs.push(img);
  return img;
}

// Repräsentatives Bild einer Kategorie (featured zuerst, sonst das erste).
function categoryCover(cat) {
  const inCat = state.templates.filter((t) => t.category === cat);
  return inCat.find((t) => t.featured) || inCat[0] || null;
}

// Aktuelle Flyer-Trefferliste: Kategorie-Filter UND Suche (Name + Kategorie +
// Schlagworte) kombiniert. Das Schlagwort-Feld ist für die spätere Befüllung da.
function galleryFlyersList() {
  const q = gallerySearch.trim().toLowerCase();
  let list = galleryCategory === "Alle" ? state.templates
    : state.templates.filter((t) => t.category === galleryCategory);
  if (q) list = list.filter((t) =>
    (t.name || "").toLowerCase().includes(q) ||
    (t.category || "").toLowerCase().includes(q) ||
    (t.keywords || []).some((k) => String(k).toLowerCase().includes(q)));
  return list;
}

// ── Kategorie-Übersicht (Standard-Start) ──
function renderCategories() {
  const grid = $("tgGrid"), cats = $("tgCats"), empty = $("tgEmpty"), count = $("tgCount");
  if (!grid) return;
  if (cats) { cats.innerHTML = ""; cats.hidden = true; }
  if (empty) empty.hidden = true;
  if (count) count.textContent = state.templates.length + " Vorlagen · " + state.categories.length + " Kategorien";
  pendingImgs = [];
  grid.classList.add("tg-grid--cats");
  grid.classList.remove("tg-grid--dense");
  grid.style.display = "";
  grid.scrollTop = 0;
  grid.innerHTML = "";
  const entries = [
    { category: "Alle", cover: state.templates[0], count: state.templates.length, all: true },
    ...state.categories.map((c) => ({
      category: c, cover: categoryCover(c), count: state.templates.filter((t) => t.category === c).length,
    })),
  ];
  const frag = document.createDocumentFragment();
  for (const e of entries) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "tg-catcard" + (e.all ? " tg-catcard--all" : "");
    card.dataset.cat = e.category;
    const thumb = document.createElement("div");
    thumb.className = "tg-catcard-thumb";
    if (e.cover) thumb.appendChild(lazyThumb(e.cover));
    const meta = document.createElement("div");
    meta.className = "tg-catcard-meta";
    meta.innerHTML = '<span class="tg-catcard-name"></span><span class="tg-catcard-count"></span>';
    meta.querySelector(".tg-catcard-name").textContent = e.category;
    meta.querySelector(".tg-catcard-count").textContent = e.count;
    card.appendChild(thumb);
    card.appendChild(meta);
    card.addEventListener("click", () => openCategory(e.category));
    frag.appendChild(card);
  }
  grid.appendChild(frag);
  loadVisibleGalleryImgs();
}

function openCategory(cat) {
  galleryView = "flyers";
  galleryCategory = cat;
  gallerySearch = "";
  const s = $("tgSearch"); if (s) s.value = "";
  renderFlyers();
}
function backToCategories() {
  galleryView = "categories";
  galleryCategory = "Alle";
  gallerySearch = "";
  const s = $("tgSearch"); if (s) s.value = "";
  renderCategories();
}

// ── Flyer-Ansicht (dichtes Grid innerhalb einer Kategorie / Suche) ──
function renderFlyersChrome() {
  const cats = $("tgCats");
  if (!cats) return;
  cats.hidden = false;
  cats.innerHTML = "";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "tg-back";
  back.textContent = "← Kategorien";
  cats.appendChild(back);
  for (const c of ["Alle", ...state.categories]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tg-cat" + (c === galleryCategory ? " active" : "");
    b.dataset.cat = c;
    b.textContent = c;
    cats.appendChild(b);
  }
}

function flyerCard(t, i) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "tg-card";
  card.dataset.file = t.file;
  card.style.animationDelay = Math.min(i * 12, 240) + "ms";
  const img = lazyThumb(t);
  const done = () => card.classList.add("loaded"); // entfernt das Skeleton-Shimmer
  img.addEventListener("load", done, { once: true });
  img.addEventListener("error", done, { once: true });
  card.appendChild(img);
  card.addEventListener("click", () => openFlyerLightbox(t)); // Klick = Großansicht
  return card;
}

function galleryRenderNext() {
  const grid = $("tgGrid");
  if (!grid) return;
  const slice = galleryList.slice(galleryShown, galleryShown + GALLERY_BATCH);
  const frag = document.createDocumentFragment();
  slice.forEach((t, i) => frag.appendChild(flyerCard(t, galleryShown + i)));
  grid.appendChild(frag);
  galleryShown += slice.length;
  loadVisibleGalleryImgs(); // sofort die jetzt sichtbaren Thumbnails laden
  galleryObserve();
}

// IntersectionObserver am letzten Element: lädt beim Heranscrollen die nächste
// Charge nach. Wird bei jedem Filter-/Suchwechsel zurückgesetzt.
function galleryObserve() {
  if (galleryObserver) { galleryObserver.disconnect(); galleryObserver = null; }
  if (galleryShown >= galleryList.length) return;
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

// Flyer-Liste anwenden: Treffer bestimmen, Lazy-Counter zurück, erste Charge.
function galleryApply() {
  galleryList = galleryFlyersList();
  galleryShown = 0;
  if (galleryObserver) { galleryObserver.disconnect(); galleryObserver = null; }
  pendingImgs = [];
  const grid = $("tgGrid"), empty = $("tgEmpty"), count = $("tgCount");
  if (grid) { grid.scrollTop = 0; grid.innerHTML = ""; grid.style.display = galleryList.length ? "" : "none"; }
  if (empty) empty.hidden = galleryList.length > 0;
  if (count) {
    const scope = gallerySearch.trim() ? '„' + gallerySearch.trim() + '"'
      : (galleryCategory === "Alle" ? "Alle" : galleryCategory);
    count.textContent = scope + " · " + galleryList.length;
  }
  galleryRenderNext();
}

function renderFlyers() {
  const grid = $("tgGrid");
  if (grid) { grid.classList.remove("tg-grid--cats"); grid.classList.add("tg-grid--dense"); }
  renderFlyersChrome();
  galleryApply();
}

// Dispatcher: Kategorie-Übersicht oder Flyer-Ansicht.
function galleryRender() {
  if (galleryView === "categories") renderCategories();
  else renderFlyers();
}

// ── Großansicht (Lightbox) — volle Auflösung + „Vorlage wählen" ──
let flyerLightbox = null;
function ensureFlyerLightbox() {
  if (flyerLightbox) return flyerLightbox;
  const ov = document.createElement("div");
  ov.className = "tg-lightbox";
  ov.id = "tgLightbox";
  ov.hidden = true;
  ov.innerHTML =
    '<div class="tg-lb-inner">' +
      '<button class="tg-lb-close" type="button" aria-label="Schließen">✕</button>' +
      '<img class="tg-lb-img" alt="">' +
      '<div class="tg-lb-bar"><span class="tg-lb-name"></span>' +
        '<button class="rbtn rbtn-primary tg-lb-pick" type="button">Diese Vorlage wählen</button></div>' +
    '</div>';
  ov.addEventListener("click", (e) => {
    if (e.target === ov || e.target.closest(".tg-lb-close")) closeFlyerLightbox();
  });
  document.body.appendChild(ov);
  flyerLightbox = ov;
  return ov;
}
function openFlyerLightbox(t) {
  const ov = ensureFlyerLightbox();
  ov.querySelector(".tg-lb-img").src = t.src; // volle Auflösung NUR hier
  ov.querySelector(".tg-lb-name").textContent = t.name || "";
  ov.querySelector(".tg-lb-pick").onclick = () => { closeFlyerLightbox(); selectTemplate(t.file); };
  ov.hidden = false;
}
function closeFlyerLightbox() { if (flyerLightbox) flyerLightbox.hidden = true; }

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
    const cats = $("tgCats"); if (cats) { cats.innerHTML = ""; cats.hidden = true; }
    const cnt = $("tgCount"); if (cnt) cnt.textContent = "";
    return;
  }
  if (err) err.hidden = true;
  // Immer mit der Kategorie-Übersicht starten (nicht sofort alle Flyer).
  galleryView = "categories";
  galleryCategory = "Alle";
  gallerySearch = "";
  const s = $("tgSearch"); if (s) s.value = "";
  galleryRender();
}

// Suche + Filter-Pills + Zurück verdrahten (aus initPicker aufgerufen).
export function bindGalleryControls() {
  const search = $("tgSearch");
  if (search) search.addEventListener("input", () => {
    gallerySearch = search.value;
    // Suche wechselt in die Flyer-Ansicht (kategorieübergreifend, wenn aus der Übersicht).
    if (gallerySearch.trim() && galleryView === "categories") galleryView = "flyers";
    galleryRender();
  });
  const retry = $("tgRetry");
  if (retry) retry.addEventListener("click", () => reloadTemplates(retry));
  // Thumbnails beim Scrollen nachladen — Capture auf window fängt Seiten- (Mobil)
  // und Grid-Scrollen (Desktop).
  window.addEventListener("scroll", onGalleryScroll, true);
  window.addEventListener("resize", onGalleryScroll);
  // Mehr Karten nachladen, wenn das Grid nahe ans Ende scrollt (Desktop).
  const grid = $("tgGrid");
  if (grid) grid.addEventListener("scroll", () => {
    if (galleryView === "flyers" && galleryShown < galleryList.length &&
        grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 400) {
      galleryRenderNext();
    }
  });
  const cats = $("tgCats");
  if (cats) cats.addEventListener("click", (e) => {
    if (e.target.closest(".tg-back")) { backToCategories(); return; }
    const b = e.target.closest(".tg-cat");
    if (!b) return;
    galleryCategory = b.dataset.cat;
    for (const p of cats.querySelectorAll(".tg-cat")) p.classList.toggle("active", p === b);
    galleryApply(); // Suchbegriff bleibt erhalten → Kategorie + Suche kombinierbar
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && flyerLightbox && !flyerLightbox.hidden) closeFlyerLightbox();
  });
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
