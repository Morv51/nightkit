"use strict";

// Grafik-Analyse (Bestandsverwaltung, Phase 1+2): dauerhafte Ablage der Analyse-DATENSAETZE
// in R2. Die analysierten BILDER werden bewusst NICHT gespeichert — sie dienen nur der
// Musterextraktion, werden nicht Vorlage und nicht nachgebaut. Phase 3 wertet die Datensaetze
// spaeter ALLE GEMEINSAM aus, darum liegen sie gesammelt unter einem Praefix.
//
// R2-Struktur:
//   templates/_design_analysis/<id>.json  -> ein Datensatz je analysiertem Flyer
// Das "_design_analysis" beginnt mit "_", also ignorieren walk()/die Galerie diese Objekte.
//
// Additiv und isoliert: beruehrt keinen bestehenden Store und keine Lese-Schicht.

const { PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("../r2");

const PREFIX = "templates/_design_analysis/";
const P = "[DESIGN-ANALYSIS]";
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

const safe = (s) => String(s == null ? "" : s).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

async function allKeys(client, bucket, prefix) {
  const out = [];
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of (res.Contents || [])) out.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function getJson(client, bucket, key) {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return JSON.parse(await res.Body.transformToString());
  } catch (_) { return null; }
}

// Einen Datensatz speichern. rec: { sourceName, model, fields:{...9 Felder} }
async function saveRecord({ sourceName, model, fields }) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar");
  const createdAt = new Date().toISOString();
  const id = createdAt.replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 6);
  const rec = { id, createdAt, sourceName: String(sourceName || ""), model: String(model || ""), fields: fields || {} };
  await c.client.send(new PutObjectCommand({
    Bucket: c.bucket, Key: PREFIX + safe(id) + ".json",
    Body: JSON.stringify(rec), ContentType: "application/json",
  }));
  log("Datensatz gespeichert: " + id + " (" + rec.sourceName + ")");
  return rec;
}

// ALLE Datensaetze laden (aelteste zuerst) — Grundlage fuer Phase 3.
async function listRecords() {
  const c = r2();
  if (!c) return { ok: false, error: "R2 nicht verfuegbar", records: [] };
  let keys;
  try { keys = (await allKeys(c.client, c.bucket, PREFIX)).filter((k) => /\.json$/i.test(k)); }
  catch (e) { return { ok: false, error: fehlerText(e), records: [] }; }
  const records = [];
  for (const k of keys) {
    const rec = await getJson(c.client, c.bucket, k);
    if (rec) records.push(rec);
  }
  records.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return { ok: true, records };
}

// Alle Datensaetze verwerfen (neu anfangen).
async function clearRecords() {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar");
  const keys = (await allKeys(c.client, c.bucket, PREFIX)).map((Key) => ({ Key }));
  if (!keys.length) return { ok: true, deleted: 0 };
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await c.client.send(new DeleteObjectsCommand({ Bucket: c.bucket, Delete: { Objects: batch, Quiet: true } }));
    deleted += batch.length;
  }
  log("Datensaetze geloescht: " + deleted);
  return { ok: true, deleted };
}

module.exports = { saveRecord, listRecords, clearRecords };
