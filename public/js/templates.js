import { state } from "./state.js";
import { $ } from "./dom.js";
import { getTemplates } from "./api.js";
import { updateLivePreview } from "./preview.js";
import { applyLogoForTemplate } from "./logo.js";
import { resetToPreview } from "./generator.js";

// Template-Katalog + Auswahl. BEIDE Auswahl-Flächen — die Inline-Galerie (leerer
// Zustand, "Wähle ein Template") und das Overlay ("Template wählen", per "Wechseln")
// — nutzen jetzt DIESELBE Komponente `createGallery`. Ein Umbau wirkt damit
// automatisch überall; sie können nie wieder auseinanderlaufen. Kategorie-Kacheln
// als Einstieg, Lazy-Loading + optimierte Thumbnails (skaliert auf 500+), Suche
// über Name + Kategorie + Schlagworte, kombinierbare Kategorie-Filter, dichtes
// Flyer-Grid, Klick = Großansicht (Lightbox) mit "Diese Vorlage wählen".

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
      state.categoryCovers = data.categoryCovers || {};
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

// Galerie + Overlay komplett neu laden (für den "Erneut versuchen"-Button).
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
  // An explicit pick reveals the sharp preview (placeholder only shows until
  // the user has chosen a template).
  const pc = $("previewCol");
  if (pc) pc.classList.add("template-chosen");
  // Vollständig in den leeren Vorschau-State zurück — entkoppelt davon, ob schon
  // ein Flyer generiert wurde. Reset zuerst (verwirft das alte Ergebnis), dann das
  // neue Template anwenden. Formularfelder bleiben erhalten.
  resetToPreview();
  applyCurrentTemplate();
  closePicker();
}

// ── Gemeinsame Galerie-Komponente ────────────────────────────────
// Repräsentatives Bild einer Kategorie. Vorrang hat ein im Admin bewusst gesetztes
// Aushängeschild (state.categoryCovers, serverseitig schon auf sichtbar + richtige
// Kategorie geprüft). Ist keins gesetzt, exakt wie bisher: featured zuerst, sonst das erste.
function categoryCover(cat) {
  const inCat = state.templates.filter((t) => t.category === cat);
  const coverFile = state.categoryCovers && state.categoryCovers[cat];
  if (coverFile) { const c = inCat.find((t) => t.file === coverFile); if (c) return c; }
  return inCat.find((t) => t.featured) || inCat[0] || null;
}

// Alle Instanzen + EIN gemeinsamer Scroll-/Resize-Handler (lädt sichtbare
// Thumbnails der aktuell offenen Fläche nach — Positionsprüfung greift für Inline
// wie Overlay, egal was scrollt).
const galleries = [];
let imgScrollRaf = 0;
function onAnyScroll() {
  if (imgScrollRaf) return;
  imgScrollRaf = requestAnimationFrame(() => { imgScrollRaf = 0; for (const g of galleries) g.loadVisible(); });
}

// EINE geteilte Großansicht (Lightbox) für beide Flächen. Volle Auflösung + Wählen.
let sharedLightbox = null;
function ensureLightbox() {
  if (sharedLightbox) return sharedLightbox;
  const ov = document.createElement("div");
  ov.className = "tg-lightbox"; ov.id = "tgLightbox"; ov.hidden = true;
  ov.innerHTML =
    '<div class="tg-lb-inner">' +
      '<button class="tg-lb-close" type="button" aria-label="Schließen">✕</button>' +
      '<img class="tg-lb-img" alt="">' +
      '<div class="tg-lb-bar"><span class="tg-lb-name"></span>' +
        '<button class="rbtn rbtn-primary tg-lb-pick" type="button">Diese Vorlage wählen</button></div>' +
    '</div>';
  ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest(".tg-lb-close")) closeLightbox(); });
  document.body.appendChild(ov);
  sharedLightbox = ov;
  return ov;
}
function openLightbox(t) {
  const ov = ensureLightbox();
  ov.querySelector(".tg-lb-img").src = t.src; // volle Auflösung NUR hier
  ov.querySelector(".tg-lb-name").textContent = t.name || "";
  ov.querySelector(".tg-lb-pick").onclick = () => { closeLightbox(); selectTemplate(t.file); };
  ov.hidden = false;
}
function closeLightbox() { if (sharedLightbox) sharedLightbox.hidden = true; }

