"use strict";

// Template Studio — Admin-only Routen (additiv gemountet aus server.js via
// register(router)). Bestehende Routen/Funktionen werden nicht verändert; alles
// hier ist neu und liegt unter /admin/*. Bestehende Module werden nur lesend
// aufgerufen (ideogram.edit/download, replicate.removeObject, http-Helfer).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { readJson, sendJson, sendError } = require("../http");
const ideogram = require("../ideogram");        // read-only: edit(), download()
const replicate = require("../replicate");      // read-only: removeObject() (LaMa)
const fal = require("../fal");                   // read-only: outpaint() (FLUX.2 Pro)
const templates = require("../templates");      // read-only: TEMPLATES_DIR
const admin = require("./adminAuth");
const vision = require("./vision");
const promptBuilder = require("./promptBuilder");
const ideogramV3 = require("./ideogramV3");

const IDEOGRAM_KEY = process.env.IDEOGRAM_API_KEY || "";
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || "";
const FAL_KEY = process.env.FAL_KEY || "";
const PAGE = path.join(__dirname, "..", "..", "public", "admin", "template-studio.html");
const IMG_LIMIT = 25 * 1024 * 1024; // großzügig für Base64-Bilder (wie /api/remove)

// data:image/...;base64,... → { buffer, base64, mediaType }; null wenn ungültig.
function parseDataUrl(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buffer = Buffer.from(m[2], "base64");
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) return null; // Ideogram-Limit 10MB
  return { buffer, base64: m[2], mediaType: m[1] };
}

// 401-Guard für alle kostenpflichtigen Endpoints. true = Token ok.
function ok(req, res) {
  if (admin.requireAdmin(req)) return true;
  sendError(res, 401, "Admin-Token fehlt oder ist ungültig");
  return false;
}

async function body(req, res) {
  try { return await readJson(req, { limit: IMG_LIMIT }); }
  catch (e) { sendError(res, e.status || 400, e.message); return null; }
}

