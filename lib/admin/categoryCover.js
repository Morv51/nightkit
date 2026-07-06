"use strict";

// Kategorie-Cover-Overlay: pro Kategorie EIN Template als Aushaengeschild/Vorschaubild.
//   templates/_admin_category_cover.json  ->  { "Kategorie": "Kategorie/datei.jpg" }
//
// Dauerhaft in R2 (analog zu den anderen Admin-Overlays), Repo nur Backup, fehlt die
// Datei, gilt sie als leer. Nutzt den geteilten S3-Client aus lib/r2.js. Die Getter
// WERFEN NIE. Der Dateiname beginnt mit "_", wird also von walk()/der statischen Route
// ohnehin ignoriert.
//
// SICHERER STANDARD: Ist fuer eine Kategorie KEIN Cover gesetzt (oder zeigt es auf ein
// ausgeblendetes / in eine andere Kategorie verschobenes Template), bleibt das heutige
// Verhalten exakt (die App waehlt automatisch: featured zuerst, sonst das erste).
// resolveCovers() validiert gegen die SICHTBARE Liste, sodass nur gueltige Cover greifen,
// und liefert ohne ADMIN_TOOLS=1 immer ein leeres Ergebnis.

const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("../r2");

const KEY = "templates/_admin_category_cover.json";
const P = "[ADMIN-COVER]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

let _cover = null; // Map<string, string>  (Kategorie -> Template-Pfad)

let _c = null, _tried = false;
function r2() {
  if (_tried) return _c;
  _tried = true;
  try {
    const env = readS3Env();
    if (env.missing.length) { log("R2-Variablen fehlen: " + env.missing.join(", ")); _c = null; return null; }
    _c = { client: makeR2Client(env), bucket: env.BUCKET };
    return _c;
  } catch (e) { log("R2-Client nicht baubar: " + fehlerText(e)); _c = null; return null; }
}

async function fetchJson() {
  const c = r2();
  if (!c) return null;
  try {
    const res = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: KEY }));
    return JSON.parse(await res.Body.transformToString());
  } catch (e) {
    const code = e && e.$metadata ? e.$metadata.httpStatusCode : undefined;
    if ((e && (e.name === "NoSuchKey" || e.name === "NotFound")) || code === 404) return null;
    log("R2-Lesefehler: " + fehlerText(e));
    return null;
  }
}

async function prime() {
  try {
    const o = await fetchJson();
    _cover = new Map();
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const [cat, file] of Object.entries(o)) {
        if (typeof cat === "string" && typeof file === "string" && file) _cover.set(cat, file);
      }
    }
    log("geladen: Cover fuer " + _cover.size + " Kategorie(n)");
  } catch (e) {
    log("Laden fehlgeschlagen: " + fehlerText(e));
    if (!(_cover instanceof Map)) _cover = new Map();
  }
}

async function ensureLoaded() {
  if (!(_cover instanceof Map)) await prime();
  if (!(_cover instanceof Map)) _cover = new Map();
}

function coverMap() { return _cover instanceof Map ? _cover : new Map(); }

async function putAll(next) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar, kann Kategoriebild nicht speichern");
  const obj = Object.fromEntries([...next.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: KEY, Body: JSON.stringify(obj), ContentType: "application/json" }));
}

// Cover einer Kategorie setzen (leerer Pfad -> Eintrag entfernen -> Standard).
async function setCover(category, file) {
  await ensureLoaded();
  const cat = String(category == null ? "" : category).trim();
  const f = String(file == null ? "" : file).trim();
  const next = new Map(_cover);
  if (cat && f) next.set(cat, f); else next.delete(cat);
  await putAll(next);
  _cover = next;
}

// Cover einer Kategorie zuruecksetzen (App waehlt wieder automatisch).
async function clearCover(category) {
  await ensureLoaded();
  const next = new Map(_cover);
  next.delete(String(category == null ? "" : category).trim());
  await putAll(next);
  _cover = next;
}

// Aus dem Overlay + der SICHTBAREN Liste die gueltigen Cover je Kategorie bilden.
// items: [{ file, category, hidden? }] (effektive Kategorie; hidden ist nur in der
// Admin-Liste gesetzt, in der oeffentlichen list() sind ausgeblendete schon draussen).
// Ein Cover gilt NUR, wenn sein Template existiert, NICHT ausgeblendet ist und seine
// effektive Kategorie == der Cover-Kategorie ist. Sonst faellt es weg (Standard).
// Ohne ADMIN_TOOLS=1 immer leer -> oeffentliche App verhaelt sich wie heute.
function resolveCovers(items) {
  if (process.env.ADMIN_TOOLS !== "1") return {};
  const map = coverMap();
  if (!map.size || !Array.isArray(items)) return {};
  const out = {};
  for (const [cat, file] of map) {
    if (items.some((t) => t && t.file === file && t.category === cat && !t.hidden)) out[cat] = file;
  }
  return out;
}

module.exports = { prime, coverMap, setCover, clearCover, resolveCovers };
