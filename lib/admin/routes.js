"use strict";

// Admin-Bestandsverwaltung (additiv, isoliert). Ausschliesslich Anzeige-Overlays,
// NIEMALS Bytes. Doppelt geschuetzt: der Schalter ADMIN_TOOLS=1 muss gesetzt sein
// UND jeder schreibende Endpunkt prueft serverseitig den Admin-Code (dasselbe Token
// wie das Studio, ADMIN_CODES). Ist ADMIN_TOOLS nicht "1", existieren diese Routen
// praktisch nicht (404) und die App verhaelt sich exakt wie heute.
//
// Wird additiv aus server.js gemountet via register(router). Bestehende Routen,
// der edit-Flow und die Auto-Flows werden nicht angefasst.

const crypto = require("crypto");
const sharp = require("sharp");
const { readJson, sendJson, sendError } = require("../http");
const admin = require("../studio/adminAuth"); // gleicher Code-/Token-Mechanismus
const templates = require("../templates");     // read-only: listRaw()/list()
const overlays = require("./overlays");
const uploads = require("./uploads");           // Discovery-Registry + Anzeigename-Overlay
const order = require("./order");                // Reihenfolge-Overlay pro Kategorie
const categoryCover = require("./categoryCover"); // Aushaengeschild pro Kategorie
const dimensions = require("./dimensions");       // Format-/Masse-Analyse (nur Anzeige, gecacht)
const usage = require("./usage");                // Nutzungs-Zähler + Richtpreise (nachrangig)
const vision = require("../studio/vision");      // bestehende Verschlagwortung (tagFlyer)
const templateSource = require("../templateSource"); // nur nutzen: primeKeywords()

const UPLOAD_LIMIT = 25 * 1024 * 1024; // Base64-Bild pro Upload-Request

function toolsOn() { return process.env.ADMIN_TOOLS === "1"; }

// 401-Guard fuer die Aktions-Endpunkte. true = Token ok.
function ok(req, res) {
  if (admin.requireAdmin(req)) return true;
  sendError(res, 401, "Admin-Token fehlt oder ist ungueltig");
  return false;
}

async function body(req, res, limit = 1 * 1024 * 1024) {
  try { return await readJson(req, { limit }); }
  catch (e) { sendError(res, e.status || 400, e.message); return null; }
}

function fileOf(b) { return b && typeof b.file === "string" ? b.file : ""; }
function isKnown(file) { return templates.listRaw().some((t) => t.file === file); }

// Kategorie -> sauberer Slug (klein, a-z0-9-, Umlaute zu ae/oe/ue/ss). Nur fuer den
// LESBAREN Praefix des technischen Namens; der R2-Pfad nutzt die echte Kategorie.
function slugify(s) {
  return String(s || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "flyer";
}
function ymd() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}
function parseImage(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) return null;
  const buffer = Buffer.from(m[2], "base64");
  if (!buffer.length || buffer.length > 15 * 1024 * 1024) return null; // 15 MB pro Datei
  return buffer;
}
// Naechster freier Standard-Anzeigename "<Kategorie> <n>" (n = hoechste vorhandene
// Nummer in dieser Kategorie + 1). Beruecksichtigt die Overlays (effektive Liste).
function nextName(category) {
  const cat = String(category || "").trim();
  const esc = cat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^" + esc + "\\s+(\\d+)$", "i");
  let max = 0;
  for (const t of templates.list()) {
    if (t.category !== cat) continue;
    const mm = re.exec(t.name || "");
    if (mm) max = Math.max(max, parseInt(mm[1], 10));
  }
  return cat + " " + (max + 1);
}

