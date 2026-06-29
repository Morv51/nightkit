"use strict";

const http = require("http");
const path = require("path");

const { buildPrompt }       = require("./lib/prompt");
const { titleCaseSmart }    = require("./lib/casing");
const ideogram              = require("./lib/ideogram");
const replicate             = require("./lib/replicate");
const fal                   = require("./lib/fal");
const jobs                  = require("./lib/jobs");
const templates             = require("./lib/templates");
const { createServer: createStatic } = require("./lib/static");
const { proxy }             = require("./lib/proxy");
const { webmToMp4 }         = require("./lib/convert");
const { createRouter }      = require("./lib/router");
const auth                  = require("./lib/auth");
const caption               = require("./lib/caption");
const { readJson, readBody, sendJson, sendError, applyCors } = require("./lib/http");

const PORT            = process.env.PORT || 3000;
const IDEOGRAM_KEY    = process.env.IDEOGRAM_API_KEY || "";
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || "";
const FAL_KEY         = process.env.FAL_KEY || "";

const staticFiles = createStatic({
  roots: [
    { prefix: "/templates", dir: path.join(__dirname, "templates") },
    { prefix: "/",          dir: path.join(__dirname, "public") },
  ],
  rewrites: {
    "/":    "/landing.html",
    "/app": "/app.html",
  },
});

const router = createRouter();

// Admin-only "Template Studio" (additiv, isoliert) — mountet eigene /admin/*
// Routen. Verändert keine bestehende Route/Funktion. Siehe lib/studio/.
require("./lib/studio/routes").register(router);

router.post("/api/generate", async (req, res) => {
  if (!IDEOGRAM_KEY) return sendError(res, 500, "IDEOGRAM_API_KEY not configured");

  // Require a valid Supabase session when auth is configured. (In dev mode,
  // without service-role creds, auth.isConfigured() is false and this is
  // skipped — see lib/auth.js.)
  let user = null;
  if (auth.isConfigured()) {
    user = await auth.verifyToken(auth.bearer(req));
    if (!user) return sendError(res, 401, "Authentifizierung erforderlich");
  }

  let ev;
  try {
    ev = await readJson(req);
  } catch (e) {
    return sendError(res, e.status || 400, e.message);
  }

  if (!ev.name || !ev.date) {
    return sendError(res, 400, "Event name and date are required");
  }

  const file = ev.template;
  if (!file || !templates.has(file)) {
    return sendError(res, 400, "Unknown template");
  }

  const jobId = jobs.create();
  sendJson(res, 202, { jobId });

  // Count this generation against the user's profile (best-effort).
  if (user) auth.incrementGenerations(user.id);

  runIdeogramJob(jobId, ev, file).catch((e) => {
    console.error(`Job ${jobId} failed:`, e.message);
    jobs.set(jobId, { status: "error", error: e.message });
  });
});

// Decode a data URL into { buffer, mime }; null if invalid or not an image.
function parseDataUrl(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buffer = Buffer.from(m[2], "base64");
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) return null; // Ideogram limit: 10MB
  return { buffer, mime: m[1] };
}

