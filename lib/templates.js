"use strict";

const fs = require("fs");
const path = require("path");

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
function list() {
  const items = [];
  walk(TEMPLATES_DIR, null, items);
  const manifest = readManifest();
  return items
    .sort((a, b) => a.rel.localeCompare(b.rel, "en"))
    .map(({ rel, base, category }) => {
      const m = manifest[base] || {};
      return {
        id: rel.replace(IMAGE_RE, ""),
        file: rel, // relativer Pfad „Kategorie/datei.jpg" — eindeutig + lädt das Bild
        name: m.name || labelize(base),
        category, // IMMER aus dem Ordner
        featured: m.featured === true,
      };
    });
}

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

module.exports = { list, categories, has, loadBuffer, labelize, uppercaseFor, TEMPLATES_DIR };
