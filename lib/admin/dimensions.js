"use strict";

// Format-/Seitenverhaeltnis-Analyse (reine ANZEIGE, aendert nichts). Ermittelt je
// Template die echten Pixelmasse und cached sie DAUERHAFT in R2 unter
//   templates/_admin_dimensions.json  ->  { "Kategorie/datei.jpg": [breite, hoehe] }
// damit die Bestandsverwaltung NICHT bei jedem Aufruf alle Bilder laedt.
//
// Ziel 9:16 = 0.5625. Toleranz: Verhaeltnis (Breite/Hoehe) im Bereich 0.53 bis 0.59
// (einschliesslich) gilt als "9:16 / nah dran", alles ausserhalb als "abweichend".
//
// Muster wie die anderen Admin-Overlays (Repo nur Backup, fehlt die Datei gilt sie als
// leer, Getter WERFEN NIE, Dateiname mit "_" wird von walk()/Static ignoriert). Nutzt den
// geteilten S3-Client (lib/r2.js) und NUR lesend die Lese-Schicht (templateSource,
// R2 mit Repo-Rueckfall). Es wird nichts markiert, ausgeblendet oder veraendert.

const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("../r2");

const KEY = "templates/_admin_dimensions.json";
const P = "[ADMIN-DIMS]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

// Toleranzband um 9:16 (0.5625). Innerhalb = "im Format", ausserhalb = "abweichend".
const TARGET = 0.5625;
const LOW = 0.53;
const HIGH = 0.59;
const WRITE_EVERY = 40; // Zwischenstand nach so vielen berechneten Bildern nach R2 sichern

let _dims = null; // Map<file, [w, h]>

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

async function prime() {
  try {
    const o = await fetchJson();
    _dims = new Map();
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const [file, wh] of Object.entries(o)) {
        if (typeof file === "string" && Array.isArray(wh) && wh[0] > 0 && wh[1] > 0) _dims.set(file, [wh[0], wh[1]]);
      }
    }
    log("geladen: Masse fuer " + _dims.size + " Template(s)");
  } catch (e) {
    log("Laden fehlgeschlagen: " + fehlerText(e));
    if (!(_dims instanceof Map)) _dims = new Map();
  }
}

async function ensureLoaded() {
  if (!(_dims instanceof Map)) await prime();
  if (!(_dims instanceof Map)) _dims = new Map();
}

function dimsMap() { return _dims instanceof Map ? _dims : new Map(); }

async function putAll(next) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar, kann Masse nicht speichern");
  const obj = Object.fromEntries([...next.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: KEY, Body: JSON.stringify(obj), ContentType: "application/json" }));
}

// Status eines einzelnen Templates aus dem Cache (oder null, wenn noch nicht berechnet).
function info(file) {
  const d = dimsMap().get(file);
  if (!Array.isArray(d) || !(d[0] > 0) || !(d[1] > 0)) return null;
  const w = d[0], h = d[1];
  const ratio = Math.round((w / h) * 1000) / 1000;
  return { w, h, ratio, status: (ratio >= LOW && ratio <= HIGH) ? "in" : "out" };
}

// Zaehlung ueber eine Dateiliste: im Format / abweichend / ungeprueft.
function summary(files) {
  let inFormat = 0, deviating = 0, unknown = 0;
  for (const f of files || []) {
    const i = info(f);
    if (!i) unknown++; else if (i.status === "in") inFormat++; else deviating++;
  }
  return { inFormat, deviating, unknown, total: (files || []).length, target: TARGET, low: LOW, high: HIGH };
}

// Masse berechnen und cachen. Standard: nur FEHLENDE (neue Templates) ergaenzen.
// force=true: alles neu berechnen. Liest die Original-Bytes ueber die Lese-Schicht
// (R2 mit Repo-Rueckfall) und nimmt die Masse aus dem Bild-Header (sharp.metadata,
// dekodiert das Bild NICHT voll). Zwischenstand wird alle WRITE_EVERY Bilder gesichert,
// damit auch bei einem Abbruch/Timeout kein Fortschritt verloren geht (Wiederholung
// ueberspringt bereits berechnete). Verwaiste Eintraege (geloeschte Templates) fliegen raus.
async function compute(files, opts = {}) {
  await ensureLoaded();
  const list = Array.isArray(files) ? files : [];
  const force = !!opts.force;
  const sharp = require("sharp");
  const templateSource = require("../templateSource");
  const next = force ? new Map() : new Map(_dims);
  const want = list.filter((f) => !next.has(f));
  let computed = 0, failed = 0, sinceWrite = 0;
  for (const file of want) {
    try {
      const buf = await templateSource.getTemplateFile(file);
      const meta = await sharp(buf).metadata();
      if (meta && meta.width > 0 && meta.height > 0) { next.set(file, [meta.width, meta.height]); computed++; sinceWrite++; }
      else failed++;
    } catch (_) { failed++; }
    // Zwischenstand: In-Memory-Cache immer aktualisieren, R2-Schreiben best-effort.
    if (sinceWrite >= WRITE_EVERY) { _dims = next; try { await putAll(next); } catch (_) {} sinceWrite = 0; }
  }
  // Verwaiste Eintraege entfernen (Templates, die es nicht mehr gibt).
  const set = new Set(list);
  for (const k of [...next.keys()]) if (!set.has(k)) next.delete(k);
  _dims = next; // in-memory sofort gueltig (auch falls R2 nicht schreibbar ist)
  let persisted = true;
  try { await putAll(next); } catch (e) { persisted = false; log("Cache NICHT nach R2 geschrieben: " + fehlerText(e)); }
  return { computed, failed, total: next.size, persisted };
}

module.exports = { prime, info, summary, compute, dimsMap, TARGET, LOW, HIGH };
