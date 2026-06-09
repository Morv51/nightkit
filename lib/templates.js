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

// Auto-discovery: every image in /templates becomes a template. Read on each
// call (cheap) so a newly added file shows up without touching code. Merges in
// the optional manifest for name + category.
function list() {
  let files;
  try {
    files = fs.readdirSync(TEMPLATES_DIR);
  } catch {
    return [];
  }
  const manifest = readManifest();
  return files
    .filter((f) => IMAGE_RE.test(f) && !f.startsWith("."))
    .sort()
    .map((file) => {
      const m = manifest[file] || {};
      return {
        id: file.replace(IMAGE_RE, ""),
        file,
        name: m.name || labelize(file),
        category: m.category || "Sonstige",
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

function loadBuffer(file) {
  if (!file || file.includes("/") || file.includes("\\") || !IMAGE_RE.test(file)) {
    throw new Error("Invalid template file");
  }
  if (!has(file)) throw new Error("Unknown template: " + file);
  if (bufferCache.has(file)) return bufferCache.get(file);
  const buf = fs.readFileSync(path.join(TEMPLATES_DIR, file));
  bufferCache.set(file, buf);
  return buf;
}

module.exports = { list, categories, has, loadBuffer, labelize, TEMPLATES_DIR };
