"use strict";

// Datenschicht fuer den Uploader. Legt NUR neue Templates an, fasst bestehende nie an.
// Zwei dauerhafte R2-Overlays (analog zu lib/admin/overlays.js; Repo nur Backup, kein
// Auto-Commit) plus das Schreiben von keywords.json in R2:
//
//   templates/_admin_uploads.json  -> ["Kategorie/technischer-name.jpg", ...]
//        Discovery-Liste der Templates, die NUR in R2 liegen. templates.list() liest
//        sie zusaetzlich ein, damit neue Uploads in App und Verwaltung erscheinen.
//   templates/_admin_names.json    -> { "Kategorie/datei.jpg": "Anzeigename" }
//        Der editierbare Anzeigename, die EINE Quelle. Prioritaet in templates.list():
//        Anzeigename-Overlay  >  templates.json  >  Dateiname.
//        (Ohne Overlay-Eintrag bleibt der heutige Name der 206 unveraendert.)
//
// Nutzt den geteilten S3-Client aus lib/r2.js. Getter WERFEN NIE (leer, wenn nicht
// geladen), damit die Galerie nie bricht. Beide Dateinamen beginnen mit "_", werden
// also von walk() und der statischen Route ohnehin ignoriert.

const { GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("../r2");

const UPLOADS_KEY = "templates/_admin_uploads.json";
const NAMES_KEY = "templates/_admin_names.json";
const KEYWORDS_KEY = "templates/keywords.json";

const P = "[UPLOAD]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

let _uploads = null; // Set<string> (relative Pfade)
let _names = null;   // Map<string,string>

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

async function fetchJson(key) {
  const c = r2();
  if (!c) return null;
  try {
    const res = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: key }));
    return JSON.parse(await res.Body.transformToString());
  } catch (e) {
    const code = e && e.$metadata ? e.$metadata.httpStatusCode : undefined;
    if ((e && (e.name === "NoSuchKey" || e.name === "NotFound")) || code === 404) return null;
    log("R2-Lesefehler " + key + ": " + fehlerText(e));
    return null;
  }
}

async function prime() {
  try {
    const u = await fetchJson(UPLOADS_KEY);
    _uploads = new Set(Array.isArray(u) ? u.filter((x) => typeof x === "string") : []);
    const n = await fetchJson(NAMES_KEY);
    _names = new Map(n && typeof n === "object" && !Array.isArray(n)
      ? Object.entries(n).filter(([k, v]) => typeof k === "string" && typeof v === "string") : []);
    log("geladen: " + _uploads.size + " Uploads, " + _names.size + " Anzeigenamen");
  } catch (e) {
    log("Laden fehlgeschlagen: " + fehlerText(e));
    if (!(_uploads instanceof Set)) _uploads = new Set();
    if (!(_names instanceof Map)) _names = new Map();
  }
}

async function ensureLoaded() {
  if (!(_uploads instanceof Set) || !(_names instanceof Map)) await prime();
  if (!(_uploads instanceof Set)) _uploads = new Set();
  if (!(_names instanceof Map)) _names = new Map();
}

// Synchrone Getter fuer templates.list().
function uploadsList() { return _uploads instanceof Set ? [..._uploads] : []; }
function namesMap() { return _names instanceof Map ? _names : new Map(); }

async function putJson(key, value) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar, kann Overlay nicht speichern");
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: key, Body: JSON.stringify(value), ContentType: "application/json" }));
}

// Neues Template in die Discovery-Registry aufnehmen (nur bei Erfolg cachen).
async function registerUpload(rel) {
  await ensureLoaded();
  const next = new Set(_uploads); next.add(rel);
  await putJson(UPLOADS_KEY, [...next].sort());
  _uploads = next;
}

// Anzeigename setzen (leer -> Eintrag entfernen -> zurueck zu templates.json/Dateiname).
async function setDisplayName(file, name) {
  await ensureLoaded();
  const nm = String(name == null ? "" : name).replace(/\s+/g, " ").trim().slice(0, 80);
  const next = new Map(_names);
  if (nm) next.set(file, nm); else next.delete(file);
  await putJson(NAMES_KEY, Object.fromEntries([...next.entries()].sort((a, b) => a[0].localeCompare(b[0]))));
  _names = next;
}

// R2-Objekt existiert? (fuer die Eindeutigkeitsgarantie des technischen Namens)
async function keyExists(key) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar");
  try { await c.client.send(new HeadObjectCommand({ Bucket: c.bucket, Key: key })); return true; }
  catch (e) {
    const code = e && e.$metadata ? e.$metadata.httpStatusCode : undefined;
    if ((e && (e.name === "NotFound" || e.name === "NoSuchKey")) || code === 404) return false;
    throw e;
  }
}

// Beliebiges Objekt nach R2 schreiben (Original + Thumbnail des Uploads).
async function putObject(key, body, contentType) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar");
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: key, Body: body, ContentType: contentType }));
}

// Tags eines neuen Templates in R2-keywords.json mergen (Schluessel = relativer Pfad).
// Aendert nur diesen einen Eintrag, laesst bestehende unberuehrt.
async function addKeywords(file, tags) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar");
  let obj = {};
  try {
    const res = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: KEYWORDS_KEY }));
    const parsed = JSON.parse(await res.Body.transformToString());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) obj = parsed;
  } catch (e) {
    const code = e && e.$metadata ? e.$metadata.httpStatusCode : undefined;
    if (!((e && (e.name === "NoSuchKey" || e.name === "NotFound")) || code === 404)) throw e;
  }
  obj[file] = Array.isArray(tags) ? tags : [];
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: KEYWORDS_KEY, Body: JSON.stringify(obj), ContentType: "application/json" }));
}

module.exports = {
  prime, uploadsList, namesMap,
  registerUpload, setDisplayName, addKeywords,
  keyExists, putObject,
  UPLOADS_KEY, NAMES_KEY,
};
