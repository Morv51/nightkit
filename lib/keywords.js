"use strict";

// Dauerhafter Speicher für Flyer-Schlagworte: templates/keywords.json, eine simple
// Zuordnung  { "Kategorie/datei.jpg": ["basketball","rot","streetwear"], … }  —
// per EINDEUTIGEM relativem Template-Pfad (nicht nur Dateiname, damit gleichnamige
// Dateien in verschiedenen Kategorien nicht kollidieren). Überlebt Server-Neustarts
// (Datei auf der Platte). Für Dauerhaftigkeit über ein Re-Deploy hinweg wird die
// Datei ins Repo committet (Export-Endpoint + Download im Studio).
//
// Die schon vorhandene Schlagwort-Suche/-Filterung liest diese Werte über
// templates.list() (dort werden sie je Flyer eingemischt).

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "templates", "keywords.json");

// Ein Schlagwort vereinheitlichen: klein, getrimmt, ohne Satzzeichen, kurz.
function norm(w) {
  return String(w == null ? "" : w)
    .toLowerCase()
    .replace(/[^a-z0-9äöüß \-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

function cleanList(arr) {
  const seen = new Set(), out = [];
  for (const x of Array.isArray(arr) ? arr : []) {
    const w = norm(x);
    if (w && !seen.has(w)) { seen.add(w); out.push(w); }
    if (out.length >= 20) break;
  }
  return out;
}

function readAll() {
  try {
    const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function get(file) {
  const a = readAll()[file];
  return Array.isArray(a) ? a : [];
}

function has(file) {
  return get(file).length > 0;
}

// Schlagworte eines Flyers setzen (überschreibt). Leere Liste → Eintrag entfernen.
function setKeywords(file, keywords) {
  const all = readAll();
  const clean = cleanList(keywords);
  if (clean.length) all[file] = clean; else delete all[file];
  fs.writeFileSync(FILE, JSON.stringify(all, null, 0));
  return clean;
}

function rawJson() {
  try { return fs.readFileSync(FILE, "utf8"); } catch { return "{}"; }
}

module.exports = { readAll, get, has, setKeywords, cleanList, norm, rawJson, FILE };
