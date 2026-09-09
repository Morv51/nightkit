"use strict";

// Club-Logos in R2. Ein Logo je Club, abgelegt unter
//   clublogos/<nutzer-id>/<name>
// Der Nutzer-Teil des Schluessels stammt IMMER aus dem serverseitig geprueften
// Supabase-Token, nie aus der Anfrage. Damit kann niemand den Schluessel eines
// fremden Kontos bilden: fragt A nach einem Namen von B, liegt unter A/<name>
// nichts und die Route antwortet 404.
//
// Eigener Client ueber lib/r2.js, bewusst UNABHAENGIG von TEMPLATE_SOURCE --
// das ist der Schalter der Template-Leseschicht und hat mit Club-Logos nichts
// zu tun.

const crypto = require("crypto");
const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("./r2");

const PREFIX = "clublogos/";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const P = "[CLUBLOGO]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

// Erlaubte Typen mit ihrer Endung und ihrer Signatur (Magic Bytes). Der
// Content-Type allein ist Behauptung des Browsers, die Signatur ist Beleg.
const TYPEN = [
  { mime: "image/png",  ext: "png",  pruef: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", ext: "jpg",  pruef: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", pruef: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
];

function typVonMime(mime) {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  return TYPEN.find((t) => t.mime === m) || null;
}

function typVonEndung(name) {
  const ext = String(name || "").toLowerCase().split(".").pop();
  return TYPEN.find((t) => t.ext === ext) || null;
}

// Lazy gebauter, gecachter Client. null = R2 nicht verfuegbar; die Routen
// melden das dann als klaren Fehler statt still nichts zu tun.
let _gebaut = false, _client = null, _bucket = null;
function r2() {
  if (_gebaut) return _client ? { client: _client, bucket: _bucket } : null;
  _gebaut = true;
  try {
    const env = readS3Env();
    if (env.missing.length) {
      log("R2-Variablen fehlen: " + env.missing.join(", "));
      return null;
    }
    _client = makeR2Client(env);
    _bucket = env.BUCKET;
    return { client: _client, bucket: _bucket };
  } catch (e) {
    log("Client nicht baubar: " + fehlerText(e));
    return null;
  }
}

function isConfigured() { return !!r2(); }

// Nur der Dateiname, den wir selbst vergeben haben: 32 Hexzeichen + Endung.
// Alles andere wird abgewiesen, bevor daraus ein Schluessel wird -- kein
// Traversal, keine fremden Praefixe.
function nameSicher(name) {
  return typeof name === "string" && /^[0-9a-f]{32}\.(png|jpg|webp)$/.test(name);
}

function schluessel(userId, name) {
  return PREFIX + userId + "/" + name;
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

// Prueft Groesse, Content-Type und Signatur und legt die Bytes ab. Gibt
// { name } zurueck oder wirft mit einer Meldung, die direkt anzeigbar ist.
async function put(userId, buffer, contentType) {
  if (!userId) throw new Error("Kein Konto.");
  if (!buffer || !buffer.length) throw new Error("Leere Datei.");
  if (buffer.length > MAX_BYTES) {
    throw new Error("Die Datei ist groesser als 2 MB.");
  }
  const typ = typVonMime(contentType);
  if (!typ) throw new Error("Nur PNG, JPEG oder WebP sind moeglich.");
  if (!typ.pruef(buffer)) {
    throw new Error("Die Datei ist kein gueltiges " + typ.ext.toUpperCase() + "-Bild.");
  }
  const c = r2();
  if (!c) throw new Error("Der Logo-Speicher ist nicht verfuegbar.");
  const name = crypto.randomBytes(16).toString("hex") + "." + typ.ext;
  await c.client.send(new PutObjectCommand({
    Bucket: c.bucket,
    Key: schluessel(userId, name),
    Body: buffer,
    ContentType: typ.mime,
  }));
  return { name };
}

// Holt die Bytes. Gibt { buffer, contentType } oder null (nicht vorhanden).
async function get(userId, name) {
  if (!userId || !nameSicher(name)) return null;
  const c = r2();
  if (!c) throw new Error("Der Logo-Speicher ist nicht verfuegbar.");
  try {
    const res = await c.client.send(new GetObjectCommand({
      Bucket: c.bucket, Key: schluessel(userId, name),
    }));
    const buffer = await bodyToBuffer(res.Body);
    if (!buffer || !buffer.length) return null;
    const typ = typVonEndung(name);
    return { buffer, contentType: typ ? typ.mime : "application/octet-stream" };
  } catch (e) {
    log("nicht lesbar: " + name + " (" + fehlerText(e) + ")");
    return null;
  }
}

module.exports = { isConfigured, put, get, nameSicher, MAX_BYTES };
