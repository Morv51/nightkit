"use strict";

// STAPEL-Umformung: alle AKTIVEN 2:3-nah-Templates per teurem fal-Modell auf 9:16 bringen
// und direkt aktiv schalten. Rein ADDITIVE Admin-Funktion. Aendert NICHTS an ideogram.edit,
// den Auto-Flows, der Generierung oder der Lese-Schicht (nutzt sie nur). Dieses Modul ruft
// fal-ai/flux-2-pro/outpaint DIREKT ueber @fal-ai/client auf (unabhaengig von lib/fal.js).
//
// Ablauf je Template (nur bei Erfolg wird getauscht):
//   1. Bytes ueber die Lese-Schicht holen, Streifen oben/unten berechnen (Zielverhaeltnis
//      0.5625, Motiv nicht beschneiden, links/rechts unveraendert), per flux-2-pro outpainten.
//   2. Ergebnis als JPEG + Thumbnail nach R2 (neuer Dateiname "<basis>-916.jpg" im SELBEN
//      Ordner wie das Original).
//   3. Neue 9:16-Version aktiv schalten: Discovery-Registry, gleicher Anzeigename, gleiche
//      (effektive) Kategorie, gleiche Reihenfolge-Position wie das Original, Schlagworte
//      uebernehmen. Danach das 2:3-Original in den PAPIERKORB (soft-delete, wiederherstellbar),
//      NIEMALS hart geloescht.
// Schlaegt ein Template fehl (z. B. fal-Forbidden), wird es UEBERSPRUNGEN, der Lauf laeuft
// weiter, das Original bleibt unveraendert aktiv. Am Ende: Liste erfolgreich/fehlgeschlagen.
//
// Fortsetzbar/ohne Doppelzahlung: Ziele sind nur AKTIVE 2:3-nah (nicht im Papierkorb). Nach
// erfolgreichem Tausch ist das Original ausgeblendet und faellt aus der Zielmenge. Existiert
// die 9:16-Datei schon (abgebrochener Vorlauf), wird der teure fal-Aufruf uebersprungen.

const sharp = require("sharp");
const { fehlerText } = require("../r2");
const templateSource = require("../templateSource");
const templates = require("../templates");
const uploads = require("./uploads");
const overlays = require("./overlays");
const order = require("./order");
const dimensions = require("./dimensions");
const { OUTPAINT_PRICE_USD } = require("../fal"); // zentraler Preis pro flux-2-pro-Aufruf (0,20 USD)

const MODEL = "fal-ai/flux-2-pro/outpaint"; // teures, hochwertiges Modell (direkt ueber @fal-ai/client)
const TARGET = 0.5625;                        // 9:16
const P = "[REFORMAT-916]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

// Laufzustand im Speicher (Einzelinstanz-Annahme wie bei den uebrigen Admin-Overlays).
let job = null;

function ctypeOf(file) {
  const f = String(file).toLowerCase();
  return f.endsWith(".png") ? "image/png" : f.endsWith(".webp") ? "image/webp" : "image/jpeg";
}
function baseNoExt(file) { return String(file).split("/").pop().replace(/\.(jpe?g|png|webp)$/i, ""); }

// Effektive Sicht je Template (wie manage/list): Anzeigename, effektive Kategorie, Papierkorb.
function effectiveList() {
  const hidden = overlays.hiddenSet();
  const overrides = overlays.categoryOverrides();
  const names = uploads.namesMap();
  return templates.listRaw().map((t) => {
    const override = overrides.get(t.file) || null;
    return {
      file: t.file,
      name: names.get(t.file) || t.name,
      folderCategory: t.category,        // Ordner/Pfad
      category: override || t.category,  // effektiv angezeigt
      overridden: !!override,
      hidden: hidden.has(t.file),
    };
  });
}

// Ziele: AKTIVE (nicht im Papierkorb) Templates der Format-Kategorie "23" (2:3-nah).
function activeTargets() {
  const out = [];
  for (const t of effectiveList()) {
    if (t.hidden) continue;
    const info = dimensions.info(t.file);
    if (info && info.cat === "23") out.push(t);
  }
  return out;
}