function register(router) {
  // ── Seite (öffentlich; enthält nur die Gate-UI, keine Secrets/Kosten) ──
  router.get("/admin/template-studio", async (req, res) => {
    try {
      const html = await fs.promises.readFile(PAGE, "utf8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.writeHead(200);
      res.end(html);
    } catch {
      sendError(res, 404, "Template Studio nicht gefunden");
    }
    return true;
  });

  // ── Code-Gate: prüft den Code serverseitig gegen ADMIN_CODES (Env), gibt
  //    bei Erfolg das signierte Token zurück. Codes nur aus Env, kein Default. ──
  router.post("/admin/auth", async (req, res) => {
    const b = await body(req, res);
    if (!b) return true;
    const label = admin.matchCode(b.code);
    if (!label) return sendError(res, 401, "Falscher Code");
    console.log(`[studio-auth] login ok: ${label}`);
    sendJson(res, 200, { token: admin.issueToken() });
    return true;
  });

  // ── Vision-Analyse (Modus 2: Moodboard → Stil-DNA + Default-Prompt) ──
  router.post("/admin/analyze", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    const pic = parseDataUrl(b.image);
    if (!pic) return sendError(res, 400, "Bild fehlt oder ist ungültig (PNG/JPEG/WebP, ≤10MB)");
    if (!vision.isConfigured()) return sendError(res, 500, "ANTHROPIC_API_KEY not configured");

    try {
      if ((b.mode || "moodboard") === "moodboard") {
        const dna = await vision.analyzeMoodboard({ imageBase64: pic.base64, mediaType: pic.mediaType, model: b.model });
        const prompt = promptBuilder.buildMoodboardPrompt(dna, { styleAdherence: b.styleAdherence });
        return sendJson(res, 200, { dna, prompt });
      }
      if (b.mode === "flyer") {
        const zones = await vision.analyzeFlyer({ imageBase64: pic.base64, mediaType: pic.mediaType, model: b.model });
        const prompt = promptBuilder.buildPlaceholderPrompt(zones);
        return sendJson(res, 200, { zones, prompt });
      }
      return sendError(res, 400, "Unbekannter Analyse-Modus");
    } catch (e) {
      console.error("studio analyze error:", e.message);
      return sendError(res, 502, "Analyse fehlgeschlagen: " + e.message);
    }
  });

  // ── Prompt aus vorhandener DNA neu bauen (frei, kein externer Call) ──
  router.post("/admin/build-prompt", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    const prompt = promptBuilder.buildMoodboardPrompt(b.dna || {}, { styleAdherence: b.styleAdherence, time: b.time });
    return sendJson(res, 200, { prompt });
  });

  // ── Platzhalter-Prompt aus Zonen neu bauen (frei; bei Rollenwechsel) ──
  router.post("/admin/build-placeholder-prompt", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    return sendJson(res, 200, { prompt: promptBuilder.buildPlaceholderPrompt(b.zones || []) });
  });

  // ── Schritt 1a (Modus 1): Format-Normalisierung auf 9:16 via FAL Outpaint ──
  // Erweitert den Flyer VERLUSTFREI (kein Crop/Scale) auf 9:16. Die Expansions-
  // Pixel je Seite kommen vom Frontend (kennt die Bildmaße). Outpaint OHNE
  // Prompt führt Hintergrund/Stil fort und fügt keine neuen Objekte/Texte ein.
  router.post("/admin/normalize", async (req, res) => {
    if (!ok(req, res)) return true;
    if (!FAL_KEY) return sendError(res, 500, "FAL_KEY not configured");
    const b = await body(req, res);
    if (!b) return true;
    if (!parseDataUrl(b.image)) return sendError(res, 400, "Bild fehlt oder ist ungültig");
    const clamp = (n) => { const v = Math.round(Number(n) || 0); return v > 0 && v <= 8000 ? v : 0; };
    const exp = { top: clamp(b.top), bottom: clamp(b.bottom), left: clamp(b.left), right: clamp(b.right) };
    if (exp.top + exp.bottom + exp.left + exp.right === 0) return sendError(res, 400, "Keine Erweiterung angefordert");
    try {
      const { url } = await fal.outpaint({
        imageDataUrl: b.image,
        top: exp.top, bottom: exp.bottom, left: exp.left, right: exp.right,
        outputFormat: "png",
      });
      const dl = await ideogram.download(url);
      return sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}` });
    } catch (e) {
      console.error("studio normalize error:", e.message);
      return sendError(res, 502, "9:16-Erweiterung fehlgeschlagen: " + e.message);
    }
  });

  // ── Generieren (Modus 2: V3 + Moodboard als Style-Reference) ──
  router.post("/admin/generate", async (req, res) => {
    if (!ok(req, res)) return true;
    if (!IDEOGRAM_KEY) return sendError(res, 500, "IDEOGRAM_API_KEY not configured");
    const b = await body(req, res);
    if (!b) return true;
    if (!b.prompt) return sendError(res, 400, "Prompt fehlt");
    const ref = parseDataUrl(b.styleImage);
    if (!ref) return sendError(res, 400, "Moodboard fehlt oder ist ungültig");

    try {
      const { url } = await ideogramV3.generateWithStyleRef({
        apiKey: IDEOGRAM_KEY,
        prompt: b.prompt,
        styleRefBuffers: [ref.buffer],
        styleRefType: ref.mediaType,
      });
      const dl = await ideogram.download(url);
      return sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}` });
    } catch (e) {
      console.error("studio generate error:", e.message, e.response || "");
      return sendError(res, 502, "Generierung fehlgeschlagen: " + e.message);
    }
  });

  // ── Platzhalter einsetzen / Korrigieren (bestehendes edit()) — Modus 1/beide ──
  router.post("/admin/edit", async (req, res) => {
    if (!ok(req, res)) return true;
    if (!IDEOGRAM_KEY) return sendError(res, 500, "IDEOGRAM_API_KEY not configured");
    const b = await body(req, res);
    if (!b) return true;
    if (!b.prompt) return sendError(res, 400, "Prompt fehlt");
    const pic = parseDataUrl(b.image);
    if (!pic) return sendError(res, 400, "Bild fehlt oder ist ungültig");
    try {
      // Bestehender edit()-Flow, unverändert: Bild als Basis, magic_prompt OFF (Default).
      const { url } = await ideogram.edit({ apiKey: IDEOGRAM_KEY, prompt: b.prompt, imageBuffer: pic.buffer });
      const dl = await ideogram.download(url);
      return sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}` });
    } catch (e) {
      console.error("studio edit error:", e.message, e.response || "");
      return sendError(res, 502, "Bearbeitung fehlgeschlagen: " + e.message);
    }
  });

  // ── Bereinigen (bestehendes LaMa-Removal via Replicate) — beide Modi ──
  router.post("/admin/remove", async (req, res) => {
    if (!ok(req, res)) return true;
    if (!REPLICATE_TOKEN) return sendError(res, 500, "REPLICATE_API_TOKEN not configured");
    const b = await body(req, res);
    if (!b) return true;
    if (!parseDataUrl(b.image)) return sendError(res, 400, "Bild fehlt oder ist ungültig");
    if (!parseDataUrl(b.mask)) return sendError(res, 400, "Maske fehlt oder ist ungültig");
    try {
      // Bestehender LaMa-Flow, unverändert (Maske WEISS = entfernen).
      const { url } = await replicate.removeObject({
        token: REPLICATE_TOKEN,
        imageDataUrl: b.image,
        maskDataUrl: b.mask,
      });
      const dl = await ideogram.download(url);
      return sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}` });
    } catch (e) {
      console.error("studio remove error:", e.message);
      return sendError(res, 502, "Bereinigen fehlgeschlagen: " + e.message);
    }
  });

  // ── Optionales Speichern in die Galerie (ADDITIV) ──
  // Schreibt das Bild nach /templates/, legt Sidecar-Metadaten an und hängt
  // einen Manifest-Eintrag (Kategorie "Studio") an — der bestehende Galerie-
  // Flow wird nur ergänzt, nicht verändert. ACHTUNG: Render-FS ist ephemer →
  // geht beim nächsten Deploy verloren (Caveat ans Frontend zurückgegeben).
  router.post("/admin/save", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    const pic = parseDataUrl(b.image);
    if (!pic) return sendError(res, 400, "Bild fehlt oder ist ungültig");

    const id = "studio-" + crypto.randomBytes(5).toString("hex");
    const ext = pic.mediaType === "image/jpeg" ? "jpeg" : pic.mediaType === "image/webp" ? "webp" : "png";
    const file = id + "." + ext;
    const name = (typeof b.name === "string" && b.name.trim()) || ("Studio " + id.slice(-4));
    const dir = templates.TEMPLATES_DIR;

    try {
      await fs.promises.writeFile(path.join(dir, file), pic.buffer);

      // Sidecar-Metadaten (verändert templates.json nicht).
      const metaDir = path.join(dir, "studio-meta");
      await fs.promises.mkdir(metaDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(metaDir, id + ".json"),
        JSON.stringify({
          file, name, mode: b.mode || null, prompt: b.prompt || null,
          dna: b.dna || null, zones: b.zones || null, styleAdherence: b.styleAdherence ?? null,
          createdAt: new Date().toISOString(),
        }, null, 2)
      );

      // Manifest additiv erweitern (bestehende Einträge bleiben unangetastet).
      // Kompaktes Zeilenformat wie das Original beibehalten → Diff = nur eine
      // neue Zeile pro Save, nicht die ganze Datei umformatiert.
      const manifestPath = path.join(dir, "templates.json");
      let arr = [];
      try { arr = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")); } catch {}
      if (Array.isArray(arr)) {
        arr.push({ file, name, category: "Studio" });
        // Exaktes Original-Format: { "k": v, "k2": v2 } mit Leerzeichen, ein
        // Eintrag pro Zeile → bestehende Zeilen bleiben byte-identisch.
        const fmtEntry = (e) =>
          "  { " + Object.entries(e).map(([k, val]) => JSON.stringify(k) + ": " + JSON.stringify(val)).join(", ") + " }";
        const text = "[\n" + arr.map(fmtEntry).join(",\n") + "\n]\n";
        await fs.promises.writeFile(manifestPath, text);
      }

      return sendJson(res, 200, {
        file, name,
        warning: "Gespeichert. Hinweis: Auf Render geht das beim nächsten Deploy verloren — für dauerhaft den Export nutzen und committen.",
      });
    } catch (e) {
      console.error("studio save error:", e.message);
      return sendError(res, 500, "Speichern fehlgeschlagen: " + e.message);
    }
  });
}

function notReady(res) {
  sendError(res, 501, "Noch nicht implementiert");
  return true;
}

module.exports = { register };
