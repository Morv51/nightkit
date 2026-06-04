"use strict";

const fs = require("fs");
const path = require("path");

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

// Template registry. Each entry has:
//   file    – full-resolution image sent to the Ideogram edit API
//   preview – smaller image shown in the picker / live preview (falls back to file)
//   cats    – category tags; must include "alle" to appear under the "Alle" tab
const REGISTRY = {
  "birthday-pink": {
    id: "birthday-pink",
    name: "Birthday Pink",
    file: "birthday-pink.jpg",
    preview: "birthday-pink-preview.jpg",
    cats: ["alle", "house"],
  },
};

const cache = new Map();

function get(id) {
  return REGISTRY[id] || null;
}

function list() {
  return Object.values(REGISTRY).map((t) => ({
    id: t.id,
    name: t.name,
    cats: t.cats,
    src: `/templates/${t.preview || t.file}`,
  }));
}

function loadBuffer(id) {
  const t = get(id);
  if (!t) throw new Error(`Unknown template: ${id}`);
  if (cache.has(id)) return cache.get(id);
  const buf = fs.readFileSync(path.join(TEMPLATES_DIR, t.file));
  cache.set(id, buf);
  return buf;
}

function clearCache() {
  cache.clear();
}

module.exports = { get, list, loadBuffer, clearCache, TEMPLATES_DIR };