// Sauberes Entfernen (LaMa via Replicate): die vom User markierten Flächen
// werden wirklich gelöscht und content-aware mit Hintergrund aufgefüllt,
// statt in der Lücke neuen Inhalt zu erfinden.
// Maskenkonvention (LaMa): WEISS = entfernen, SCHWARZ = behalten.
// Auth-geschützt wie /api/generate; ein erfolgreicher Lauf zählt als ein Call.
// Kosten: Replicate LaMa ca. 0,0005 USD pro Lauf.
router.post("/api/remove", async (req, res) => {
  if (!REPLICATE_TOKEN) return sendError(res, 500, "REPLICATE_API_TOKEN not configured");

  let user = null;
  if (auth.isConfigured()) {
    user = await auth.verifyToken(auth.bearer(req));
    if (!user) return sendError(res, 401, "Authentifizierung erforderlich");
  }

  let body;
  try {
    body = await readJson(req, { limit: 25 * 1024 * 1024 }); // flyer + mask as base64
  } catch (e) {
    return sendError(res, e.status || 400, e.message);
  }

  // Format/Größe validieren; an Replicate gehen die Data-URLs unverändert.
  const image = parseDataUrl(body.image);
  const mask  = parseDataUrl(body.mask);
  if (!image) return sendError(res, 400, "Flyer-Bild fehlt oder ist ungültig");
  if (!mask)  return sendError(res, 400, "Maske fehlt oder ist ungültig");

  try {
    const { url } = await replicate.removeObject({
      token: REPLICATE_TOKEN,
      imageDataUrl: body.image,
      maskDataUrl: body.mask,
    });
    const dl = await ideogram.download(url); // generischer Bild-Download (Buffer)
    sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}` });

    // Erfolgreiches Entfernen wie eine Generierung gegen das Konto werten.
    if (user) auth.incrementGenerations(user.id);
  } catch (e) {
    console.error("remove error:", e.message);
    sendError(res, 502, "Entfernen fehlgeschlagen: " + e.message);
  }
});

// Prompt für "Text anpassen" — grenzt die Änderung auf die markierte Zone ein
// und sichert exakte, vollständige Schreibweise. Eigener Prompt, NICHT der
// buildPrompt-Befüll-Prompt (der bleibt unangetastet).
function buildAdjustPrompt(text, area) {
  let where = "the marked area";
  if (area && Number.isFinite(area.x)) {
    const cy = area.y + (Number(area.h) || 0) / 2;
    const cx = area.x + (Number(area.w) || 0) / 2;
    const v = cy < 0.34 ? "upper" : cy > 0.66 ? "lower" : "middle";
    const h = cx < 0.34 ? "left" : cx > 0.66 ? "right" : "centre";
    where = `the marked area (the ${v} ${h} region of the flyer)`;
  }
  return [
    `Edit this flyer. In ${where} ONLY, render exactly this text: "${text}".`,
    "Correct spelling, EVERY letter present, no missing, dropped or swapped letters.",
    "Match the existing design at that spot exactly: same font, style, effect, colour, size and position as the text already there.",
    "Change NOTHING outside that area — keep the entire rest of the flyer identical (same background, photos, graphics, other texts, colours and layout).",
  ].join("\n");
}

// "Text anpassen": gezielte Nachkorrektur EINER markierten Zone im fertigen
// Flyer. NUTZT den bestehenden ideogram.edit()-Flow (maskenlos, magic_prompt
// OFF) — der Prompt grenzt auf die Zone ein; das Frontend kopiert danach NUR das
// markierte Rechteck zurück, sodass der Rest pixelgenau unverändert bleibt.
// Auth-geschützt wie /api/generate; ein erfolgreicher Lauf zählt als ein Call.
router.post("/api/adjust-text", async (req, res) => {
  if (!IDEOGRAM_KEY) return sendError(res, 500, "IDEOGRAM_API_KEY not configured");

  let user = null;
  if (auth.isConfigured()) {
    user = await auth.verifyToken(auth.bearer(req));
    if (!user) return sendError(res, 401, "Authentifizierung erforderlich");
  }

  let body;
  try {
    body = await readJson(req, { limit: 25 * 1024 * 1024 });
  } catch (e) {
    return sendError(res, e.status || 400, e.message);
  }

  const image = parseDataUrl(body.image);
  if (!image) return sendError(res, 400, "Flyer-Bild fehlt oder ist ungültig");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return sendError(res, 400, "Bitte den korrigierten Text eingeben");

  const prompt = buildAdjustPrompt(text, body.area);
  try {
    // Bestehender edit()-Flow, unverändert (magic_prompt OFF ist Default).
    const { url } = await ideogram.edit({ apiKey: IDEOGRAM_KEY, prompt, imageBuffer: image.buffer });
    const dl = await ideogram.download(url);
    sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}` });
    if (user) auth.incrementGenerations(user.id);
  } catch (e) {
    console.error("adjust-text error:", e.message, e.response || "");
    sendError(res, 502, "Text anpassen fehlgeschlagen: " + e.message);
  }
});

// Ziel-Seitenverhältnisse (Breite:Höhe) der abgeleiteten Formate. Beide sind
// breiter als das 9:16-Master ⇒ wir behalten die volle Höhe und erweitern nur
// links/rechts (kein vertikales Cropping, volles Hochformat bleibt erhalten).
const TARGET_RATIO = {
  feed:   4 / 5, // 4:5  (z.B. 1080×1920 → 1536×1920)
  square: 1 / 1, // 1:1  (z.B. 1080×1920 → 1920×1920)
};

