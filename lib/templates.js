"use strict";

const fs = require("fs");
const path = require("path");
const keywordStore = require("./keywords"); // Flyer-Schlagworte (templates/keywords.json)

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");
const IMAGE_RE = /\.(jpe?g|png)$/i;

const bufferCache = new Map();

// "basshall-tropical.jpg" -> "Basshall Tropical"
function labelize(file) {
  return file
    .replace(IMAGE_RE, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Optional /templates/templates.json: [{ file, name, category }]. Used to give
// nicer names/categories than the filename; any file missing from it falls back
// to a Title-Cased filename and category "Sonstige". Returns a file→entry map.
function readManifest() {
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, "templates.json"), "utf8"));
    if (!Array.isArray(arr)) return {};
    const map = {};
    for (const e of arr) if (e && e.file) map[e.file] = e;
    return map;
  } catch {
    return {};
  }
}

// Rekursiv jedes Bild einsammeln. Der ERSTE Ordner unter templates/ ist die
// KATEGORIE (z. B. templates/Back to 2000/foo.jpg → Kategorie "Back to 2000").
// Bilder direkt im Wurzelordner bleiben als "Sonstige" erhalten.
function walk(dir, topCat, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    // "." = versteckt, "_" = privat (Parkplatz/Archiv) → nicht öffentlich.
    if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, topCat || e.name, out); // erste Ordnerebene = Kategorie
    } else if (IMAGE_RE.test(e.name)) {
      const rel = path.relative(TEMPLATES_DIR, full).split(path.sep).join("/");
      out.push({ rel, base: e.name, category: topCat || "Sonstige" });
    }
  }
}

// Auto-discovery: jedes Bild unter /templates wird ein Template. Kategorie =
// Ordnername (dynamisch aus der Struktur, NICHT hartkodiert). Bei jedem Aufruf
// gelesen (günstig) → ein neuer Ordner/eine neue Datei erscheint OHNE Code-
// Änderung. Das optionale Manifest liefert weiterhin schönere Namen / featured /
// uppercase je Basis-Dateiname (Kategorie kommt aber immer aus dem Ordner).
// Roh-Aufbau aus dem Repo-Ordner (Discovery + Manifest + Keywords). Genau das
// bisherige list()-Verhalten: alle Templates, Kategorie IMMER aus dem Ordner.
function buildItems() {
  const items = [];
  walk(TEMPLATES_DIR, null, items);
  const manifest = readManifest();
  // Schlagworte über die zentrale Lese-Schicht (Repo-Standard, R2 nur wenn
  // TEMPLATE_SOURCE="r2"). Lazy require, damit kein Modul-Zyklus entsteht.
  const kwAll = require("./templateSource").getKeywords(); // { "Kategorie/datei.jpg": ["…"] }
  return items
    .sort((a, b) => a.rel.localeCompare(b.rel, "en"))
    .map(({ rel, base, category }) => {
      const m = manifest[base] || {};
      // Schlagworte pro Flyer: aus keywords.json (per eindeutigem Pfad), sonst
      // Fallback auf ein evtl. Manifest-Feld. Immer ein Array. Von Suche + Filter genutzt.
      const stored = Array.isArray(kwAll[rel]) ? kwAll[rel] : null;
      return {
        id: rel.replace(IMAGE_RE, ""),
        file: rel, // relativer Pfad „Kategorie/datei.jpg" — eindeutig + lädt das Bild
        name: m.name || labelize(base),
        category, // IMMER aus dem Ordner
        featured: m.featured === true,
        keywords: stored || (Array.isArray(m.keywords) ? m.keywords : []),
      };
    });
}

// R2-only Uploads (aus der Discovery-Registry) als Items. Kategorie aus dem Pfad,
// Basis-Anzeigename aus dem Dateinamen (das Anzeigename-Overlay hat Vorrang, siehe
// list()). Keywords aus derselben Quelle wie buildItems (keywords.json via Lese-Schicht).
function uploadItems() {
  const rels = require("./admin/uploads").uploadsList();
  if (!rels.length) return [];
  const kwAll = require("./templateSource").getKeywords();
  return rels.map((rel) => {
    const base = rel.split("/").pop();
    const cat = rel.split("/")[0] || "Sonstige";
    return {
      id: rel.replace(IMAGE_RE, ""),
      file: rel,
      name: labelize(base),   // Basis; Anzeigename-Overlay hat Vorrang
      category: cat,          // aus dem Pfad (erste Ebene), wie bei den 206
      featured: false,
      keywords: Array.isArray(kwAll[rel]) ? kwAll[rel] : [],
    };
  });
}

