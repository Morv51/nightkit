"use strict";

// Dauerhafte Ablage der Auto-Flow-Ergebnisse in R2. REIN ADDITIV: der Auto-Flow-Ablauf
// (GPT Image + fal-Outpaint, Analyse, Copyright-Pfade) bleibt unberuehrt; hier wird NUR
// zusaetzlich gespeichert und wieder aufgelistet. Genutzt nur bei ADMIN_TOOLS=1 (Gate im
// Endpunkt) und wenn R2 verfuegbar ist.
//
// R2-Struktur:
//   templates/_autoflow/<runId>/run.json   -> Meta (createdAt, flow, mode, sourceName)
//   templates/_autoflow/<runId>/<nr>.png   -> ein fertiges Ergebnisbild (nach fal-Outpaint)
// Das "_autoflow" beginnt mit "_", also ignorieren walk()/die statische Route diese Objekte
// (nicht in Galerie/Verwaltung). Ueber /api/template-image + /api/thumb sind sie fuer die
// Studio-Ansicht lesbar (R2-Lesepfad, wie bei anderen "_"-Praefixen).

const { PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("../r2");

const PREFIX = "templates/_autoflow/";
const KEEP_RUNS = 30; // Aufbewahrung: nur die neuesten N Laeufe behalten (aeltere fliegen beim Auflisten raus)
const P = "[AUTOFLOW-STORE]";
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
const fileFor = (runId, index) => PREFIX + safe(runId) + "/" + safe(index) + ".png";
const metaKey = (runId) => PREFIX + safe(runId) + "/run.json";

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

// Ein fertiges Bild speichern + Run-Meta schreiben. Die Meta ist je Lauf konstant (der
// Aufrufer schickt dasselbe createdAt/flow/mode/sourceName), also idempotent und ohne Race
// bei mehreren Bildern desselben Laufs. Bilder haben eindeutige Keys -> keine Kollision.
async function saveImage({ runId, index, createdAt, flow, mode, sourceName, imageBuffer }) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar");
  if (!runId || !index) throw new Error("runId und index noetig");
  if (!imageBuffer || !imageBuffer.length) throw new Error("Bild fehlt");
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: fileFor(runId, index), Body: imageBuffer, ContentType: "image/png" }));
  const meta = {
    runId: safe(runId),
    createdAt: createdAt || new Date().toISOString(),
    flow: String(flow || ""),
    mode: String(mode || ""),
    sourceName: String(sourceName || ""),
  };
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: metaKey(runId), Body: JSON.stringify(meta), ContentType: "application/json" }));
  return { ok: true, file: fileFor(runId, index) };
}

// Alle Laeufe auflisten (neueste zuerst), inkl. Bild-URLs fuer Vorschau + Vollbild. Danach
// Aufbewahrung anwenden: Laeufe ueber KEEP_RUNS hinaus best-effort loeschen.
async function listRuns() {
  const c = r2();
  if (!c) return { ok: false, error: "R2 nicht verfuegbar", runs: [] };
  let keys;
  try { keys = await allKeys(c.client, c.bucket, PREFIX); }
  catch (e) { return { ok: false, error: fehlerText(e), runs: [] }; }

  const byRun = new Map();
  for (const key of keys) {
    const rel = key.slice(PREFIX.length);        // "<runId>/<datei>"
    const slash = rel.indexOf("/");
    if (slash < 0) continue;
    const runId = rel.slice(0, slash);
    const file = rel.slice(slash + 1);
    if (!byRun.has(runId)) byRun.set(runId, { runId, images: [] });
    if (file === "run.json") continue;
    if (/\.png$/i.test(file)) {
      const relFile = "_autoflow/" + runId + "/" + file;
      byRun.get(runId).images.push({
        index: file.replace(/\.png$/i, ""),
        thumb: "/api/thumb?w=360&file=" + encodeURIComponent(relFile),
        full: "/api/template-image?file=" + encodeURIComponent(relFile),
      });
    }
  }
  for (const g of byRun.values()) {
    const meta = await getJson(c.client, c.bucket, PREFIX + g.runId + "/run.json");
    g.createdAt = (meta && meta.createdAt) || "";
    g.flow = (meta && meta.flow) || "";
    g.mode = (meta && meta.mode) || "";
    g.sourceName = (meta && meta.sourceName) || "";
    g.images.sort((a, b) => a.index.localeCompare(b.index, "en", { numeric: true }));
  }
  let runs = [...byRun.values()].filter((g) => g.images.length > 0);
  runs.sort((a, b) => (b.createdAt || b.runId).localeCompare(a.createdAt || a.runId));

  const prune = runs.slice(KEEP_RUNS);
  runs = runs.slice(0, KEEP_RUNS);
  for (const r of prune) { try { await deleteRun(r.runId); } catch (_) {} }

  return { ok: true, runs, pruned: prune.length, keep: KEEP_RUNS };
}

// Einen Lauf komplett loeschen (alle Objekte unter dem runId-Ordner).
async function deleteRun(runId) {
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar");
  const id = safe(runId);
  if (!id) throw new Error("runId noetig");
  const keys = (await allKeys(c.client, c.bucket, PREFIX + id + "/")).map((Key) => ({ Key }));
  if (!keys.length) return { ok: true, deleted: 0 };
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await c.client.send(new DeleteObjectsCommand({ Bucket: c.bucket, Delete: { Objects: batch, Quiet: true } }));
    deleted += batch.length;
  }
  log("Lauf geloescht: " + id + " (" + deleted + " Objekte)");
  return { ok: true, deleted };
}

module.exports = { saveImage, listRuns, deleteRun, KEEP_RUNS };
