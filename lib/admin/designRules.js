"use strict";

// Grafik-Analyse, Phase 3: dauerhafte Ablage des destillierten REGELWERKS in R2 — als
// GETRENNTE Datei, NICHT im Bildprompt-Code. So bleibt es lesbar und spaeter aktualisierbar,
// ohne Code anzufassen. Additiv und isoliert; EIGENER Prefix, damit die Datensatz-Liste aus
// Phase 2 (templates/_design_analysis/) das Regelwerk nie als Datensatz einliest.
//
// R2-Struktur:
//   templates/_design_rules/latest.json  -> das aktuelle destillierte Regelwerk
// Der Prefix beginnt mit "_", also ignorieren walk()/die Galerie/der Static-Server ihn.

const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("../r2");

const KEY = "templates/_design_rules/latest.json";
const P = "[DESIGN-RULES]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

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

// Regelwerk speichern (ueberschreibt das vorige — es gibt immer genau ein aktuelles).
async function saveRuleset(ruleset) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar");
  const createdAt = new Date().toISOString();
  const rec = { createdAt, ...(ruleset || {}) };
  await c.client.send(new PutObjectCommand({
    Bucket: c.bucket, Key: KEY, Body: JSON.stringify(rec), ContentType: "application/json",
  }));
  log("Regelwerk gespeichert (" + ((ruleset && ruleset.basis && ruleset.basis.datensaetze) || "?") + " Datensaetze)");
  return rec;
}

// Aktuelles Regelwerk laden. Noch keins vorhanden -> { ok:true, ruleset:null }.
async function loadRuleset() {
  const c = r2();
  if (!c) return { ok: false, error: "R2 nicht verfuegbar", ruleset: null };
  try {
    const res = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: KEY }));
    return { ok: true, ruleset: JSON.parse(await res.Body.transformToString()) };
  } catch (e) {
    const code = e && (e.name || (e.$metadata && e.$metadata.httpStatusCode));
    if (code === "NoSuchKey" || code === 404) return { ok: true, ruleset: null };
    return { ok: false, error: fehlerText(e), ruleset: null };
  }
}

// Regelwerk verwerfen.
async function clearRuleset() {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar");
  await c.client.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: KEY }));
  log("Regelwerk geloescht");
  return { ok: true };
}

module.exports = { saveRuleset, loadRuleset, clearRuleset };
