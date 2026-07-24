"use strict";

// Redesign v2, Bauteil 3b: benannte FAMILIEN-Presets (KEINE Kategorie-Bindung).
//   templates/_admin_families.json  ->  { "Name": { family_text, accent, tone } }
//
// Die Familie ist ein AUFTRAGS-Attribut: Marvin waehlt beim Redesign-Start eine Familie (oder
// wuerfelt/tippt eine), alle Templates desselben Auftrags teilen sie. Diese Datei ist nur der
// Speicher fuer wiederverwendbare, benannte Presets. Dauerhaft in R2 wie die anderen Overlays,
// die Getter WERFEN NIE, der Dateiname beginnt mit "_" (von walk()/Route ohnehin ignoriert).

const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("../r2");

const KEY = "templates/_admin_families.json";
const P = "[ADMIN-FAMILIES]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

let _fam = null; // Map<string, {family_text, accent, tone}>

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

const s = (x) => (typeof x === "string" ? x.trim() : "");
function cleanEntry(o) {
  if (!o || typeof o !== "object") return null;
  const e = { family_text: s(o.family_text), accent: s(o.accent), tone: s(o.tone), voice: s(o.voice) };
  return e.family_text ? e : null;
}

async function prime() {
  try {
    const o = await fetchJson();
    _fam = new Map();
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const [name, val] of Object.entries(o)) {
        const e = cleanEntry(val);
        if (typeof name === "string" && name.trim() && e) _fam.set(name.trim(), e);
      }
    }
    log("geladen: " + _fam.size + " Familie(n)");
  } catch (e) {
    log("Laden fehlgeschlagen: " + fehlerText(e));
    if (!(_fam instanceof Map)) _fam = new Map();
  }
}

async function ensureLoaded() {
  if (!(_fam instanceof Map)) await prime();
  if (!(_fam instanceof Map)) _fam = new Map();
}

async function putAll(next) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar, kann Familien nicht speichern");
  const obj = Object.fromEntries([...next.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: KEY, Body: JSON.stringify(obj), ContentType: "application/json" }));
}

// Alle Presets als schlichtes Objekt [{name, family_text, accent, tone}] (fuer das UI-Dropdown).
async function list() {
  await ensureLoaded();
  return [..._fam.entries()].map(([name, e]) => ({ name, ...e }));
}

// Preset speichern/ueberschreiben. name + family_text sind Pflicht.
async function save(name, entry) {
  await ensureLoaded();
  const nm = s(name);
  const e = cleanEntry(entry);
  if (!nm) throw new Error("Familien-Name fehlt");
  if (!e) throw new Error("family_text fehlt");
  const next = new Map(_fam);
  next.set(nm, e);
  await putAll(next);
  _fam = next;
  return { name: nm, ...e };
}

async function remove(name) {
  await ensureLoaded();
  const next = new Map(_fam);
  next.delete(s(name));
  await putAll(next);
  _fam = next;
}

module.exports = { prime, list, save, remove };
