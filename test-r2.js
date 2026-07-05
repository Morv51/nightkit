"use strict";

// Isolierter Cloudflare R2 Verbindungstest + geteilte S3-Helfer.
//
// - readS3Env()   : liest die 5 S3_* Variablen, meldet fehlende.
// - makeR2Client(): EXAKT der eine Client-Aufbau (forcePathStyle true, region gleich
//                   S3_REGION, also "auto"). Wird von Selftest UND Migration genutzt,
//                   damit es keinen abweichenden Client gibt.
// - runR2SelfTest(): schreibt, liest, vergleicht, loescht eine kleine Testdatei.
//   Loggt mit Praefix [R2-SELFTEST], WIRFT NIE, gibt { ok, reason } zurueck.
//
// Eigenstaendig startbar:   node test-r2.js
// Aendert keinen bestehenden Code (kein Ideogram edit-Flow, kein Auto-Flow 1/2).

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const PRAEFIX = "[R2-SELFTEST]";
const log = (msg) => { try { console.log(PRAEFIX + " " + msg); } catch (_) {} };
const KEY = "_verbindungstest.txt";

// Liest die 5 S3_* Variablen. env.missing listet fehlende (mit S3_ Praefix).
function readS3Env() {
  const env = {
    ENDPOINT: process.env.S3_ENDPOINT || "",
    BUCKET: process.env.S3_BUCKET || "",
    ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || "",
    SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || "",
    REGION: process.env.S3_REGION || "",
  };
  env.missing = ["ENDPOINT", "BUCKET", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "REGION"]
    .filter((k) => !env[k]).map((k) => "S3_" + k);
  return env;
}

// Der EINE Client-Aufbau (fuer Selftest und Migration identisch).
function makeR2Client(env) {
  return new S3Client({
    region: env.REGION,          // exakt der Wert der Variable, bei R2 "auto"
    endpoint: env.ENDPOINT,
    forcePathStyle: true,        // fuer R2 / S3-kompatible Anbieter noetig
    credentials: { accessKeyId: env.ACCESS_KEY_ID, secretAccessKey: env.SECRET_ACCESS_KEY },
  });
}

function fehlerText(e) {
  const typ = e && e.name ? e.name : "unbekannt";
  const msg = e && e.message ? e.message : String(e);
  const http = e && e.$metadata && e.$metadata.httpStatusCode ? " (HTTP " + e.$metadata.httpStatusCode + ")" : "";
  return typ + ": " + msg + http;
}

async function tryDelete(client, bucket) {
  try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: KEY })); } catch (_) {}
}

// Fuehrt den kompletten Verbindungstest aus. WIRFT NIE. Gibt { ok, reason } zurueck.
async function runR2SelfTest() {
  try {
    const env = readS3Env();
    if (env.missing.length) {
      const reason = "Umgebungsvariablen fehlen: " + env.missing.join(", ");
      log("FEHLER: " + reason);
      log("ERGEBNIS: FEHLER: " + reason);
      return { ok: false, reason };
    }

    log("Start. Endpoint " + env.ENDPOINT + " | Bucket " + env.BUCKET + " | Region " + env.REGION +
      " | Key " + env.ACCESS_KEY_ID.slice(0, 4) + "..." + env.ACCESS_KEY_ID.slice(-4) + " (maskiert)");

    const client = makeR2Client(env);
    const BUCKET = env.BUCKET;
    const inhalt = "nightkit r2 verbindungstest " + new Date().toISOString();

    // (a) Schreiben
    try {
      await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: KEY, Body: inhalt, ContentType: "text/plain" }));
      log("(a) Schreiben (PutObject): OK, Datei '" + KEY + "' geschrieben");
    } catch (e) {
      const reason = "Schreiben fehlgeschlagen: " + fehlerText(e);
      log("(a) Schreiben (PutObject): FEHLGESCHLAGEN, " + fehlerText(e));
      log("ERGEBNIS: FEHLER: " + reason);
      return { ok: false, reason };
    }

    // (b) Auslesen und vergleichen
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }));
      const gelesen = await res.Body.transformToString();
      if (gelesen === inhalt) {
        log("(b) Auslesen (GetObject): OK, Inhalt stimmt ueberein");
      } else {
        const reason = "Gelesener Inhalt weicht ab";
        log("(b) Auslesen (GetObject): " + reason);
        await tryDelete(client, BUCKET);
        log("ERGEBNIS: FEHLER: " + reason);
        return { ok: false, reason };
      }
    } catch (e) {
      const reason = "Auslesen fehlgeschlagen: " + fehlerText(e);
      log("(b) Auslesen (GetObject): FEHLGESCHLAGEN, " + fehlerText(e));
      await tryDelete(client, BUCKET);
      log("ERGEBNIS: FEHLER: " + reason);
      return { ok: false, reason };
    }

    // (c) Loeschen (Bucket sauber halten)
    try {
      await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: KEY }));
      log("(c) Loeschen (DeleteObject): OK, Bucket wieder sauber");
    } catch (e) {
      const reason = "Loeschen fehlgeschlagen: " + fehlerText(e);
      log("(c) Loeschen (DeleteObject): FEHLGESCHLAGEN, " + fehlerText(e));
      log("ERGEBNIS: FEHLER: " + reason);
      return { ok: false, reason };
    }

    log("ERGEBNIS: ALLES OK");
    return { ok: true, reason: "" };
  } catch (e) {
    const reason = "Unerwarteter Fehler: " + fehlerText(e);
    log("ERGEBNIS: FEHLER: " + reason);
    return { ok: false, reason };
  }
}

module.exports = { runR2SelfTest, readS3Env, makeR2Client, fehlerText };

// Eigenstaendig startbar:   node test-r2.js
if (require.main === module) {
  runR2SelfTest()
    .then((r) => process.exit(r && r.ok ? 0 : 1))
    .catch(() => process.exit(1));
}
