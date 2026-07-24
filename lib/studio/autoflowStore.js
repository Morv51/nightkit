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

const { PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
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

// ── Serverseitiger Lauf: Vollzustand (run.json), Eingabebilder, Ergebnisbild, Existenz ──
const extForMime = (mt) => { const m = String(mt || "").toLowerCase(); return m.includes("png") ? "png" : m.includes("webp") ? "webp" : "jpg"; };
const srcKey = (runId, fnum, ext) => PREFIX + safe(runId) + "/_src/" + safe(String(fnum)) + "." + (ext || "jpg");

async function putState(runId, state) {
  const c = r2(); if (!c) throw new Error("R2 nicht verfuegbar");
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: metaKey(runId), Body: JSON.stringify(state), ContentType: "application/json" }));
  return { ok: true };
}
async function getState(runId) {
  const c = r2(); if (!c) return null;
  return getJson(c.client, c.bucket, metaKey(runId));
}
// Eingabe-Referenzbild ablegen/lesen (fuer serverseitiges Fortsetzen ueber Neustarts).
async function putInput(runId, fnum, buffer, contentType) {
  const c = r2(); if (!c) throw new Error("R2 nicht verfuegbar");
  const ext = extForMime(contentType);
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: srcKey(runId, fnum, ext), Body: buffer, ContentType: contentType || "image/jpeg" }));
  return { ext };
}
async function getInput(runId, fnum, ext) {
  const c = r2(); if (!c) throw new Error("R2 nicht verfuegbar");
  const res = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: srcKey(runId, fnum, ext) }));
  const bytes = await res.Body.transformToByteArray();
  return { buffer: Buffer.from(bytes), contentType: res.ContentType || ("image/" + (ext === "png" ? "png" : ext === "webp" ? "webp" : "jpeg")) };
}
// NUR das Ergebnisbild schreiben (run.json verwaltet der Orchestrator via putState).
async function putResultImage(runId, index, buffer) {
  const c = r2(); if (!c) throw new Error("R2 nicht verfuegbar");
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: fileFor(runId, index), Body: buffer, ContentType: "image/png" }));
  return { ok: true, file: fileFor(runId, index) };
}
async function imageExists(runId, index) {
  const c = r2(); if (!c) return false;
  try { await c.client.send(new HeadObjectCommand({ Bucket: c.bucket, Key: fileFor(runId, index) })); return true; }
  catch (_) { return false; }
}

// ── Uebernahme in den Live-Bestand (nur Lese-/Marker-Primitiven; die eigentliche
//    Template-Erzeugung macht der Uploader-Kern in lib/admin/routes). ──
// Das gespeicherte Ergebnis-PNG als Puffer lesen (R2->R2, kein Transfer ueber das
// Geraet des Nutzers) — Grundlage fuer die serverseitige Uebernahme.
async function getResultImage(runId, index) {
  const c = r2(); if (!c) throw new Error("R2 nicht verfuegbar");
  const res = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: fileFor(runId, index) }));
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}
// Uebernahme-Marker liegen als EIGENE Objekte unter <runId>/_adopted/<index>.json —
// so wird run.json nicht angefasst (kein Race mit einem noch laufenden Lauf) und
// listRuns() ueberspringt sie ohnehin als Ergebnisbilder (Unterordner).
const adoptKey = (runId, index) => PREFIX + safe(runId) + "/_adopted/" + safe(index) + ".json";
async function getAdoption(runId, index) {
  const c = r2(); if (!c) return null;
  return getJson(c.client, c.bucket, adoptKey(runId, index));
}
async function setAdoption(runId, index, data) {
  const c = r2(); if (!c) throw new Error("R2 nicht verfuegbar");
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: adoptKey(runId, index), Body: JSON.stringify(data || {}), ContentType: "application/json" }));
  return { ok: true };
}

// Redesign-Marker, exakt dieselbe Form wie die Uebernahme-Marker, nur in eigenen Ordnern:
// <runId>/_swapped/<index>.json bzw. <runId>/_discarded/<index>.json. run.json bleibt unberuehrt.
const MARK_DIRS = { swapped: "_swapped", discarded: "_discarded" };
const markKey = (runId, kind, index) => PREFIX + safe(runId) + "/" + MARK_DIRS[kind] + "/" + safe(index) + ".json";
async function getMarker(runId, kind, index) {
  if (!MARK_DIRS[kind]) throw new Error("Unbekannte Markierung: " + kind);
  const c = r2(); if (!c) return null;
  return getJson(c.client, c.bucket, markKey(runId, kind, index));
}
async function setMarker(runId, kind, index, data) {
  if (!MARK_DIRS[kind]) throw new Error("Unbekannte Markierung: " + kind);
  const c = r2(); if (!c) throw new Error("R2 nicht verfuegbar");
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: markKey(runId, kind, index), Body: JSON.stringify(data || {}), ContentType: "application/json" }));
  return { ok: true };
}