// Vorschau ohne Lauf: Anzahl der Ziele + grobe Kostenschaetzung.
function previewCount() {
  const targets = activeTargets();
  return { total: targets.length, estCost: Math.round(targets.length * OUTPAINT_PRICE_USD * 100) / 100 };
}

// fal-Validierungsfehler (422 / "Unprocessable Entity") erkennen. Nur dann lohnt der
// Sauber-Neukodier-Versuch; andere Fehler (Guthaben/Timeout) bringt das nicht weiter.
function isValidationError(e) {
  if (!e) return false;
  const status = e.status || e.statusCode || (e.response && e.response.status);
  if (status === 422) return true;
  const s = ((e.name || "") + " " + (e.message || "") + " " + String(e)).toLowerCase();
  return s.includes("unprocessable") || s.includes("validationerror") || s.includes(" 422");
}

// Ein Template auf 9:16 outpainten (teures Modell flux-2-pro). Liefert die Ergebnis-Bytes.
// Bei einer ValidationError wird die Eingabe EINMAL verlustfrei und metadatenfrei als PNG
// neu kodiert (sharp strippt Metadaten wie den Photoshop-Marker) und mit DEMSELBEN Modell
// wiederholt. Kein Modellwechsel, keine Qualitaetsminderung. Hilft, falls fal am Datei-
// Container haengt; hilft nicht, falls fal den Bildinhalt selbst ablehnt (dann echter Fehler).
async function outpaint(buf, ctype) {
  const meta = await sharp(buf).metadata();
  const w = meta.width, h = meta.height;
  const targetH = Math.round(w / TARGET);
  const extra = Math.max(0, targetH - h);
  if (extra <= 0) return { skip: true };
  const top = Math.floor(extra / 2), bottom = extra - top;
  const { fal } = require("@fal-ai/client");
  fal.config({ credentials: process.env.FAL_KEY });

  const call = async (dataUrl) => {
    const result = await fal.subscribe(MODEL, {
      input: { image_url: dataUrl, expand_top: top, expand_bottom: bottom, expand_left: 0, expand_right: 0, output_format: "png" },
    });
    const data = result && result.data ? result.data : result;
    const url = data && data.images && data.images[0] && data.images[0].url;
    if (!url) throw new Error("Kein Ergebnisbild von fal erhalten");
    const res = await fetch(url);
    if (!res.ok) throw new Error("Ergebnis-Download HTTP " + res.status);
    return Buffer.from(await res.arrayBuffer());
  };

  let outBuf, sanitized = false;
  try {
    outBuf = await call("data:" + ctype + ";base64," + buf.toString("base64"));
  } catch (e) {
    if (!isValidationError(e)) throw e; // nur bei ValidationError sauber neu versuchen
    log("ValidationError -> Eingabe verlustfrei als saubere PNG neu kodieren und erneut flux-2-pro");
    const clean = await sharp(buf).png({ compressionLevel: 9 }).toBuffer(); // strippt Metadaten, verlustfrei
    outBuf = await call("data:image/png;base64," + clean.toString("base64"));
    sanitized = true;
  }
  return { skip: false, outBuf, top, bottom, sanitized };
}

// Reihenfolge so setzen, dass die neue Datei EXAKT den Platz des Originals einnimmt.
async function pinOrderReplacing(effCat, orig, newRel) {
  const cur = templates.list().filter((t) => t.category === effCat).map((t) => t.file);
  const withoutNew = cur.filter((f) => f !== newRel); // neu registrierte Datei aus ihrem Standard-Slot nehmen
  const idx = withoutNew.indexOf(orig);
  const seq = withoutNew.filter((f) => f !== orig);
  if (idx >= 0) seq.splice(idx, 0, newRel); else seq.push(newRel);
  await order.setOrder(effCat, seq);
}

