"use strict";

// EINE zentrale Zugriffs-Schicht fuer alle Template-, Thumbnail- und keywords.json-
// Lesezugriffe. Umschaltbar per Umgebungsvariable TEMPLATE_SOURCE:
//   - nicht gesetzt oder != "r2"  -> "repo": exakt wie bisher, es aendert sich nichts.
//   - "r2"                        -> aus Cloudflare R2 lesen, MIT automatischem
//                                    Rueckfall auf das Repo, falls ein Objekt fehlt
//                                    oder der Abruf einen Fehler wirft.
//
// Der Kern-Flow (edit-Flow, Galerie, Filter) darf NIE brechen: jede R2-Operation
// ist abgesichert und faellt auf das intakte Repo zurueck. Jeder Rueckfall und jede
// Auffaelligkeit wird mit dem Praefix [R2-READ] geloggt.
//
// Nutzt denselben S3-Client wie Selftest und Migration (lib/r2.js). Bilder werden
// vom Server durchgereicht (GetObject -> Buffer), der Bucket bleibt privat.
//
// Hinweis zu require: templates/thumbs/keywords werden bewusst LAZY (in den
// Funktionen) geladen, damit es keine Modul-Zyklen gibt (templates ruft getKeywords,
// thumbs ruft getTemplateFile). Nur r2 + aws-sdk stehen oben.

const path = require("path");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("./r2");

const TPL_PREFIX = "templates/";     // Original-Templates + Metadaten (spiegelt Repo)
const THUMB_PREFIX = "thumbnails/";  // vor-erzeugte Thumbnails (WebP)
const IMAGE_RE = /\.(jpe?g|png)$/i;
const P = "[R2-READ]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

function source() {
  return process.env.TEMPLATE_SOURCE === "r2" ? "r2" : "repo";
}

// Pfad-Sicherheit wie in templates.loadBuffer (kein Traversal, nur Bilddateien).
function pathSafe(file) {
  return !!file && typeof file === "string" && !file.includes("\\") &&
    !file.includes("..") && !path.isAbsolute(file) && IMAGE_RE.test(file);
}

// Lazy gebauter, gecachter R2-Client. Gibt { client, bucket } oder null (dann Repo).
let _built = false, _ok = false, _client = null, _bucket = null;
function r2() {
  if (source() !== "r2") return null;
  if (_built) return _ok ? { client: _client, bucket: _bucket } : null;
  _built = true;
  try {
    const env = readS3Env();
    if (env.missing.length) {
      log("Quelle r2 gewuenscht, aber Variablen fehlen: " + env.missing.join(", ") + ". Rueckfall Repo.");
      return null;
    }
    _client = makeR2Client(env);
    _bucket = env.BUCKET;
    _ok = true;
    return { client: _client, bucket: _bucket };
  } catch (e) {
    log("R2-Client nicht baubar: " + fehlerText(e) + ". Rueckfall Repo.");
    return null;
  }
}

async function bodyToBuffer(body) {
  if (!body) throw new Error("kein Body");
  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const c of body) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

// Template-Bytes holen. In "repo" exakt wie bisher (templates.loadBuffer: Pfad-
// Sicherheit + Existenzpruefung + Cache). In "r2" aus R2, bei Fehlen/Fehler Rueckfall
// auf das Repo. Der edit-Flow und die Thumbnail-Erzeugung holen die Bytes hierueber.
async function getTemplateFile(file) {
  const templates = require("./templates");
  if (source() !== "r2") return templates.loadBuffer(file);   // Repo, unveraendert
  if (!pathSafe(file)) return templates.loadBuffer(file);     // ungueltig -> gleiche Fehlermeldung
  const c = r2();
  if (!c) return templates.loadBuffer(file);                  // R2 nicht verfuegbar -> Repo
  try {
    const res = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: TPL_PREFIX + file }));
    const buf = await bodyToBuffer(res.Body);
    if (!buf || !buf.length) throw new Error("leere Antwort");
    return buf;
  } catch (e) {
    log("Template nicht aus R2: " + file + " (" + fehlerText(e) + "). Rueckfall Repo.");
    return templates.loadBuffer(file);                        // intaktes Repo als Netz
  }
}

// Thumbnail (WebP) holen. In "r2" und Breite 360 wird das vor-erzeugte R2-Thumbnail
// durchgereicht; bei Fehlen/Fehler oder anderer Breite lokal erzeugt (die Quelle holt
// sich thumbs.getThumb dann selbst ueber getTemplateFile, also ebenfalls R2/Repo).
async function getThumbnail(file, width) {
  const thumbs = require("./thumbs");
  const w = thumbs.normWidth(width);
  if (source() === "r2" && w === 360) {
    const c = r2();
    if (c && pathSafe(file)) {
      try {
        const key = THUMB_PREFIX + file.replace(IMAGE_RE, ".webp");
        const res = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: key }));
        const buf = await bodyToBuffer(res.Body);
        if (buf && buf.length) return buf;
        throw new Error("leere Antwort");
      } catch (e) {
        log("Thumbnail nicht aus R2: " + file + " (" + fehlerText(e) + "). Lokal erzeugen.");
      }
    }
  }
  return thumbs.getThumb(file, w); // lokal erzeugen; Quelle via getTemplateFile (R2/Repo)
}

// keywords.json als Objekt. Synchron, weil templates.list() synchron ist. In "r2"
// wird die beim Start vorgewaermte R2-Version genutzt, sonst das intakte Repo.
let _kwCache = null;
function getKeywords() {
  if (source() === "r2" && _kwCache) return _kwCache;
  return require("./keywords").readAll(); // Repo (immer vorhanden)
}

// Vorwaermen der R2-keywords.json (nicht-blockierend beim Start aufrufen). Wirft nie.
async function primeKeywords() {
  try {
    if (source() !== "r2") return;
    const c = r2();
    if (!c) return;
    const res = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: TPL_PREFIX + "keywords.json" }));
    const txt = typeof res.Body.transformToString === "function"
      ? await res.Body.transformToString()
      : (await bodyToBuffer(res.Body)).toString("utf8");
    const obj = JSON.parse(txt);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      _kwCache = obj;
      log("keywords.json aus R2 geladen: " + Object.keys(obj).length + " Eintraege.");
    } else {
      throw new Error("kein Objekt");
    }
  } catch (e) {
    log("keywords.json nicht aus R2: " + fehlerText(e) + ". Rueckfall Repo.");
    _kwCache = null;
  }
}

// Beim Serverstart: aktive Quelle protokollieren (immer, auch im Repo-Modus).
function logStartupSource() {
  const s = source();
  log("Quelle aktiv: " + s);
  if (s === "r2") {
    const c = r2();
    if (!c) log("Achtung: r2 gewuenscht, aber R2 nicht verfuegbar. Es wird aus dem Repo gelesen.");
    else log("R2 verbunden. Bucket " + c.bucket + ", Praefixe 'templates/' und 'thumbnails/'.");
  }
}

module.exports = {
  source, getTemplateFile, getThumbnail, getKeywords, primeKeywords, logStartupSource,
};
