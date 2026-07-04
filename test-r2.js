"use strict";

// Isolierter Cloudflare R2 Verbindungstest.
// WICHTIG: Diese Datei wird von NICHTS importiert und aendert keinen bestehenden
// Code (kein Ideogram edit-Flow, kein Auto-Flow 1/2). Rein additiv.
//
// Nutzt ausschliesslich die 5 Umgebungsvariablen:
//   S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION
//
// Ablauf: (a) kleine Testdatei schreiben, (b) wieder auslesen und Inhalt
// vergleichen, (c) wieder loeschen, damit der Bucket sauber bleibt.
//
// Start in der Render Shell:   node test-r2.js

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const ENDPOINT = process.env.S3_ENDPOINT || "";
const BUCKET = process.env.S3_BUCKET || "";
const ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || "";
const SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || "";
const REGION = process.env.S3_REGION || "";

const KEY = "_verbindungstest.txt";

function trenner() { console.log("=================================================="); }

function zeigeFehler(e) {
  console.log("    Fehlertyp : " + (e && e.name ? e.name : "unbekannt"));
  console.log("    Meldung   : " + (e && e.message ? e.message : String(e)));
  if (e && e.$metadata && e.$metadata.httpStatusCode) {
    console.log("    HTTP-Code : " + e.$metadata.httpStatusCode);
  }
}

async function main() {
  trenner();
  console.log("NightKit R2 Verbindungstest");
  trenner();

  // Schritt 0: sind alle 5 Variablen gesetzt?
  const fehlt = [];
  if (!ENDPOINT) fehlt.push("S3_ENDPOINT");
  if (!BUCKET) fehlt.push("S3_BUCKET");
  if (!ACCESS_KEY_ID) fehlt.push("S3_ACCESS_KEY_ID");
  if (!SECRET_ACCESS_KEY) fehlt.push("S3_SECRET_ACCESS_KEY");
  if (!REGION) fehlt.push("S3_REGION");
  if (fehlt.length) {
    console.log("FEHLER: Diese Umgebungsvariablen fehlen: " + fehlt.join(", "));
    console.log("Bitte in Render unter Environment eintragen und erneut starten.");
    process.exit(1);
  }

  console.log("Endpoint : " + ENDPOINT);
  console.log("Bucket   : " + BUCKET);
  console.log("Region   : " + REGION + "  (bei R2 ist der Wert 'auto' richtig)");
  console.log("Key ID   : " + ACCESS_KEY_ID.slice(0, 4) + "..." + ACCESS_KEY_ID.slice(-4) + "  (maskiert)");
  console.log("Secret   : gesetzt (" + SECRET_ACCESS_KEY.length + " Zeichen, wird nicht angezeigt)");
  trenner();

  const client = new S3Client({
    region: REGION,          // exakt der Wert der Variable, bei R2 "auto"
    endpoint: ENDPOINT,
    forcePathStyle: true,    // fuer R2 / S3-kompatible Anbieter noetig
    credentials: {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    },
  });

  const inhalt = "nightkit r2 verbindungstest " + new Date().toISOString();
  let allesOk = true;

  // (a) Schreiben
  try {
    await client.send(new PutObjectCommand({
      Bucket: BUCKET, Key: KEY, Body: inhalt, ContentType: "text/plain",
    }));
    console.log("(a) Schreiben  (PutObject)    : OK   -> Datei '" + KEY + "' in den Bucket geschrieben");
  } catch (e) {
    console.log("(a) Schreiben  (PutObject)    : FEHLGESCHLAGEN");
    zeigeFehler(e);
    console.log("Ohne erfolgreiches Schreiben kann der Rest nicht geprueft werden.");
    process.exit(1);
  }

  // (b) Auslesen und vergleichen
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }));
    const gelesen = await res.Body.transformToString();
    if (gelesen === inhalt) {
      console.log("(b) Auslesen   (GetObject)    : OK   -> Inhalt stimmt exakt ueberein");
    } else {
      allesOk = false;
      console.log("(b) Auslesen   (GetObject)    : Inhalt WEICHT AB");
      console.log("    geschrieben : " + inhalt);
      console.log("    gelesen     : " + gelesen);
    }
  } catch (e) {
    allesOk = false;
    console.log("(b) Auslesen   (GetObject)    : FEHLGESCHLAGEN");
    zeigeFehler(e);
  }

  // (c) Loeschen (Bucket sauber halten)
  try {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: KEY }));
    console.log("(c) Loeschen   (DeleteObject) : OK   -> Testdatei wieder entfernt, Bucket sauber");
  } catch (e) {
    allesOk = false;
    console.log("(c) Loeschen   (DeleteObject) : FEHLGESCHLAGEN");
    zeigeFehler(e);
  }

  trenner();
  if (allesOk) {
    console.log("ERGEBNIS: ALLES OK. Die R2 Anbindung funktioniert (Schreiben, Lesen, Loeschen).");
    process.exit(0);
  } else {
    console.log("ERGEBNIS: Es gab Fehler. Siehe die Zeilen oben.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.log("Unerwarteter Fehler:");
  zeigeFehler(e);
  process.exit(1);
});