// Alle Laeufe auflisten (neueste zuerst), inkl. Bild-URLs fuer Vorschau + Vollbild und dem
// vollen Lauf-Zustand (Status/Fortschritt). Danach Aufbewahrung: Laeufe ueber KEEP_RUNS
// hinaus best-effort loeschen (laufende NIE).
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
    if (!byRun.has(runId)) byRun.set(runId, { runId, images: [], adopted: new Map(), swapped: new Map(), discarded: new Map() });
    // Uebernahme-Marker (<runId>/_adopted/<index>.json) einsammeln -> Haekchen in der Ansicht.
    const am = file.match(/^_adopted\/(.+)\.json$/i);
    if (am) { byRun.get(runId).adopted.set(am[1], true); continue; }
    // Redesign-Marker, gleiche Form in eigenen Ordnern: getauscht bzw. verworfen. Bewusst ueber
    // den SCHLUESSELNAMEN erkannt, damit listRuns wie bisher ohne Zusatz-Abrufe auskommt.
    const sm = file.match(/^_swapped\/(.+)\.json$/i);
    if (sm) { byRun.get(runId).swapped.set(sm[1], true); continue; }
    const dm = file.match(/^_discarded\/(.+)\.json$/i);
    if (dm) { byRun.get(runId).discarded.set(dm[1], true); continue; }
    if (file === "run.json" || file.indexOf("/") >= 0) continue; // run.json + Unterordner (_src) nie als Ergebnis
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
    g.state = await getJson(c.client, c.bucket, PREFIX + g.runId + "/run.json");
    g.createdAt = (g.state && g.state.createdAt) || "";
    g.images.sort((a, b) => a.index.localeCompare(b.index, "en", { numeric: true }));
  }
  // Laeufe mit Bildern ODER mit Zustand (frisch gestartet, noch ohne Bild) zeigen.
  let grouped = [...byRun.values()].filter((g) => g.images.length > 0 || g.state);
  grouped.sort((a, b) => (b.createdAt || b.runId).localeCompare(a.createdAt || a.runId));

  // Aufbewahrung: aeltere ueber KEEP_RUNS loeschen, aber laufende NIE.
  const prune = grouped.slice(KEEP_RUNS).filter((g) => !(g.state && g.state.status === "running"));
  grouped = grouped.slice(0, KEEP_RUNS);
  for (const g of prune) { try { await deleteRun(g.runId); } catch (_) {} }

  const runs = grouped.map((g) => {
    const st = g.state || {};
    const tiles = Array.isArray(st.tiles) ? st.tiles : [];
    const files = Array.isArray(st.files) ? st.files : [];
    const tileByIndex = new Map(tiles.map((t) => [t.index, t]));
    const nameOf = (fnum) => { const f = files.find((x) => x.fnum === fnum); return f ? (f.name || "") : ""; };
    // Bauteil 5: Fehlertexte je Datei im Klartext (Analyse-Fehler + Bild-/Gate-Fehler je Kachel,
    // insbesondere Guthaben-Fehler). Nur echte Fehler, keine leeren Eintraege.
    const fileErrors = [];
    for (const f of files) {
      const msgs = [];
      if (f.analyzeError) msgs.push(String(f.analyzeError));
      for (const t of tiles) {
        if (t.fnum === f.fnum && (t.status === "error" || t.status === "blocked") && t.reason) {
          msgs.push((t.status === "blocked" ? "Guthaben/Limit: " : "") + String(t.reason));
        }
      }
      if (msgs.length) fileErrors.push({ fnum: f.fnum, name: f.name || "", blocked: tiles.some((t) => t.fnum === f.fnum && t.status === "blocked"), text: msgs.join(" · ") });
    }
    return {
      runId: g.runId,
      createdAt: st.createdAt || g.createdAt,
      flow: st.flow || "",
      mode: st.mode || "",
      regelwerk: !!st.regelwerk, // A/B: zeigt in der Liste, welcher Lauf mit Regelwerk lief
      hand: !!st.hand,           // A/B: Handzuordnung aus dem Prompting Tool statt Auto-Analyse
      status: st.status || (g.images.length ? "gespeichert" : ""),
      sourceName: Array.isArray(st.files) ? st.files.map((f) => f.name).filter(Boolean).join(", ") : (st.sourceName || ""),
      total: tiles.length,
      done: tiles.filter((t) => t.status === "done").length,
      failed: tiles.filter((t) => t.status === "error" || t.status === "blocked").length,
      cancelRequested: !!st.cancelRequested,
      // Redesign: Modus-Marke + Zuordnung Kachel -> Original. Der Kachel-Index ist
      // "<fnum>-v<k>", darum genuegt die fnum-Liste; die Ansicht schlaegt darueber nach.
      redesign: !!st.cleanRedesign,
      // Redesign v2: die Auftrags-Familie + die Fehlertexte je Datei (Bauteil 3c, 5).
      family: String(st.cleanFamilyText || ""),
      fileErrors,
      sources: Array.isArray(st.files)
        ? st.files.map((f) => ({ fnum: f.fnum, template: f.srcTemplate || "", name: f.name || "" }))
            .filter((x) => x.template)
        : [],
      images: g.images.map((im) => {
        const t = tileByIndex.get(im.index) || {};
        return {
          ...im,
          adopted: g.adopted.has(im.index),
          swapped: g.swapped.has(im.index),
          discarded: g.discarded.has(im.index),
          // Redesign v2: Karten-Kombination + Gate-Urteil je Kandidat.
          cards: t.cards || null,
          gate: t.gate || null,
          reroll: !!t.reroll,
        };
      }),
    };
  });
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

module.exports = {
  saveImage, listRuns, deleteRun, KEEP_RUNS,
  putState, getState, putInput, getInput, putResultImage, imageExists,
  getResultImage, getAdoption, setAdoption, getMarker, setMarker,
};