function register(router) {
  // ── Alter Standalone-Pfad. Die Verwaltung ist jetzt ein Tab im Template Studio.
  //    Wir leiten dauerhaft dorthin um, damit alte Links/Lesezeichen nicht brechen. ──
  router.get("/admin/manage", async (req, res) => {
    res.setHeader("Location", "/admin/template-studio#manage");
    res.setHeader("Cache-Control", "no-cache");
    res.writeHead(302);
    res.end();
    return true;
  });

  // ── Daten: ALLE Templates mit Status (admin-gated). Fuer Verwaltung + Papierkorb. ──
  router.get("/admin/manage/list", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const hidden = overlays.hiddenSet();
    const overrides = overlays.categoryOverrides();
    const names = uploads.namesMap();
    const built = templates.listRaw().map((t) => {
      const override = overrides.get(t.file) || null;
      return {
        file: t.file,
        name: names.get(t.file) || t.name,      // Anzeigename-Overlay hat Vorrang
        folderCategory: t.category,             // Kategorie aus dem Ordner/Pfad
        category: override || t.category,       // effektiv angezeigte Kategorie
        overridden: !!override,
        hidden: hidden.has(t.file),
        thumb: "/api/thumb?w=360&file=" + encodeURIComponent(t.file),
        // Format-/Masse-Status aus dem Cache (null = noch nicht berechnet). Nur Anzeige.
        dims: dimensions.info(t.file),
      };
    });
    // Dieselbe Reihenfolge wie die Haupt-App (Reihenfolge-Overlay pro Kategorie).
    const all = order.applyOrder(built, order.orderMap());
    // Aktive Kategorien = die der SICHTBAREN Templates (leere verschwinden von selbst).
    const activeCats = [];
    for (const t of all) if (!t.hidden && !activeCats.includes(t.category)) activeCats.push(t.category);
    activeCats.sort((a, b) => a.localeCompare(b, "de"));
    sendJson(res, 200, {
      templates: all,
      categories: activeCats,
      counts: { total: all.length, hidden: all.filter((t) => t.hidden).length },
      // Aushaengeschild je Kategorie (nur gueltige: sichtbar + in dieser Kategorie).
      categoryCovers: categoryCover.resolveCovers(all),
      // Format-Zaehlung ueber die AKTIVEN Templates OHNE Papierkorb (dieselbe Grundmenge
      // wie Verwaltung + Kategorie-Uebersicht), damit die Gesamtzahl uebereinstimmt.
      dimsSummary: dimensions.summary(all.filter((t) => !t.hidden).map((t) => t.file)),
    });
    return true;
  });

  // ── Weiches Loeschen: ins Papierkorb-Overlay, Bytes bleiben unangetastet. ──
  router.post("/admin/manage/hide", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const file = fileOf(b);
    if (!isKnown(file)) return sendError(res, 400, "Unbekanntes Template");
    try { await overlays.hide(file); sendJson(res, 200, { file, hidden: true }); }
    catch (e) { sendError(res, 502, "Konnte nicht speichern: " + e.message); }
    return true;
  });

  // ── Wiederherstellen aus dem Papierkorb. ──
  router.post("/admin/manage/restore", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const file = fileOf(b);
    if (!isKnown(file)) return sendError(res, 400, "Unbekanntes Template");
    try { await overlays.unhide(file); sendJson(res, 200, { file, hidden: false }); }
    catch (e) { sendError(res, 502, "Konnte nicht speichern: " + e.message); }
    return true;
  });

  // ── Verschieben: reine Kategorie-Ueberschreibung. Leere Kategorie -> zurueck zum
  //    Ordnernamen. Keine Datei wird kopiert, kein Keyword-Schluessel geaendert. ──
  router.post("/admin/manage/move", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const file = fileOf(b);
    if (!isKnown(file)) return sendError(res, 400, "Unbekanntes Template");
    const category = typeof b.category === "string" ? b.category : "";
    try { await overlays.setCategory(file, category); sendJson(res, 200, { file, category: category.trim() }); }
    catch (e) { sendError(res, 502, "Konnte nicht speichern: " + e.message); }
    return true;
  });

  // ── Anzeigenamen aendern (Anzeigename-Overlay). Leer -> zurueck zu templates.json/
  //    Dateiname. Pfad + Keyword-Schluessel + Bytes bleiben unberuehrt. ──
  router.post("/admin/manage/name", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const file = fileOf(b);
    if (!isKnown(file)) return sendError(res, 400, "Unbekanntes Template");
    const name = typeof b.name === "string" ? b.name : "";
    try { await uploads.setDisplayName(file, name); sendJson(res, 200, { file, name: name.trim() }); }
    catch (e) { sendError(res, 502, "Konnte nicht speichern: " + e.message); }
    return true;
  });

  // ── Upload EINES neuen Templates. Der Client ruft dies pro Datei nacheinander auf
  //    (klarer Status je Datei, ein Fehlschlag bricht den Gesamt-Upload nicht ab).
  //    Legt NUR Neues an: technischer Name -> Original (JPEG) + Thumbnail (WebP) nach
  //    R2 -> Discovery-Registry -> Standard-Anzeigename -> optional Tags (Sonnet). ──
  router.post("/admin/upload", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res, UPLOAD_LIMIT); if (!b) return true;

    const category = typeof b.category === "string" ? b.category.replace(/\s+/g, " ").trim() : "";
    if (!category) return sendError(res, 400, "Kategorie fehlt");
    if (category.startsWith("_") || category.includes("/") || category.includes("\\") || category.length > 60)
      return sendError(res, 400, "Ungueltige Kategorie");
    const src = parseImage(b.image);
    if (!src) return sendError(res, 400, "Bild fehlt oder ungueltig (jpg/jpeg/png/webp, max 15 MB)");
    const autoTag = b.autoTag !== false; // Standard an

    try {
      // 1. Eindeutiger technischer Name (Kategorie-Slug + Datum + Zufall), per
      //    R2-Existenzpruefung garantiert eindeutig (auch bei Mehrfach-Upload).
      let rel = "", origKey = "";
      for (let i = 0; i < 8 && !rel; i++) {
        const tech = slugify(category) + "-" + ymd() + "-" + crypto.randomBytes(3).toString("hex") + ".jpg";
        const cand = category + "/" + tech;
        if (!(await uploads.keyExists("templates/" + cand))) { rel = cand; origKey = "templates/" + cand; }
      }
      if (!rel) return sendError(res, 500, "Konnte keinen eindeutigen Namen finden");

      // 2. Original vereinheitlichen zu JPEG (q92, EXIF-Rotation, Alpha auf Weiss),
      //    Thumbnail als WebP 360 (gleiche Pipeline wie lib/thumbs.js).
      const original = await sharp(src).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
      const thumb = await sharp(src).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
      const thumbKey = "thumbnails/" + rel.replace(/\.(jpe?g|png)$/i, ".webp");

      // 3. Bytes nach R2 (Kategorie-Praefix wie bei den 206).
      await uploads.putObject(origKey, original, "image/jpeg");
      await uploads.putObject(thumbKey, thumb, "image/webp");

      // 4. Standard-Anzeigename (vor dem Registrieren berechnet) + Discovery-Registry.
      const name = nextName(category);
      await uploads.registerUpload(rel);
      await uploads.setDisplayName(rel, name);

      // 5. Tags optional (Sonnet). Fehlschlag bricht NICHT ab -> ohne Tags anlegen.
      let tags = [], tagError = null;
      if (autoTag) {
        if (!vision.isConfigured()) tagError = "ANTHROPIC_API_KEY nicht gesetzt";
        else {
          try {
            tags = await vision.tagFlyer({ imageBase64: original.toString("base64"), mediaType: "image/jpeg", model: "sonnet" });
            await uploads.addKeywords(rel, tags);
          } catch (e) { tagError = e.message || "Tag-Fehler"; tags = []; }
        }
      }
      // Lese-Schicht neu vorwaermen, damit Keywords sofort in App + Verwaltung wirken.
      try { await templateSource.primeKeywords(); } catch (_) {}

      sendJson(res, 200, {
        ok: true, file: rel, name, category,
        thumb: "/api/thumb?w=360&file=" + encodeURIComponent(rel),
        tags, tagged: autoTag && !tagError, tagError,
      });
    } catch (e) {
      sendError(res, 502, "Upload fehlgeschlagen: " + (e && e.message ? e.message : e));
    }
    return true;
  });

  // ── Reihenfolge einer Kategorie setzen. order = geordnete Liste der Template-Pfade.
  //    Nur Anzeige, keine Bytes. Leere Liste -> Reihenfolge fuer die Kategorie zuruecksetzen. ──
  router.post("/admin/manage/order", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const category = typeof b.category === "string" ? b.category.replace(/\s+/g, " ").trim() : "";
    if (!category) return sendError(res, 400, "Kategorie fehlt");
    const seq = Array.isArray(b.order) ? b.order.filter((p) => typeof p === "string") : [];
    // Nur echte Template-Pfade zulassen (kein Muell in die Datei).
    const known = new Set(templates.listRaw().map((t) => t.file));
    const clean = seq.filter((p) => known.has(p));
    try { await order.setOrder(category, clean); sendJson(res, 200, { category, count: clean.length }); }
    catch (e) { sendError(res, 502, "Konnte Reihenfolge nicht speichern: " + e.message); }
    return true;
  });

  // ── Reihenfolge einer Kategorie zuruecksetzen (Standardsortierung gilt wieder). ──
  router.post("/admin/manage/order/reset", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const category = typeof b.category === "string" ? b.category.replace(/\s+/g, " ").trim() : "";
    if (!category) return sendError(res, 400, "Kategorie fehlt");
    try { await order.clearOrder(category); sendJson(res, 200, { category, reset: true }); }
    catch (e) { sendError(res, 502, "Konnte Reihenfolge nicht zuruecksetzen: " + e.message); }
    return true;
  });

  // ── Aushaengeschild (Kategoriebild) setzen. Nur Anzeige, keine Bytes. Das Template
  //    muss existieren, SICHTBAR sein (kein ausgeblendetes) und in genau dieser
  //    (effektiven) Kategorie liegen — so kann ein verschobenes Template Cover seiner
  //    NEUEN Kategorie werden, ein ausgeblendetes aber nie. ──
  router.post("/admin/manage/cover", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const file = fileOf(b);
    const category = typeof b.category === "string" ? b.category.replace(/\s+/g, " ").trim() : "";
    if (!category) return sendError(res, 400, "Kategorie fehlt");
    if (!isKnown(file)) return sendError(res, 400, "Unbekanntes Template");
    if (overlays.hiddenSet().has(file)) return sendError(res, 400, "Ausgeblendetes Template kann kein Kategoriebild sein");
    const base = templates.listRaw().find((t) => t.file === file);
    const effCat = (overlays.categoryOverrides().get(file) || (base && base.category)) || "";
    if (effCat !== category) return sendError(res, 400, "Template gehoert nicht zu dieser Kategorie");
    try { await categoryCover.setCover(category, file); sendJson(res, 200, { category, file }); }
    catch (e) { sendError(res, 502, "Konnte Kategoriebild nicht speichern: " + e.message); }
    return true;
  });

  // ── Aushaengeschild einer Kategorie zuruecksetzen (App waehlt wieder automatisch). ──
  router.post("/admin/manage/cover/reset", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const category = typeof b.category === "string" ? b.category.replace(/\s+/g, " ").trim() : "";
    if (!category) return sendError(res, 400, "Kategorie fehlt");
    try { await categoryCover.clearCover(category); sendJson(res, 200, { category, reset: true }); }
    catch (e) { sendError(res, 502, "Konnte Kategoriebild nicht zuruecksetzen: " + e.message); }
    return true;
  });

  // ── Format-Analyse: Pixelmasse berechnen und in R2 cachen (reine ANZEIGE, aendert
  //    nichts). Standard ergaenzt nur FEHLENDE (neue Templates); body.force=true rechnet
  //    alles neu. Liest die Bilder nur ueber die Lese-Schicht (R2 mit Repo-Rueckfall).
  //    Zwischenstand wird gesichert, ein Wiederholen ueberspringt bereits Berechnetes. ──
  router.post("/admin/manage/dimensions/recompute", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const files = templates.listRaw().map((t) => t.file);
    try {
      const r = await dimensions.compute(files, { force: !!b.force });
      sendJson(res, 200, { ...r, summary: dimensions.summary(files) });
    } catch (e) { sendError(res, 502, "Konnte Formate nicht berechnen: " + e.message); }
    return true;
  });

  // ── Einmaliger, ISOLIERTER 9:16-Testlauf (Urban 91) per teurem fal-Modell. Nur Anzeige-
  //    Test, aendert keinen Dauerbetrieb und nicht lib/fal.js. Formt EIN 2:3-Template auf
  //    9:16 und legt es zusaetzlich in R2 ab (Original bleibt). Gibt das Ergebnis inkl.
  //    Ansicht-URLs zurueck. run() wirft nie und liefert { ok, error, view916, ... }. ──
  router.post("/admin/test-outpaint-916", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    try {
      const r = await require("../../test-outpaint-916").run(b.mode === "find" ? "find" : "run");
      sendJson(res, 200, r);
    } catch (e) { sendError(res, 502, "Testlauf fehlgeschlagen: " + (e && e.message ? e.message : e)); }
    return true;
  });

  // ── Nutzungs-Dashboard: Zähler + geschätzte Kosten (nur Anzeige, keine Kernfunktion). ──
  router.get("/admin/usage/data", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const snap = usage.snapshot();
    sendJson(res, 200, snap);
    return true;
  });

  // Richtpreis einer Aktion ändern (Kostenschätzung ist frei editierbar).
  router.post("/admin/usage/price", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const key = typeof b.key === "string" ? b.key : "";
    try { await usage.setPrice(key, b.price); sendJson(res, 200, usage.snapshot()); }
    catch (e) { sendError(res, 400, "Konnte Preis nicht setzen: " + e.message); }
    return true;
  });

  // Zähler zurücksetzen (alle auf 0, neuer Startzeitpunkt).
  router.post("/admin/usage/reset", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    try { await usage.reset(); sendJson(res, 200, usage.snapshot()); }
    catch (e) { sendError(res, 502, "Konnte nicht zurücksetzen: " + e.message); }
    return true;
  });

  // Hinweis: Ein endgueltiges Loeschen der Bytes gibt es hier BEWUSST NICHT. Das ist
  // ein spaeterer, deutlich getrennter Schritt. In der Oberflaeche steht dafuer nur
  // ein deaktivierter Platzhalter, es existiert kein Endpunkt, der Bytes entfernt.
}

module.exports = { register };
