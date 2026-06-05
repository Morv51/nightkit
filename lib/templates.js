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

// Auto-discovery: every image in /templates becomes a template. Read on each
// call (cheap) so a newly added file shows up without touching code.
function list() {
  let files;
  try {
    files = fs.readdirSync(TEMPLATES_DIR);
  } catch {
    return [];
  }
  return files
    .filter((f) => IMAGE_RE.test(f) && !f.startsWith("."))
    .sort()
    .map((file) => ({ id: file.replace(IMAGE_RE, ""), file, label: labelize(file) }));
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

module.exports = { list, has, loadBuffer, labelize, TEMPLATES_DIR };
