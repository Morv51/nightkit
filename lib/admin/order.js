"use strict";

// Reihenfolge-Overlay: pro Kategorie eine geordnete Liste von Template-Pfaden.
//   templates/_admin_order.json  ->  { "Kategorie": ["Kat/a.jpg", "Kat/b.jpg", ...] }
//   Position 1 = erster Eintrag.
//
// Dauerhaft in R2 (analog zu den anderen Admin-Overlays), Repo nur Backup, fehlt die
// Datei, gilt sie als leer. Nutzt den geteilten S3-Client aus lib/r2.js. Die Getter
// WERFEN NIE. Der Dateiname beginnt mit "_", wird also von walk()/der statischen Route
// ohnehin ignoriert.
//
// SICHERER STANDARD: applyOrder() sortiert NUR innerhalb der Kategorien, fuer die eine
// Reihenfolge gesetzt ist, und laesst alle anderen exakt an ihrer Stelle. Ist gar
// nichts gesetzt, gibt es die Liste unveraendert zurueck (Sortierung wie heute).

const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("../r2");

const KEY = "templates/_admin_order.json";
const P = "[ADMIN-ORDER]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

let _order = null; // Map<string, string[]>  (Kategorie -> geordnete Pfade)

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
    _order = new Map();
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const [cat, arr] of Object.entries(o)) {
        if (typeof cat === "string" && Array.isArray(arr)) _order.set(cat, arr.filter((p) => typeof p === "string"));
      }
    }
    log("geladen: Reihenfolge fuer " + _order.size + " Kategorie(n)");
  } catch (e) {
    log("Laden fehlgeschlagen: " + fehlerText(e));
    if (!(_order instanceof Map)) _order = new Map();
  }
}

async function ensureLoaded() {
  if (!(_order instanceof Map)) await prime();
  if (!(_order instanceof Map)) _order = new Map();
}

function orderMap() { return _order instanceof Map ? _order : new Map(); }

async function putAll(next) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar, kann Reihenfolge nicht speichern");
  const obj = Object.fromEntries([...next.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: KEY, Body: JSON.stringify(obj), ContentType: "application/json" }));
}

// Reihenfolge einer Kategorie setzen (leere Liste -> Eintrag entfernen -> Standard).
async function setOrder(category, paths) {
  await ensureLoaded();
  const cat = String(category == null ? "" : category).trim();
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string");
  const next = new Map(_order);
  if (cat && list.length) next.set(cat, list); else next.delete(cat);
  await putAll(next);
  _order = next;
}

// Reihenfolge einer Kategorie zuruecksetzen (Standardsortierung gilt wieder).
async function clearOrder(category) {
  await ensureLoaded();
  const next = new Map(_order);
  next.delete(String(category == null ? "" : category).trim());
  await putAll(next);
  _order = next;
}

// Sortiert eine flache Item-Liste WITHIN jeder Kategorie, die eine Reihenfolge hat.
// Kategorien ohne Eintrag bleiben exakt unveraendert (die Items behalten ihre Slots).
// Gelistete Pfade zuerst in Overlay-Reihenfolge, dann der Rest (neu/ungelistet) in der
// bisherigen Standardsortierung. Nichts verschwindet.
function applyOrder(items, order) {
  if (!(order instanceof Map) || order.size === 0) return items;
  const result = items.slice();
  const idxByCat = new Map(); // effektive Kategorie -> Slot-Indizes in der Liste
  for (let i = 0; i < items.length; i++) {
    const cat = items[i].category;
    if (!idxByCat.has(cat)) idxByCat.set(cat, []);
    idxByCat.get(cat).push(i);
  }
  for (const [cat, seq] of order) {
    const idxs = idxByCat.get(cat);
    if (!idxs || !idxs.length || !Array.isArray(seq) || !seq.length) continue;
    const pos = new Map(seq.map((f, i) => [f, i]));
    const catItems = idxs.map((i) => items[i]);
    const listed = [], rest = [];
    for (const t of catItems) { if (pos.has(t.file)) listed.push(t); else rest.push(t); }
    listed.sort((a, b) => pos.get(a.file) - pos.get(b.file));
    const ordered = listed.concat(rest);
    idxs.forEach((slot, k) => { result[slot] = ordered[k]; }); // in dieselben Slots zurueck
  }
  return result;
}

module.exports = { prime, orderMap, setOrder, clearOrder, applyOrder };
