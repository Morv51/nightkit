"use strict";

const fs = require("fs");
const path = require("path");

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

const REGISTRY = {
  default: {
    id: "default",
    name: "Halloween Club",
    file: "default.png",
    cats: ["alle", "halloween"],
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
    src: `/templates/${t.file}`,
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