// Repo-Templates (206) plus R2-only Uploads. Uploads NUR bei ADMIN_TOOLS=1.
function baseItems() {
  const items = buildItems();
  if (process.env.ADMIN_TOOLS === "1") {
    try { items.push(...uploadItems()); } catch { /* Uploads nicht ladbar → nur Repo */ }
  }
  return items;
}

// Öffentliche Liste. Ist das Admin-Tool AUS (ADMIN_TOOLS != "1"), exakt wie bisher
// (nur die 206 aus dem Repo, Namen aus templates.json/Dateiname). Ist es AN, kommen
// die R2-Uploads dazu und die Anzeige-Overlays werden additiv angewandt:
// Anzeigename-Overlay (Vorrang vor templates.json/Dateiname), ausgeblendete raus,
// kategorie-überschriebene unter ihrer neuen Kategorie. Nur Auflistung, nie die Bytes.
function list() {
  const items = baseItems();
  if (process.env.ADMIN_TOOLS !== "1") return items; // Tool aus → unverändert
  let names, hidden, overrides;
  try {
    names = require("./admin/uploads").namesMap();
    const ovl = require("./admin/overlays");
    hidden = ovl.hiddenSet();
    overrides = ovl.categoryOverrides();
  } catch {
    return items; // Overlays nicht ladbar → wie bisher (nie brechen)
  }
  const out = [];
  for (const t of items) {
    if (hidden.has(t.file)) continue;               // ausgeblendet → raus aus Galerie + Auswahl
    const nm = names.get(t.file);                    // Anzeigename-Overlay hat Vorrang
    const c = overrides.get(t.file);                 // Kategorie ggf. überschreiben
    out.push((nm || c) ? { ...t, name: nm || t.name, category: c || t.category } : t);
  }
  // Reihenfolge-Overlay anwenden: nur Kategorien MIT gesetzter Reihenfolge werden
  // umsortiert, alle anderen bleiben exakt in der Standardsortierung. Nie brechen.
  try { const order = require("./admin/order"); return order.applyOrder(out, order.orderMap()); }
  catch { return out; }
}

// Roh-Liste für das Admin-Tool: ALLE Templates (206 + Uploads, auch ausgeblendete),
// mit Basis-Kategorie (Ordner/Pfad) und Basis-Name, ohne Overlays. Die Routen wenden
// Overlays (Anzeigename, Kategorie, ausgeblendet) selbst an.
function listRaw() { return baseItems(); }

// Distinct categories in display order (manifest categories first by appearance).
function categories() {
  const cats = [];
  for (const t of list()) if (!cats.includes(t.category)) cats.push(t.category);
  return cats;
}

function has(file) {
  return list().some((t) => t.file === file);
}

// Casing policy for a template's always-caps slots (headline + website).
// Block templates keep the long-standing uppercase behavior; script templates
// set "uppercase": false in the manifest so the user's mixed casing is kept and
// Ideogram can apply the cursive/decorative font. Missing field → true.
function uppercaseFor(file) {
  const base = String(file).split("/").pop(); // Manifest ist per Basis-Dateiname
  const e = readManifest()[base];
  return !(e && e.uppercase === false);
}

function loadBuffer(file) {
  // file ist jetzt ein relativer Pfad „Kategorie/datei.jpg". Unterordner erlaubt,
  // aber kein Traversal: kein "..", kein Backslash, nicht absolut. has() ist die
  // eigentliche Sicherheitsgrenze (nur von list() entdeckte Dateien laden).
  if (!file || typeof file !== "string" || file.includes("\\") || file.includes("..") ||
      path.isAbsolute(file) || !IMAGE_RE.test(file)) {
    throw new Error("Invalid template file");
  }
  if (!has(file)) throw new Error("Unknown template: " + file);
  if (bufferCache.has(file)) return bufferCache.get(file);
  const buf = fs.readFileSync(path.join(TEMPLATES_DIR, file));
  bufferCache.set(file, buf);
  return buf;
}

module.exports = { list, listRaw, categories, has, loadBuffer, labelize, uppercaseFor, TEMPLATES_DIR };
