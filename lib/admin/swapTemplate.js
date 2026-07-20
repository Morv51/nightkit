"use strict";

// GEMEINSAME Tausch-Funktion: ein neues Bild tritt an die Stelle eines bestehenden Templates.
//
// Die Mitnahme-Checkliste soll nur EINMAL existieren. Vorlage ist reformat916.processOne, das
// diesen Tausch ueber 114 Templates erprobt hat. Uebernommen wird von dort:
//   Anzeigename, Kategorie-Ueberschreibung, Schlagworte, Position in der Kategorie-Reihenfolge,
//   Original weich in den Papierkorb (NIE hart geloescht).
// ERGAENZT gegenueber processOne: das KATEGORIEBILD. War das Original das Aushaengeschild seiner
// Kategorie, wandert es mit — sonst faellt die Kategorie beim Tausch stillschweigend auf ihr
// Standardbild zurueck.
//
// Schritt A (jetzt): Redesign nutzt diese Funktion, reformat916 bleibt UNBERUEHRT.
// Schritt B (spaeter, einzeln): reformat916 auf diese Funktion umstellen, mit Nachweis, dass
// sich am Verhalten ausser dem Kategoriebild nichts aendert.

const sharp = require("sharp");
const templates = require("../templates");
const uploads = require("./uploads");
const overlays = require("./overlays");
const order = require("./order");
const categoryCover = require("./categoryCover");

const P = "[SWAP]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

function baseNoExt(file) { return String(file).split("/").pop().replace(/\.(jpe?g|png|webp)$/i, ""); }

// Effektive Sicht EINES Templates (wie manage/list und reformat916.effectiveList).
function effectiveOne(file) {
  const t = templates.listRaw().find((x) => x.file === file);
  if (!t) return null;
  const override = overlays.categoryOverrides().get(file) || null;
  return {
    file,
    name: uploads.namesMap().get(file) || t.name,
    folderCategory: t.category,          // Ordner/Pfad
    category: override || t.category,    // effektiv angezeigt
    overridden: !!override,
    hidden: overlays.hiddenSet().has(file),
  };
}

// Den Kandidaten an die exakte Position des Originals in der Kategorie-Reihenfolge setzen.
// Zeichengleich zu reformat916.pinOrderReplacing.
async function pinOrderReplacing(effCat, orig, newRel) {
  const cur = templates.list().filter((t) => t.category === effCat).map((t) => t.file);
  const withoutNew = cur.filter((f) => f !== newRel); // neu registrierte Datei aus ihrem Standard-Slot nehmen
  const idx = withoutNew.indexOf(orig);
  const seq = withoutNew.filter((f) => f !== orig);
  if (idx >= 0) seq.splice(idx, 0, newRel); else seq.push(newRel);
  await order.setOrder(effCat, seq);
}

// Freien Zielpfad im SELBEN Ordner finden (Suffix, bei Kollision durchnummeriert).
async function freeTarget(orig, folderCategory, suffix) {
  const stamm = folderCategory + "/" + baseNoExt(orig) + suffix;
  for (let i = 0; i < 20; i++) {
    const rel = stamm + (i ? "-" + (i + 1) : "") + ".jpg";
    if (!(await uploads.keyExists("templates/" + rel))) return rel;
  }
  throw new Error("Kein freier Zielname fuer " + orig);
}

// EIN Tausch. imageBuffer sind die Bytes des Kandidaten.
// -> { newRel, name, category, coverMoved }
async function swapTemplate({ origFile, imageBuffer, suffix = "-redesign" }) {
  const orig = String(origFile || "").trim();
  if (!orig) throw Object.assign(new Error("origFile fehlt"), { status: 400 });
  if (!imageBuffer || !imageBuffer.length) throw Object.assign(new Error("Bild fehlt"), { status: 400 });
  const t = effectiveOne(orig);
  if (!t) throw Object.assign(new Error("Original nicht gefunden: " + orig), { status: 404 });

  // 1) Kandidat als JPEG + Thumbnail schreiben (gleiche Pipeline wie uploadTemplate/reformat916).
  const newRel = await freeTarget(orig, t.folderCategory, suffix);
  const newKey = "templates/" + newRel;
  const thumbKey = "thumbnails/" + newRel.replace(/\.jpe?g$/i, ".webp");
  const jpg = await sharp(imageBuffer).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
  const thumb = await sharp(imageBuffer).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
  await uploads.putObject(newKey, jpg, "image/jpeg");
  await uploads.putObject(thumbKey, thumb, "image/webp");

  // 2) Registrieren + Metadaten des Originals uebernehmen.
  await uploads.registerUpload(newRel);
  await uploads.setDisplayName(newRel, t.name);
  if (t.overridden) await overlays.setCategory(newRel, t.category);
  try {
    const kw = require("../templateSource").getKeywords()[orig];
    if (Array.isArray(kw) && kw.length) await uploads.addKeywords(newRel, kw);
  } catch (e) { log("Schlagworte nicht uebernommen (" + orig + "): " + (e && e.message ? e.message : e)); }

  // 3) Position des Originals uebernehmen.
  await pinOrderReplacing(t.category, orig, newRel);

  // 4) NEU gegenueber processOne: Kategoriebild mitziehen, falls das Original eines war.
  let coverMoved = false;
  try {
    if (categoryCover.coverMap().get(t.category) === orig) {
      await categoryCover.setCover(t.category, newRel);
      coverMoved = true;
    }
  } catch (e) { log("Kategoriebild nicht mitgezogen (" + orig + "): " + (e && e.message ? e.message : e)); }

  // 5) Original in den PAPIERKORB (weich, wiederherstellbar). NIEMALS hart geloescht.
  await overlays.hide(orig);

  log("getauscht: " + orig + " -> " + newRel + (coverMoved ? " (inkl. Kategoriebild)" : ""));
  return { newRel, name: t.name, category: t.category, coverMoved };
}

module.exports = { swapTemplate, pinOrderReplacing, effectiveOne };