// Ein Template komplett verarbeiten: umformen (falls noetig) + aktiv schalten + Original in Papierkorb.
async function processOne(t) {
  const orig = t.file;
  const newRel = t.folderCategory + "/" + baseNoExt(orig) + "-916.jpg"; // im SELBEN Ordner
  const newKey = "templates/" + newRel;
  const thumbKey = "thumbnails/" + newRel.replace(/\.jpe?g$/i, ".webp");
  let estCost = 0, sanitized = false;

  // 1) Bild erzeugen, falls nicht schon vorhanden (kein Doppelzahlen bei Wiederholung).
  const exists = await uploads.keyExists(newKey);
  if (!exists) {
    const buf = await templateSource.getTemplateFile(orig);
    const r = await outpaint(buf, ctypeOf(orig));
    if (r.skip) throw new Error("Bild ist bereits mindestens 9:16");
    sanitized = !!r.sanitized;
    const jpg = await sharp(r.outBuf).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
    const thumb = await sharp(r.outBuf).resize({ width: 360, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    estCost = OUTPAINT_PRICE_USD; // 0,20 USD pro erfolgreichem fal-Aufruf (ein 422-Ablehnung davor kostet nichts)
    await uploads.putObject(newKey, jpg, "image/jpeg");
    await uploads.putObject(thumbKey, thumb, "image/webp");
  }

  // 2) Aktiv schalten und Platz/Name/Kategorie/Reihenfolge des Originals uebernehmen.
  await uploads.registerUpload(newRel);
  await uploads.setDisplayName(newRel, t.name);
  if (t.overridden) await overlays.setCategory(newRel, t.category);
  try {
    const kw = templateSource.getKeywords()[orig];
    if (Array.isArray(kw) && kw.length) await uploads.addKeywords(newRel, kw);
  } catch (_) {}
  await pinOrderReplacing(t.category, orig, newRel);

  // 3) Original in den PAPIERKORB (weich, wiederherstellbar). NIEMALS hart geloescht.
  await overlays.hide(orig);

  return { newRel, estCost, sanitized };
}

function startBatch() {
  if (job && job.status === "running") return job; // laeuft schon: nicht doppelt starten
  job = {
    status: "running", total: 0, done: 0, swapped: 0, failed: 0, sanitized: 0,
    startedAt: Date.now(), finishedAt: null, current: null, estCost: 0, error: null, results: [],
  };
  const cur = job;
  Promise.resolve().then(async () => {
    if (!process.env.FAL_KEY) { cur.status = "done"; cur.finishedAt = Date.now(); cur.error = "FAL_KEY fehlt in der Umgebung"; log(cur.error); return; }
    // Fehlende Masse ergaenzen, damit die Zielmenge (2:3-nah) vollstaendig ist.
    try { await dimensions.compute(templates.listRaw().map((t) => t.file)); } catch (e) { log("Masse-Vorlauf: " + fehlerText(e)); }
    const targets = activeTargets();
    cur.total = targets.length;
    log("Start: " + targets.length + " Ziele (aktive 2:3-nah)");
    for (const t of targets) {
      if (cur.status !== "running") break;
      cur.current = t.name || t.file;
      try {
        const r = await processOne(t);
        cur.swapped++; cur.estCost = Math.round((cur.estCost + (r.estCost || 0)) * 100) / 100;
        if (r.sanitized) cur.sanitized++;
        cur.results.push({ file: t.file, name: t.name, ok: true, newFile: r.newRel, sanitized: !!r.sanitized });
        log("OK: " + t.file + " -> " + r.newRel + (r.sanitized ? " (nach Neukodierung)" : ""));
      } catch (e) {
        cur.failed++;
        cur.results.push({ file: t.file, name: t.name, ok: false, reason: fehlerText(e) });
        log("FEHLER: " + t.file + " -> " + fehlerText(e));
      }
      cur.done++;
    }
    cur.current = null; cur.status = "done"; cur.finishedAt = Date.now();
    log("Fertig: " + cur.swapped + " getauscht, " + cur.failed + " fehlgeschlagen");
  }).catch((e) => { cur.status = "done"; cur.finishedAt = Date.now(); cur.error = fehlerText(e); log("Abbruch: " + cur.error); });
  return job;
}

function batchStatus() {
  if (!job) return { status: "idle" };
  return {
    status: job.status, total: job.total, done: job.done, swapped: job.swapped, failed: job.failed,
    sanitized: job.sanitized, current: job.current, estCost: job.estCost, error: job.error,
    startedAt: job.startedAt, finishedAt: job.finishedAt,
    results: job.results.slice(-1000),
  };
}

module.exports = { startBatch, batchStatus, previewCount, activeTargets };
