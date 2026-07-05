"use strict";

// EINMALIGE R2-Migration: kopiert die vorhandenen Templates + deren Thumbnails +
// keywords.json + templates.json nach R2. NUR Kopieren.
//
// WICHTIG:
// - Aendert NICHT, woher die App liest. Die App liest weiter aus dem Repo. Diese
//   Migration laedt nur zusaetzlich nach R2 hoch. Das Repo bleibt unveraendert.
// - Beruehrt weder edit-Flow (Ideogram) noch Auto-Flow 1/2.
// - WIRFT NIE (alles in try/catch), blockiert den Serverstart nicht (fire-and-forget).
// - Nutzt EXAKT denselben S3-Client wie der Selftest (readS3Env + makeR2Client aus
//   test-r2.js), also dieselben 5 S3_* Variablen, forcePathStyle true, region "auto".
// - Idempotent + fortsetzbar: pro Datei erst HeadObject, existiert sie schon, wird
//   sie uebersprungen. Nach einem Spin-down einfach erneut ausloesen.
//
// Schluessel-Struktur in R2 (spiegelt die Repo-Struktur):
//   templates/<Kategorie>/<datei>       Original-Templates (z.B. templates/Urban/urban-1.jpg)
//   templates/keywords.json             die Schlagwortdatei
//   templates/templates.json            das Manifest
//   thumbnails/<Kategorie>/<datei>.webp Thumbnails als WebP (z.B. thumbnails/Urban/urban-1.webp)
//
// Eigenstaendig startbar:   node migrate-r2.js
// Gated beim Serverstart ueber R2_MIGRATE=1 (siehe server.js).

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const {
  HeadObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("./lib/r2");
const templates = require("./lib/templates"); // nur lesend: list(), TEMPLATES_DIR

const PRAEFIX = "[R2-MIGRATE]";
const log = (m) => { try { console.log(PRAEFIX + " " + m); } catch (_) {} };

const TPL_PREFIX = "templates/";     // Original-Templates + Metadaten (spiegelt Repo)
const THUMB_PREFIX = "thumbnails/";  // Thumbnails als WebP
const THUMB_WIDTH = 360;             // gleiche Breite wie die Galerie der App

function contentType(file) {
  const f = file.toLowerCase();
  if (f.endsWith(".png")) return "image/png";
  if (f.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
function thumbKey(rel) {
  return THUMB_PREFIX + rel.replace(/\.(jpe?g|png)$/i, ".webp");
}

// Existiert der Schluessel schon in R2? true/false. Wirft nur bei echten Fehlern
// (z.B. falscher Key), nicht bei "nicht vorhanden".
async function exists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e) {
    const code = e && e.$metadata ? e.$metadata.httpStatusCode : undefined;
    if ((e && e.name === "NotFound") || code === 404) return false;
    throw e;
  }
}

// Laedt genau dann hoch, wenn der Schluessel noch fehlt. Zaehlt in counters.
async function putIfMissing(client, bucket, key, body, ct, counters) {
  try {
    if (await exists(client, bucket, key)) { counters.skipped++; return; }
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: ct }));
    counters.uploaded++;
  } catch (e) {
    counters.errors++;
    log("FEHLER bei " + key + ": " + fehlerText(e));
  }
}

// Alle Objekt-Schluessel unter einem Praefix (paginiert) als Set.
async function listKeys(client, bucket, prefix) {
  const set = new Set();
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, ContinuationToken: token,
    }));
    for (const o of (res.Contents || [])) set.add(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return set;
}

