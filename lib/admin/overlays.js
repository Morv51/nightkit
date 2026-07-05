"use strict";

// Dauerhafte Admin-Overlays fuer die Bestandsverwaltung. NUR Anzeige, keine Bytes.
// Maßgebliche Quelle zur Laufzeit ist R2 (analog keywords.json). Das Repo ist nur
// Backup; fehlen die Dateien, gelten sie als leer. KEIN Auto-Commit (Render-Platte
// ist vergaenglich).
//
//   templates/_admin_hidden.json      -> ["Kategorie/datei.jpg", ...]
//                                        (ausgeblendet / im Papierkorb)
//   templates/_admin_categories.json  -> { "Kategorie/datei.jpg": "Neue Kategorie" }
//                                        (Kategorie-Ueberschreibung, ueberschreibt den Ordnernamen)
//
// Nutzt den geteilten S3-Client aus lib/r2.js (kein abweichender Client). Beide
// Dateinamen beginnen mit "_", darum werden sie von templates.walk() und der
// statischen /templates-Route ohnehin ignoriert (nicht als Template entdeckt,
// nicht oeffentlich ausgeliefert).
//
// Die synchronen Getter (hiddenSet, categoryOverrides) werden von templates.list()
// benutzt und WERFEN NIE. Ist noch nichts geladen, liefern sie leere Overlays,
// sodass im Zweifel einfach alles sichtbar bleibt (sicherer Standard).

const fs = require("fs");
const path = require("path");
const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("../r2");

const HIDDEN_KEY = "templates/_admin_hidden.json";
const CATS_KEY = "templates/_admin_categories.json";
const HIDDEN_FILE = path.join(__dirname, "..", "..", "templates", "_admin_hidden.json");
const CATS_FILE = path.join(__dirname, "..", "..", "templates", "_admin_categories.json");

const P = "[ADMIN-OVL]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

let _hidden = null; // Set<string> oder null (noch nicht geladen)
let _cats = null;   // Map<string,string> oder null

// Lazy gebauter, gecachter R2-Client (via lib/r2.js). null, wenn nicht verfuegbar.
let _c = null, _tried = false;
function r2() {
  if (_tried) return _c;
  _tried = true;
  try {
    const env = readS3Env();
    if (env.missing.length) { log("R2-Variablen fehlen: " + env.missing.join(", ")); _c = null; return null; }
    _c = { client: makeR2Client(env), bucket: env.BUCKET };
    return _c;
  } catch (e) {
    log("R2-Client nicht baubar: " + fehlerText(e));
    _c = null;
    return null;
  }
}

// Liest eine Overlay-Datei. R2 zuerst (maßgeblich); fehlt sie (404), gilt leer;
// bei anderem R2-Fehler oder ohne R2 wird das Repo-Backup versucht. Wirft nicht.
async function fetchJson(key) {
  const c = r2();
  if (c) {
    try {
      const res = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: key }));
      return JSON.parse(await res.Body.transformToString());
    } catch (e) {
      const code = e && e.$metadata ? e.$metadata.httpStatusCode : undefined;
      const missing = (e && (e.name === "NoSuchKey" || e.name === "NotFound")) || code === 404;
      if (missing) return null; // existiert noch nicht -> leer
      log("R2-Lesefehler " + key + ": " + fehlerText(e) + " -> Repo-Backup");
      // faellt unten auf Repo-Backup
    }
  }
  try {
    return JSON.parse(fs.readFileSync(key === HIDDEN_KEY ? HIDDEN_FILE : CATS_FILE, "utf8"));
  } catch {
    return null;
  }
}

// Beide Overlays in den Cache laden. WIRFT NIE (bei Fehler leere Overlays).
async function prime() {
  try {
    const h = await fetchJson(HIDDEN_KEY);
    _hidden = new Set(Array.isArray(h) ? h.filter((x) => typeof x === "string") : []);
    const c = await fetchJson(CATS_KEY);
    _cats = new Map(c && typeof c === "object" && !Array.isArray(c)
      ? Object.entries(c).filter(([k, v]) => typeof k === "string" && typeof v === "string")
      : []);
    log("geladen: " + _hidden.size + " ausgeblendet, " + _cats.size + " Kategorie-Ueberschreibungen");
  } catch (e) {
    log("Laden fehlgeschlagen: " + fehlerText(e));
    if (!(_hidden instanceof Set)) _hidden = new Set();
    if (!(_cats instanceof Map)) _cats = new Map();
  }
}

async function ensureLoaded() {
  if (!(_hidden instanceof Set) || !(_cats instanceof Map)) await prime();
  if (!(_hidden instanceof Set)) _hidden = new Set();
  if (!(_cats instanceof Map)) _cats = new Map();
}

// Synchrone Getter fuer templates.list(). Leer, wenn noch nicht geladen.
function hiddenSet() { return _hidden instanceof Set ? _hidden : new Set(); }
function categoryOverrides() { return _cats instanceof Map ? _cats : new Map(); }

// Schreiben: neuen Stand nach R2 schreiben und NUR bei Erfolg den Cache uebernehmen,
// damit R2 und Cache konsistent bleiben. Wirft bei fehlendem R2 (Aufrufer meldet Fehler).
async function putJson(key, value) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar, kann Overlay nicht speichern");
  await c.client.send(new PutObjectCommand({
    Bucket: c.bucket, Key: key, Body: JSON.stringify(value), ContentType: "application/json",
  }));
}

async function hide(file) {
  await ensureLoaded();
  const next = new Set(_hidden); next.add(file);
  await putJson(HIDDEN_KEY, [...next].sort());
  _hidden = next;
}

async function unhide(file) {
  await ensureLoaded();
  const next = new Set(_hidden); next.delete(file);
  await putJson(HIDDEN_KEY, [...next].sort());
  _hidden = next;
}

// category leer/whitespace -> Ueberschreibung entfernen (zurueck zum Ordnernamen).
async function setCategory(file, category) {
  await ensureLoaded();
  const cat = String(category == null ? "" : category).replace(/\s+/g, " ").trim().slice(0, 60);
  const next = new Map(_cats);
  if (cat) next.set(file, cat); else next.delete(file);
  await putJson(CATS_KEY, Object.fromEntries([...next.entries()].sort((a, b) => a[0].localeCompare(b[0]))));
  _cats = next;
}

module.exports = {
  prime, hiddenSet, categoryOverrides, hide, unhide, setCategory,
};