// Fabrik: erzeugt eine eigenständige Galerie-Instanz mit EIGENEM Zustand, die auf
// die per cfg übergebenen Elemente rendert. cfg: { grid, cats, search, count?,
// empty?, error?, retry? } (IDs; die optionalen dürfen fehlen).
function createGallery(cfg) {
  const el = (id) => (id ? document.getElementById(id) : null);
  const BATCH = 24;
  let view = "categories", category = "Alle", search = "", list = [], shown = 0, observer = null, pendingImgs = [];
  const activeKw = new Set(); // aktive Schlagwort-Filter-Chips (kombinierbar, UND-Logik)
  let kwbarEl = null;         // Chip-Leiste (lazy erzeugt, als Geschwister nach cfg.cats)

  function loadVisible() {
    if (!pendingImgs.length) return;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const margin = 800;
    pendingImgs = pendingImgs.filter((img) => {
      const r = img.getBoundingClientRect();
      if (r.bottom > -margin && r.top < vh + margin && img.dataset.src) {
        img.src = img.dataset.src;
        img.removeAttribute("data-src");
        const card = img.closest(".tg-card"); if (card) card.classList.add("loading");
      }
      return !!img.dataset.src;
    });
  }
  function lazyThumb(t) {
    const img = document.createElement("img");
    img.alt = t.name || ""; img.loading = "lazy";
    img.dataset.src = t.thumb || t.src; // optimiertes /api/thumb, nicht die volle Auflösung
    pendingImgs.push(img);
    return img;
  }
  function setCount(txt) { const c = el(cfg.count); if (c) c.textContent = txt; }
  // Gesamtzahl als prominenter Untertitel unter der Ueberschrift (nur Kategorie-Uebersicht).
  function setSubtitle(html, show) {
    const s = el(cfg.subtitle); if (!s) return;
    if (show) { s.innerHTML = html; s.hidden = false; } else { s.innerHTML = ""; s.hidden = true; }
  }
  // Sanfter Bild-Wechsel beim Hover (nur Desktop/Maus). Zwei gestapelte Ebenen ueber dem
  // ruhenden Aushaengeschild, echtes Ueberblenden. Die Wechselbilder werden ERST beim
  // ersten Hover geladen (nicht beim Seitenaufbau). Auf Touch wird das nie verdrahtet.
  function wireHoverCycle(card, thumb, frames) {
    let layers = null, front = 0, idx = 0, timer = null, hovering = false;
    const revealNext = (url) => {
      const back = layers[front ^ 1];
      const reveal = () => {
        if (!hovering) return; // nach dem Verlassen ein spaet geladenes Bild NICHT mehr einblenden
        back.style.opacity = "1"; layers[front].style.opacity = "0"; front ^= 1;
      };
      if (back.dataset.url === url && back.complete) { reveal(); return; }
      back.dataset.url = url; back.onload = reveal; back.src = url; // laedt erst hier (bei Bedarf)
    };
    const start = () => {
      hovering = true;
      if (!layers) {
        layers = [document.createElement("img"), document.createElement("img")];
        for (const L of layers) { L.className = "tg-catcard-hoverimg"; L.alt = ""; L.decoding = "async"; thumb.appendChild(L); }
      }
      idx = 0; revealNext(frames[0]);
      clearInterval(timer);
      timer = setInterval(() => { if (hovering) { idx = (idx + 1) % frames.length; revealNext(frames[idx]); } }, 1500);
    };
    const stop = () => {
      hovering = false;
      clearInterval(timer); timer = null;
      if (layers) { layers[0].style.opacity = "0"; layers[1].style.opacity = "0"; } // zurueck zum Aushaengeschild
    };
    card.addEventListener("mouseenter", start);
    card.addEventListener("mouseleave", stop);
  }

  // Kategorie-Filter UND Suche (Name + Kategorie + Schlagworte) kombiniert.
  function flyersList() {
    const q = search.trim().toLowerCase();
    let l = category === "Alle" ? state.templates : state.templates.filter((t) => t.category === category);
    // Schlagwort-Chips: jeder aktive Chip MUSS im Flyer stecken (UND / kombinierbar).
    if (activeKw.size) l = l.filter((t) => {
      const ks = (t.keywords || []).map((k) => String(k).toLowerCase());
      return [...activeKw].every((a) => ks.includes(a));
    });
    if (q) l = l.filter((t) =>
      (t.name || "").toLowerCase().includes(q) ||
      (t.category || "").toLowerCase().includes(q) ||
      (t.keywords || []).some((k) => String(k).toLowerCase().includes(q)));
    return l;
  }

  // Häufigste Schlagworte der aktuellen Kategorie (für die Filter-Chips).
  function topKeywords() {
    const scope = category === "Alle" ? state.templates : state.templates.filter((t) => t.category === category);
    const n = scope.length || 1;
    const freq = new Map();
    for (const t of scope) for (const k of new Set((t.keywords || []).map((x) => String(x).toLowerCase()))) {
      if (!k) continue;
      freq.set(k, (freq.get(k) || 0) + 1);
    }
    // Nur UNTERSCHEIDENDE Chips: von mind. 2 Flyern geteilt, aber NICHT auf über 80 %
    // aller Flyer (Allerwelts-Tags unterscheiden nicht → werden nicht als Filter angeboten).
    return [...freq.entries()]
      .filter(([, c]) => c >= 2 && c / n <= 0.8)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map((e) => e[0]);
  }
  function ensureKwbar() {
    if (kwbarEl) return kwbarEl;
    const cats = el(cfg.cats);
    if (!cats || !cats.parentNode) return null;
    kwbarEl = document.createElement("div");
    kwbarEl.className = "tg-kwbar";
    cats.parentNode.insertBefore(kwbarEl, cats.nextSibling); // zwischen Kategorie-Pills und Grid
    return kwbarEl;
  }
  function renderKwbar() {
    const bar = ensureKwbar();
    if (!bar) return;
    const chips = [...new Set([...topKeywords(), ...activeKw])]; // aktive immer sichtbar
    if (!chips.length) { bar.hidden = true; bar.innerHTML = ""; return; }
    bar.hidden = false; bar.innerHTML = "";
    // Kleines „Filter"-Label, damit die Tag-Zeile klar von der Kategorie-Leiste darüber getrennt ist.
    const label = document.createElement("span");
    label.className = "tg-kw-label"; label.textContent = "Filter";
    bar.appendChild(label);
    for (const w of chips) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tg-kw" + (activeKw.has(w) ? " active" : "");
      b.textContent = w;
      b.addEventListener("click", () => {
        if (activeKw.has(w)) activeKw.delete(w); else activeKw.add(w);
        renderKwbar();
        applyFlyers();
      });
      bar.appendChild(b);
    }
  }

  // ── Kategorie-Übersicht (Einstieg) ──
  function renderCategories() {
    const grid = el(cfg.grid), cats = el(cfg.cats), empty = el(cfg.empty);
    if (!grid) return;
    if (cats) { cats.innerHTML = ""; cats.hidden = true; }
    if (kwbarEl) { kwbarEl.hidden = true; kwbarEl.innerHTML = ""; }
    if (empty) empty.hidden = true;
    setCount(""); // Gesamtzahl steht jetzt prominent als Untertitel unter der Ueberschrift
    setSubtitle("<strong>" + state.templates.length + " Flyer</strong> in " + state.categories.length + " Kategorien", true);
    const canHover = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    pendingImgs = [];
    grid.classList.add("tg-grid", "tg-grid--cats");
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
      // Anzahl gut lesbar als dezentes Badge auf der Kachel (Desktop UND Mobile).
      const badge = document.createElement("span");
      badge.className = "tg-catcard-badge";
      badge.textContent = e.count + " Flyer";
      thumb.appendChild(badge);
      const meta = document.createElement("div");
      meta.className = "tg-catcard-meta";
      meta.innerHTML = '<span class="tg-catcard-name"></span>';
      meta.querySelector(".tg-catcard-name").textContent = e.category;
      card.appendChild(thumb);
      card.appendChild(meta);
      card.addEventListener("click", () => openCategory(e.category));
      // Sanfter Bild-Wechsel beim Hover, nur Desktop/Maus. Wechselbilder DIESER Kategorie,
      // Overlays beachtet: state.templates ist bereits ohne ausgeblendete und in gesetzter
      // Reihenfolge. Erst beim ersten Hover geladen (siehe wireHoverCycle).
      if (canHover) {
        const inCat = e.all ? state.templates : state.templates.filter((t) => t.category === e.category);
        const coverFile = e.cover && e.cover.file;
        const frames = inCat.filter((t) => t.file !== coverFile).slice(0, 3).map((t) => t.thumb || t.src).filter(Boolean);
        if (frames.length) wireHoverCycle(card, thumb, frames);
      }
      frag.appendChild(card);
    }
    grid.appendChild(frag);
    loadVisible();
  }

  function openCategory(cat) {
    view = "flyers"; category = cat; search = ""; activeKw.clear();
    const s = el(cfg.search); if (s) s.value = "";
    renderFlyers();
  }
  function backToCategories() {
    view = "categories"; category = "Alle"; search = ""; activeKw.clear();
    const s = el(cfg.search); if (s) s.value = "";
    renderCategories();
  }

  // ── Flyer-Ansicht (dichtes Grid) ──
  function renderChrome() {
    const cats = el(cfg.cats);
    if (!cats) return;
    cats.hidden = false;
    cats.innerHTML = "";
    const back = document.createElement("button");
    back.type = "button"; back.className = "tg-back"; back.textContent = "← Kategorien";
    cats.appendChild(back);
    for (const c of ["Alle", ...state.categories]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tg-cat" + (c === category ? " active" : "");
      b.dataset.cat = c;
      b.textContent = c;
      cats.appendChild(b);
    }
  }

  function flyerCard(t, i) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "tg-card" + (t.file === state.currentTemplateFile ? " selected" : "");
    card.dataset.file = t.file;
    card.style.animationDelay = Math.min(i * 12, 240) + "ms";
    const img = lazyThumb(t);
    const done = () => card.classList.add("loaded");
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    card.appendChild(img);
    card.addEventListener("click", () => openLightbox(t)); // Klick = Großansicht
    return card;
  }

  function renderNext() {
    const grid = el(cfg.grid);
    if (!grid) return;
    const slice = list.slice(shown, shown + BATCH);
    const frag = document.createDocumentFragment();
    slice.forEach((t, i) => frag.appendChild(flyerCard(t, shown + i)));
    grid.appendChild(frag);
    shown += slice.length;
    loadVisible();
    observeMore();
  }
  function observeMore() {
    if (observer) { observer.disconnect(); observer = null; }
    if (shown >= list.length) return;
    const grid = el(cfg.grid);
    const last = grid && grid.lastElementChild;
    if (!last || typeof IntersectionObserver === "undefined") return;
    observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect(); observer = null;
        renderNext();
      }
    }, { root: grid, rootMargin: "300px" });
    observer.observe(last);
  }
  function applyFlyers() {
    list = flyersList();
    shown = 0;
    if (observer) { observer.disconnect(); observer = null; }
    pendingImgs = [];
    const grid = el(cfg.grid), empty = el(cfg.empty);
    if (grid) { grid.scrollTop = 0; grid.innerHTML = ""; grid.style.display = list.length ? "" : "none"; }
    if (empty) empty.hidden = list.length > 0;
    setSubtitle("", false); // der prominente Gesamt-Untertitel gilt nur fuer die Kategorie-Uebersicht
    setCount((search.trim() ? '„' + search.trim() + '"' : (category === "Alle" ? "Alle" : category)) + " · " + list.length);
    renderNext();
  }
  function renderFlyers() {
    const grid = el(cfg.grid);
    if (grid) { grid.classList.add("tg-grid"); grid.classList.remove("tg-grid--cats"); grid.classList.add("tg-grid--dense"); }
    renderChrome();
    renderKwbar();
    applyFlyers();
  }

  function dispatch() { view === "categories" ? renderCategories() : renderFlyers(); }

  function render() {
    const grid = el(cfg.grid);
    if (!grid) return;
    const err = el(cfg.error);
    // Der Katalog ist nie legitim leer. Ist er leer, ist das Laden fehlgeschlagen
    // → klare Meldung/Retry (falls vorhanden), statt stumm eine leere Fläche.
    if (!state.templates.length) {
      if (err) err.hidden = false;
      grid.innerHTML = ""; grid.style.display = "none";
      const empty = el(cfg.empty); if (empty) empty.hidden = true;
      const cats = el(cfg.cats); if (cats) { cats.innerHTML = ""; cats.hidden = true; }
      setCount("");
      return;
    }
    if (err) err.hidden = true;
    // Immer mit der Kategorie-Übersicht starten.
    view = "categories"; category = "Alle"; search = ""; activeKw.clear();
    const s = el(cfg.search); if (s) s.value = "";
    dispatch();
  }

  function bindControls() {
    const s = el(cfg.search);
    if (s) s.addEventListener("input", () => {
      search = s.value;
      if (search.trim() && view === "categories") view = "flyers"; // Suche → Flyer-Ansicht
      dispatch();
    });
    const retry = el(cfg.retry);
    if (retry) retry.addEventListener("click", () => reloadTemplates(retry));
    const grid = el(cfg.grid);
    if (grid) grid.addEventListener("scroll", () => {
      if (view === "flyers" && shown < list.length && grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 400) renderNext();
    });
    const cats = el(cfg.cats);
    if (cats) cats.addEventListener("click", (e) => {
      if (e.target.closest(".tg-back")) { backToCategories(); return; }
      const b = e.target.closest(".tg-cat");
      if (!b) return;
      category = b.dataset.cat;
      for (const p of cats.querySelectorAll(".tg-cat")) p.classList.toggle("active", p === b);
      applyFlyers(); // Suchbegriff bleibt → Kategorie + Suche kombinierbar
    });
  }

  const inst = { render, bindControls, loadVisible };
  galleries.push(inst);
  return inst;
}