// Pixel-Dimensionen aus einem PNG/JPEG/WebP-Buffer lesen (Header-Parsing, ohne
// externe Lib). Gibt { width, height } oder null.
function imageDimensions(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG: Signatur 0x89504E47, IHDR-Breite/Höhe als BE-UInt32 ab Byte 16.
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: ab 0xFFD8 die Segmente bis zu einem SOF-Marker durchlaufen.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      let marker = buf[o + 1];
      while (marker === 0xff && o + 2 < buf.length) { o++; marker = buf[o + 1]; }
      const len = buf.readUInt16BE(o + 2);
      // SOF0–SOF15 (außer DHT 0xC4 / JPG 0xC8 / DAC 0xCC) tragen die Maße.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) };
      }
      o += 2 + len;
    }
    return null;
  }
  // WebP (RIFF…WEBP): VP8 (lossy) / VP8L (lossless) / VP8X (extended).
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const fmt = buf.toString("ascii", 12, 16);
    if (fmt === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === "VP8L") { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    if (fmt === "VP8X") return { width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1, height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1 };
  }
  return null;
}

// Multi-Format-Export: erweitert das fertige 9:16-Master per FAL FLUX.2 Pro
// Outpaint auf ein anderes Seitenverhältnis (die KI füllt die neuen Rand-
// flächen, kein hartes Cropping). Auth-geschützt wie /api/generate. Das Master
// geht als data:-URL an FAL (image_url); danach legt das Frontend optional
// einen Shadow-Falloff über die erweiterten Ränder.
// Kosten: ca. 0,04–0,05 USD pro Bild (FAL FLUX.2 Pro Outpaint) — deutlich
// günstiger als der bisherige Ideogram-Reframe (~0,20 EUR pro Bild).
router.post("/api/reframe", async (req, res) => {
  if (!FAL_KEY) return sendError(res, 500, "FAL_KEY not configured");

  if (auth.isConfigured()) {
    const user = await auth.verifyToken(auth.bearer(req));
    if (!user) return sendError(res, 401, "Authentifizierung erforderlich");
  }

  let body;
  try {
    body = await readJson(req, { limit: 25 * 1024 * 1024 }); // master as base64
  } catch (e) {
    return sendError(res, e.status || 400, e.message);
  }

  const image = parseDataUrl(body.image);
  if (!image) return sendError(res, 400, "Master-Bild fehlt oder ist ungültig");

  const ratio = TARGET_RATIO[body.targetFormat];
  if (!ratio) return sendError(res, 400, "Unbekanntes Zielformat");

  const dim = imageDimensions(image.buffer);
  if (!dim || !dim.width || !dim.height) {
    return sendError(res, 400, "Bildgröße konnte nicht gelesen werden");
  }

  // Volle Höhe behalten, links+rechts symmetrisch bis zum Ziel-Verhältnis
  // erweitern. Das Master bleibt dadurch horizontal zentriert — exakt die
  // Annahme des Frontend-Shadow-Falloffs.
  const side = Math.max(0, Math.round((dim.height * ratio - dim.width) / 2));

  try {
    const { url } = await fal.outpaint({
      imageDataUrl: body.image,
      left: side,
      right: side,
      top: 0,
      bottom: 0,
    });
    const dl = await ideogram.download(url); // generischer Bild-Download (Buffer)
    sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}` });
  } catch (e) {
    console.error("reframe error:", e.message);
    sendError(res, 502, "Format konnte nicht erstellt werden: " + e.message);
  }
});

// Zielformate der V4-Adaption — Auflösungen sind exakte Treffer aus dem
// remix-v4-Resolution-Enum (2048x2048 = 1:1, 1792x2240 = 4:5), damit V4 das
// 9:16-Quellformat sicher NICHT beibehält.
const FORMAT_V4 = {
  square: { resolution: "2048x2048", label: "1:1 square" },
  feed:   { resolution: "1792x2240", label: "4:5 portrait" },
};

// Referenz-Einfluss (image_weight, 1–100): bewusst MITTLERER Wert — hoch
// genug, dass Stil, Farben und Texte der Vorlage übernommen werden, niedrig
// genug, dass V4 das Layout fürs neue Format wirklich neu anordnen darf,
// statt den 9:16-Flyer mittig mit dunklen Rändern einzusetzen. Justierbar.
const FORMAT_V4_IMAGE_WEIGHT = 50;

// Prompt: bewusst "neu gestalten" statt "exakt kopieren" — vollflächiges
// Re-Layout ohne Ränder/Letterbox. remix-v4 kennt kein negative_prompt-Feld,
// die Verbote stehen deshalb als Avoid-Block im text_prompt.
function formatV4Prompt(label) {
  return (
    `Redesign this flyer as a NEW ${label} layout that completely fills the canvas ` +
    "edge to edge, with no empty borders, no black bars and no padding. Keep the " +
    "same visual style, color palette, typography style, mood and the same " +
    "photographic elements and graphics. Preserve ALL text content exactly as in " +
    "the reference: headline, subline, artist names, date, time, club name, " +
    "location and website. Do not change, translate or invent any text. Rearrange " +
    `and rescale the elements so they are well balanced and fill the entire ${label} ` +
    "canvas naturally, like a flyer that was originally designed for this format. " +
    "The whole canvas must be filled with the design. " +
    "Strictly avoid: black bars, empty borders, padding, letterbox, framed image, " +
    "centered image with margins, gibberish, random letters, misspelled words, " +
    "altered text, duplicate text, placeholder text, watermark."
  );
}

// Format-Adaption über Ideogram 4.0: der fertige V3-Flyer (mit allen korrekten
// Texten) dient als Vorlage, V4 baut genau dieses Design ins Zielformat um,
// statt es wie Reframe outzupainten. Der V4-Weg dafür ist remix-v4 (es gibt
// kein edit-v4 und keine style_reference_images — das Basisbild plus
// image_weight übernimmt die Vorlagen-Rolle). remix-v4 hat auch kein
// magic_prompt-Feld, OFF ist damit implizit; rendering_speed QUALITY ist die
// beste V4-Stufe. Auth-geschützt wie /api/generate.
// Kosten: ca. 0,03–0,10 USD pro V4-Bild — läuft nur auf expliziten Klick und
// wird im Frontend gecacht.
router.post("/api/format-v4", async (req, res) => {
  if (!IDEOGRAM_KEY) return sendError(res, 500, "IDEOGRAM_API_KEY not configured");

  if (auth.isConfigured()) {
    const user = await auth.verifyToken(auth.bearer(req));
    if (!user) return sendError(res, 401, "Authentifizierung erforderlich");
  }

  let body;
  try {
    body = await readJson(req, { limit: 25 * 1024 * 1024 }); // fertiger Flyer als Base64
  } catch (e) {
    return sendError(res, e.status || 400, e.message);
  }

  const image = parseDataUrl(body.masterImage);
  if (!image) return sendError(res, 400, "Master-Bild fehlt oder ist ungültig");

  const target = FORMAT_V4[body.targetFormat];
  if (!target) return sendError(res, 400, "Unbekanntes Zielformat");

  try {
    const { url } = await ideogram.remixV4({
      apiKey: IDEOGRAM_KEY,
      textPrompt: formatV4Prompt(target.label),
      imageBuffer: image.buffer,
      imageType: image.mime,
      resolution: target.resolution,
      imageWeight: FORMAT_V4_IMAGE_WEIGHT,
      renderingSpeed: "QUALITY",
    });
    const dl = await ideogram.download(url);
    sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}` });
  } catch (e) {
    // Voller Ideogram-Response im Log — für die Diagnose von Prompt-/
    // Parameter-Problemen unverzichtbar.
    console.error("format-v4 error:", body.targetFormat, e.message, e.response || "");
    sendError(res, 502, "V4-Format konnte nicht erstellt werden: " + e.message);
  }
});

