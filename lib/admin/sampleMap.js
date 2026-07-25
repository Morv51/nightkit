"use strict";

// Beta-Pfad "Beispieltext-Templates", Bauteil 1: die Zuordnungstabelle je Template.
//   templates/_admin_sample_map.json  ->  { "Kategorie/datei.jpg": { headline: "GOOD TIMES", … } }
//
// Ein Beispieltext-Template zeigt im Bild KEINE Platzhalterwoerter, sondern fertigen
// Beispieltext. Die Tabelle sagt, welcher sichtbare Text zu welchem Eingabefeld gehoert;
// der Befuell-Pfad ersetzt dann Beispieltext durch Kundeneingabe (lib/prompt.js).
//
// Dauerhaft in R2, exakt nach dem Muster der uebrigen Admin-Overlays (categoryCover.js):
// prime() beim Start, SYNCHRONER Getter (buildPrompt ist synchron), Schreiben ueber putAll().
// Die Getter WERFEN NIE. Der Dateiname beginnt mit "_", wird also von walk()/der statischen
// Route ohnehin ignoriert. Fehlt die Datei, gilt sie als leer -> jedes Template laeuft dann
// den unveraenderten Platzhalter-Pfad.

const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("../r2");

const KEY = "templates/_admin_sample_map.json";
const P = "[ADMIN-SAMPLEMAP]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

// Die erlaubten Schluessel, in Anzeige-Reihenfolge. Analog zur Eingabemaske; "vibe" ist
// BEWUSST nicht dabei — das Feld geht gar nicht an /api/generate (nur an die Captions),
// ein Schluessel ohne moegliche Eingabe waere eine Falle.
const SAMPLE_KEYS = ["headline", "subline", "weekday", "date", "time",
  "dj1", "dj2", "dj3", "club", "location", "website"];

let _map = null; // Map<string, object>  (Template-Pfad -> { schluessel: beispieltext })

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

// Nur bekannte Schluessel, nur nicht-leere Werte. Leer heisst: das Feld kommt im Bild NICHT
// vor. Bleibt nichts uebrig -> null (Template hat keine Tabelle).
function cleanEntry(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const e = {};
  for (const k of SAMPLE_KEYS) { const v = s(o[k]); if (v) e[k] = v; }
  return Object.keys(e).length ? e : null;
}

async function prime() {
  try {
    const o = await fetchJson();
    _map = new Map();
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const [file, val] of Object.entries(o)) {
        const e = cleanEntry(val);
        if (typeof file === "string" && file && e) _map.set(file, e);
      }
    }
    log("geladen: Beispieltext-Tabellen fuer " + _map.size + " Template(s)");
  } catch (e) {
    log("Laden fehlgeschlagen: " + fehlerText(e));
    if (!(_map instanceof Map)) _map = new Map();
  }
}

async function ensureLoaded() {
  if (!(_map instanceof Map)) await prime();
  if (!(_map instanceof Map)) _map = new Map();
}

// SYNCHRON: so nutzt der Befuell-Pfad die Tabelle ohne await im heissen Pfad.
function sampleMaps() { return _map instanceof Map ? _map : new Map(); }
function mapFor(file) { return sampleMaps().get(String(file || "")) || null; }
function hasMap(file) { return !!mapFor(file); }

async function putAll(next) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar, kann Beispieltext-Tabelle nicht speichern");
  const obj = Object.fromEntries([...next.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: KEY, Body: JSON.stringify(obj), ContentType: "application/json" }));
}

// Tabelle setzen (leeres/unbrauchbares Objekt -> Eintrag entfernen -> Platzhalter-Pfad).
async function setMap(file, entry) {
  await ensureLoaded();
  const f = String(file == null ? "" : file).trim();
  if (!f) throw new Error("Template-Pfad fehlt");
  const e = cleanEntry(entry);
  const next = new Map(_map);
  if (e) next.set(f, e); else next.delete(f);
  await putAll(next);
  _map = next;
  return e;
}

async function clearMap(file) {
  await ensureLoaded();
  const next = new Map(_map);
  next.delete(String(file == null ? "" : file).trim());
  await putAll(next);
  _map = next;
}

module.exports = { prime, sampleMaps, mapFor, hasMap, setMap, clearMap, SAMPLE_KEYS };