// Zwei Instanzen derselben Komponente: Inline-Galerie (Leerzustand) + Overlay.
const inlineGallery = createGallery({
  grid: "tgGrid", cats: "tgCats", search: "tgSearch", count: "tgCount", subtitle: "tgSubtitle", empty: "tgEmpty", error: "tgError", retry: "tgRetry",
});
const modalGallery = createGallery({
  grid: "pickerGrid", cats: "pickerCats", search: "pickerSearch", subtitle: "pickerSubtitle",
});

export function renderGallery() { inlineGallery.render(); }
export function renderPicker() { modalGallery.render(); }

// ── Overlay öffnen/schließen ─────────────────────────────────────
export function openPicker() {
  const modal = $("pickerModal");
  if (!modal) return;
  modalGallery.render(); // frische Kategorie-Übersicht bei jedem Öffnen
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

  // Beide Flächen dieselbe Komponente verdrahten.
  inlineGallery.bindControls();
  modalGallery.bindControls();

  // Ein gemeinsamer Scroll-/Resize-Handler lädt sichtbare Thumbnails nach (Capture
  // fängt Seiten- wie Grid-/Overlay-Scrollen).
  window.addEventListener("scroll", onAnyScroll, true);
  window.addEventListener("resize", onAnyScroll);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (sharedLightbox && !sharedLightbox.hidden) { closeLightbox(); return; } // Lightbox zuerst
    const modal = $("pickerModal");
    if (modal && modal.classList.contains("open")) closePicker();
  });
}

// Auto-open the picker the first time the tool is used.
export function maybeAutoOpenPicker() {
  let seen = false;
  try { seen = !!localStorage.getItem("nk_template_picked"); } catch {}
  if (!seen) openPicker();
}