// Instagram caption generation (Claude). Auth-protected like /api/generate.
router.post("/api/caption", async (req, res) => {
  if (!caption.isConfigured()) return sendError(res, 500, "ANTHROPIC_API_KEY not configured");

  if (auth.isConfigured()) {
    const user = await auth.verifyToken(auth.bearer(req));
    if (!user) return sendError(res, 401, "Authentifizierung erforderlich");
  }

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return sendError(res, e.status || 400, e.message);
  }

  try {
    const text = await caption.generateCaption(body);
    sendJson(res, 200, { caption: text });
  } catch (e) {
    console.error("caption error:", e.message);
    sendError(res, 502, "Caption konnte nicht erstellt werden.");
  }
});

// Verify a Supabase JWT (Authorization: Bearer <token>) and echo the user.
router.post("/api/verify-token", async (req, res) => {
  const token = auth.bearer(req);
  if (!token) return sendError(res, 401, "Missing token");
  const user = await auth.verifyToken(token);
  if (!user) return sendError(res, 401, "Invalid token");
  sendJson(res, 200, { user: { id: user.id, email: user.email } });
});

router.get(/^\/api\/status\/([a-f0-9]+)$/, (req, res, params) => {
  const [jobId] = params;
  const job = jobs.get(jobId);
  if (!job) return sendError(res, 404, "Job not found");
  sendJson(res, 200, job);
  if (job.status !== "pending") jobs.remove(jobId);
});

