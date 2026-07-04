"use strict";

// Isolierter Cloudflare R2 Verbindungstest.
//
// - Exportiert runR2SelfTest(): schreibt, liest und loescht eine kleine Testdatei
//   ueber die 5 S3_* Umgebungsvariablen. Loggt ALLES mit dem Praefix [R2-SELFTEST]
//   und WIRFT NIE (alles in try/catch, Rueckgabe { ok, reason }). Dadurch kann der
//   Aufruf beim Serverstart den Start niemals blockieren oder abstuerzen lassen.
// - Bleibt eigenstaendig startbar:   node test-r2.js
//
// Aendert keinen bestehenden Code (kein Ideogram edit-Flow, kein Auto-Flow 1/2).
// Nutzt: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION
// forcePathStyle true, region gleich dem Wert von S3_REGION (bei R2 "auto").

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const PRAEFIX = "[R2-SELFTEST]";
const log = (msg) => { try { console.log(PRAEFIX + " " + msg); } catch (_) {} };
const KEY = "_verbindungstest.txt";

function fehlerText(e) {
  const typ = e && e.name ? e.name : "unbekannt";
  const msg = e && e.message ? e.message : String(e);
  const http = e && e.$metadata && e.$metadata.httpStatusCode ? " (HTTP " + e.$metadata.httpStatusCode + ")" : "";
  return typ + ": " + msg + http;
}

async function tryDelete(client, bucket) {
  try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: KEY })); } catch (_) {}
}

// Fuehrt den kompletten Test aus. WIRFT NIE. Gibt { ok: boolean, reason: string } zurueck.
async function runR2SelfTest() {
  try {
    const ENDPOINT = process.env.S3_ENDPOINT || "";
    const BUCKET = process.env.S3_BUCKET || "";
    const ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || "";
    const SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || "";
    const REGION = process.env.S3_REGION || "";

    const fehlt = [];
    if (!ENDPOINT) fehlt.push("S3_ENDPOINT");
    if (!BUCKET) fehlt.push("S3_BUCKET");
    if (!ACCESS_KEY_ID) fehlt.push("S3_ACCESS_KEY_ID");
    if (!SECRET_ACCESS_KEY) fehlt.push("S3_SECRET_ACCESS_KEY");
    if (!REGION) fehlt.push("S3_REGION");
    if (fehlt.length) {
      const reason = "Umgebungsvariablen fehlen: " + fehlt.join(", ");
      log("FEHLER: " + reason);
      log("ERGEBNIS: FEHLER: " + reason);
      return { ok: false, reason };
    }

    log("Start. Endpoint " + ENDPOINT + " | Bucket " + BUCKET + " | Region " + REGION +
      " | Key " + ACCESS_KEY_ID.slice(0, 4) + "..." + ACCESS_KEY_ID.slice(-4) + " (maskiert)");

    const client = new S3Client({
      region: REGION,          // exakt der Wert der Variable, bei R2 "auto"
      endpoint: ENDPOINT,
      forcePathStyle: true,    // fuer R2 / S3-kompatible Anbieter noetig
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    });

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
    // Letzte Sicherheit: unter keinen Umstaenden werfen.
    const reason = "Unerwarteter Fehler: " + fehlerText(e);
    log("ERGEBNIS: FEHLER: " + reason);
    return { ok: false, reason };
  }
}

module.exports = { runR2SelfTest };

// Eigenstaendig startbar:   node test-r2.js
if (require.main === module) {
  runR2SelfTest()
    .then((r) => process.exit(r && r.ok ? 0 : 1))
    .catch(() => process.exit(1));
}
