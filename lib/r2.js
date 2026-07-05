"use strict";

// Geteilter Cloudflare R2 / S3 Zugang. EINE Stelle, an der der Client gebaut wird,
// damit Verbindungstest (test-r2.js), Migration (migrate-r2.js) und Lese-Schicht
// (lib/templateSource.js) exakt denselben Client benutzen. Kein abweichender Client.
//
// Nutzt die 5 Umgebungsvariablen:
//   S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION
// forcePathStyle true, region gleich dem Wert von S3_REGION (bei R2 "auto").

const { S3Client } = require("@aws-sdk/client-s3");

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

// Der EINE Client-Aufbau (fuer Selftest, Migration und Lesen identisch).
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

module.exports = { readS3Env, makeR2Client, fehlerText };