router.get("/api/proxy", (req, res) => {
  proxy(req, res, req.urlQuery.url);
});

router.get("/api/templates", (_req, res) => {
  const list = templates.list().map((t) => ({
    file: t.file,
    name: t.name,
    category: t.category,
    featured: t.featured,
    // Pfad pro Segment URL-encodieren (Ordnernamen mit Leerzeichen/„&").
    src: "/templates/" + t.file.split("/").map(encodeURIComponent).join("/"),
  }));
  sendJson(res, 200, { templates: list, categories: templates.categories() });
});

router.post("/api/convert", async (req, res) => {
  try {
    const buf = await readBody(req, { limit: 100 * 1024 * 1024 });
    const mp4 = await webmToMp4(buf);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", mp4.length);
    res.writeHead(200);
    res.end(mp4);
  } catch (e) {
    console.error("convert error:", e.message, e.stderr || "");
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("convert failed: " + e.message);
    }
  }
});

const upcase = (s) => (typeof s === "string" ? s.toUpperCase() : s);

// Schreibweise serverseitig passend zum Template normalisieren, damit der Nutzer
// sich nicht um Groß-/Kleinschreibung kümmern muss.
function normalizeCasing(ev, file) {
  if (templates.uppercaseFor(file)) {
    // Block-Template (default): immer-große Slots HEADLINE + WEBSITE in
    // Versalien — exakt wie bisher, kein Regressionsrisiko.
    return { ...ev, name: upcase(ev.name), contact: upcase(ev.contact) };
  }
  // Script-Template: relevante Textfelder smart zu Title-Case (Akronyme wie RNB
  // und Eigenschreibweisen wie McMarv bleiben erhalten), damit die geschwungene
  // Schrift greift — auch wenn der Nutzer alles groß eintippt. Website (URL) und
  // Datum/Uhrzeit bleiben unangetastet.
  return {
    ...ev,
    name:     titleCaseSmart(ev.name),
    prefix:   titleCaseSmart(ev.prefix),
    club:     titleCaseSmart(ev.club),
    location: titleCaseSmart(ev.location),
    dj:       titleCaseSmart(ev.dj),
  };
}

async function runIdeogramJob(jobId, ev, file) {
  const prompt = buildPrompt(normalizeCasing(ev, file));
  console.log(`Job ${jobId} template=${file} prompt:\n${prompt}`);

  let imgBuffer;
  try {
    imgBuffer = templates.loadBuffer(file);
  } catch (e) {
    throw new Error("Template not found: " + e.message);
  }

  const { url } = await ideogram.edit({
    apiKey: IDEOGRAM_KEY,
    prompt,
    imageBuffer: imgBuffer,
  });

  jobs.set(jobId, { status: "done", url });
  console.log(`Job ${jobId} done`);
}

const server = http.createServer(async (req, res) => {
  applyCors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const handled = await router.handle(req, res);
  if (handled) return;

  if (req.method === "GET" && staticFiles.serve(req, res)) return;

  if (!res.headersSent) {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.timeout = 120000;
server.listen(PORT, () => {
  jobs.startSweeper();
  console.log(`NightKit on port ${PORT}`);
});

function shutdown() {
  console.log("Shutting down…");
  jobs.stopSweeper();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
