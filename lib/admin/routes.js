"use strict";

// Admin-Bestandsverwaltung (additiv, isoliert). Ausschliesslich Anzeige-Overlays,
// NIEMALS Bytes. Doppelt geschuetzt: der Schalter ADMIN_TOOLS=1 muss gesetzt sein
// UND jeder schreibende Endpunkt prueft serverseitig den Admin-Code (dasselbe Token
// wie das Studio, ADMIN_CODES). Ist ADMIN_TOOLS nicht "1", existieren diese Routen
// praktisch nicht (404) und die App verhaelt sich exakt wie heute.
//
// Wird additiv aus server.js gemountet via register(router). Bestehende Routen,
// der edit-Flow und die Auto-Flows werden nicht angefasst.

const { readJson, sendJson, sendError } = require("../http");
const admin = require("../studio/adminAuth"); // gleicher Code-/Token-Mechanismus
const templates = require("../templates");     // read-only: listRaw()
const overlays = require("./overlays");

function toolsOn() { return process.env.ADMIN_TOOLS === "1"; }

// 401-Guard fuer die Aktions-Endpunkte. true = Token ok.
function ok(req, res) {
  if (admin.requireAdmin(req)) return true;
  sendError(res, 401, "Admin-Token fehlt oder ist ungueltig");
  return false;
}

async function body(req, res) {
  try { return await readJson(req, { limit: 1 * 1024 * 1024 }); }
  catch (e) { sendError(res, e.status || 400, e.message); return null; }
}

function fileOf(b) { return b && typeof b.file === "string" ? b.file : ""; }
function isKnown(file) { return templates.listRaw().some((t) => t.file === file); }

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
    const all = templates.listRaw().map((t) => {
      const override = overrides.get(t.file) || null;
      return {
        file: t.file,
        name: t.name,
        folderCategory: t.category,             // Kategorie aus dem Ordner
        category: override || t.category,       // effektiv angezeigte Kategorie
        overridden: !!override,
        hidden: hidden.has(t.file),
        thumb: "/api/thumb?w=360&file=" + encodeURIComponent(t.file),
      };
    });
    // Aktive Kategorien = die der SICHTBAREN Templates (leere verschwinden von selbst).
    const activeCats = [];
    for (const t of all) if (!t.hidden && !activeCats.includes(t.category)) activeCats.push(t.category);
    activeCats.sort((a, b) => a.localeCompare(b, "de"));
    sendJson(res, 200, {
      templates: all,
      categories: activeCats,
      counts: { total: all.length, hidden: all.filter((t) => t.hidden).length },
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

  // Hinweis: Ein endgueltiges Loeschen der Bytes gibt es hier BEWUSST NICHT. Das ist
  // ein spaeterer, deutlich getrennter Schritt. In der Oberflaeche steht dafuer nur
  // ein deaktivierter Platzhalter, es existiert kein Endpunkt, der Bytes entfernt.
}

module.exports = { register };