// Fuehrt die komplette Migration aus. WIRFT NIE. Gibt { ok, ... } zurueck.
async function runR2Migration() {
  try {
    const env = readS3Env();
    if (env.missing.length) {
      const reason = "Umgebungsvariablen fehlen: " + env.missing.join(", ");
      log("FEHLER: " + reason);
      log("FERTIG: 0 hochgeladen, 0 uebersprungen, 0 Fehler. " + reason);
      return { ok: false, reason };
    }

    const client = makeR2Client(env);
    const BUCKET = env.BUCKET;
    const items = templates.list(); // relative Pfade "Kategorie/datei.ext" (App-Quelle)
    const metaFiles = ["keywords.json", "templates.json"]
      .filter((f) => fs.existsSync(path.join(templates.TEMPLATES_DIR, f)));

    const total = items.length * 2 + metaFiles.length; // Original + Thumbnail je Template + Metadaten
    log("Start. Bucket " + BUCKET + " | Templates im Repo: " + items.length +
      " | Einheiten (Original+Thumb+Meta): " + total +
      " | Praefixe: '" + TPL_PREFIX + "' (Originale/Meta), '" + THUMB_PREFIX + "' (Thumbnails)");

    const counters = { uploaded: 0, skipped: 0, errors: 0 };
    let processed = 0;
    const tick = () => {
      processed++;
      if (processed % 25 === 0 || processed === total) {
        log(processed + "/" + total + " verarbeitet, " + counters.uploaded + " hochgeladen, " +
          counters.skipped + " uebersprungen, " + counters.errors + " Fehler");
      }
    };

    for (const t of items) {
      const rel = t.file;
      const full = path.join(templates.TEMPLATES_DIR, rel);
      let buf = null;
      try { buf = fs.readFileSync(full); }
      catch (e) { counters.errors += 2; log("FEHLER (Datei lesen) " + rel + ": " + fehlerText(e)); tick(); tick(); continue; }

      // (1) Original hochladen
      await putIfMissing(client, BUCKET, TPL_PREFIX + rel, buf, contentType(rel), counters);
      tick();

      // (2) Thumbnail erzeugen (gleiche Pipeline wie die App) und hochladen
      try {
        const tkey = thumbKey(rel);
        if (await exists(client, BUCKET, tkey)) {
          counters.skipped++;
        } else {
          const thumb = await sharp(buf).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
          await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: tkey, Body: thumb, ContentType: "image/webp" }));
          counters.uploaded++;
        }
      } catch (e) {
        counters.errors++;
        log("FEHLER (Thumbnail) " + rel + ": " + fehlerText(e));
      }
      tick();

      buf = null; // Speicher freigeben (wichtig fuer den kleinen Gratis-Tarif)
    }

    // (3) Metadaten-Dateien (keywords.json, templates.json)
    for (const f of metaFiles) {
      try {
        const buf = fs.readFileSync(path.join(templates.TEMPLATES_DIR, f));
        await putIfMissing(client, BUCKET, TPL_PREFIX + f, buf, "application/json", counters);
      } catch (e) {
        counters.errors++;
        log("FEHLER (Meta) " + f + ": " + fehlerText(e));
      }
      tick();
    }

    // Verifikation: Repo-Templates vs R2-Objekte (nur Bilder) unter templates/
    let r2Count = 0;
    let fehlend = [];
    try {
      const r2Keys = await listKeys(client, BUCKET, TPL_PREFIX);
      r2Count = [...r2Keys].filter((k) => /\.(jpe?g|png)$/i.test(k)).length;
      fehlend = items.filter((t) => !r2Keys.has(TPL_PREFIX + t.file)).map((t) => t.file);
      if (fehlend.length === 0) {
        log("Verifikation: OK. Repo " + items.length + " Templates = R2 " + r2Count + " Bild-Objekte unter '" + TPL_PREFIX + "'.");
      } else {
        log("Verifikation: ABWEICHUNG. Repo " + items.length + ", R2 " + r2Count + ". Es fehlen " + fehlend.length + ": " +
          fehlend.slice(0, 25).join(", ") + (fehlend.length > 25 ? " ..." : ""));
      }
    } catch (e) {
      log("Verifikation nicht moeglich: " + fehlerText(e));
    }

    log("FERTIG: " + counters.uploaded + " hochgeladen, " + counters.skipped + " uebersprungen, " +
      counters.errors + " Fehler. Templates in R2: " + r2Count);
    return { ok: counters.errors === 0 && fehlend.length === 0, ...counters, r2Count, fehlend: fehlend.length };
  } catch (e) {
    const reason = "Unerwarteter Fehler: " + fehlerText(e);
    log("FERTIG: FEHLER: " + reason);
    return { ok: false, reason };
  }
}

module.exports = { runR2Migration };

// Eigenstaendig startbar:   node migrate-r2.js
if (require.main === module) {
  runR2Migration()
    .then((r) => process.exit(r && r.ok ? 0 : 1))
    .catch(() => process.exit(1));
}
