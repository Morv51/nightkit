"use strict";

// Optimierte Vorschau-Thumbnails für die Template-Galerie. Statt die vollen
// Bilder (~0,3–3 MB) zu laden, liefert /api/thumb kleine WebP-Bilder (~15–40 KB)
// fürs Grid. Volle Auflösung nur in der Großansicht (direkt aus /templates/…).
//
// On-the-fly per sharp, im RAM gecacht (ein Template ändert sich praktisch nie).
// Nach einem Neustart/Deploy wird der Cache bei Bedarf neu aufgebaut. Nur die von
// templates.loadBuffer() freigegebenen Dateien werden gelesen (Pfad-Sicherheit +
// „nur entdeckte Templates" gelten weiter) — kein beliebiger Datei-Zugriff.

const sharp = require("sharp");
const templates = require("./templates");

const cache = new Map();          // "file@w" -> Buffer (JPEG)
const MAX_ENTRIES = 1500;         // grober Deckel; bei Überlauf komplett leeren
const ALLOWED_W = [180, 360, 720]; // feste Breiten — keine beliebigen Größen (Missbrauch/Speicher)
const DEFAULT_W = 360;

function normWidth(w) {
  const n = parseInt(w, 10);
  return ALLOWED_W.includes(n) ? n : DEFAULT_W;
}

// file = relativer Template-Pfad „Kategorie/datei.jpg". Wirft bei ungültig/unbekannt
// (über templates.loadBuffer). Gibt einen JPEG-Buffer der gewünschten Breite zurück.
async function getThumb(file, width) {
  const w = normWidth(width);
  const key = file + "@" + w;
  const hit = cache.get(key);
  if (hit) return hit;
  // Quellbytes über die zentrale Lese-Schicht (Repo-Standard, R2 nur wenn
  // TEMPLATE_SOURCE="r2"; mit Repo-Rückfall). Lazy require gegen Modul-Zyklen.
  const srcBuf = await require("./templateSource").getTemplateFile(file);
  const out = await sharp(srcBuf)
    .rotate()                                   // EXIF-Ausrichtung berücksichtigen
    .resize({ width: w, withoutEnlargement: true })
    .webp({ quality: 72 }) // WebP: ~15–25% kleiner als JPEG bei gleicher Qualität, schärfer
    .toBuffer();
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, out);
  return out;
}

module.exports = { getThumb, normWidth, ALLOWED_W, DEFAULT_W };
