"use strict";

const http = require("http");
const path = require("path");

const { buildPrompt }       = require("./lib/prompt");
const ideogram              = require("./lib/ideogram");
const replicate             = require("./lib/replicate");
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

// Inpainting-Korrektur: vom User markierte Bereiche (Maske) werden per
// Ideogram V3 Edit entfernt oder ersetzt, der Rest bleibt unverändert.
// Auth-geschützt wie /api/generate.
// Kosten: Jede Korrektur ist ein bezahlter Ideogram-Call (~0,20 USD).
router.post("/api/correct", async (req, res) => {
  if (!IDEOGRAM_KEY) return sendError(res, 500, "IDEOGRAM_API_KEY not configured");

  if (auth.isConfigured()) {
    const user = await auth.verifyToken(auth.bearer(req));
    if (!user) return sendError(res, 401, "Authentifizierung erforderlich");
  }

  let body;
  try {
    body = await readJson(req, { limit: 25 * 1024 * 1024 }); // flyer + mask as base64
  } catch (e) {
    return sendError(res, e.status || 400, e.message);
  }

  const image = parseDataUrl(body.image);
  const mask  = parseDataUrl(body.mask);
  if (!image) return sendError(res, 400, "Flyer-Bild fehlt oder ist ungültig");
  if (!mask)  return sendError(res, 400, "Maske fehlt oder ist ungültig");

  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  const prompt = instruction
    ? `Replace the content in the masked areas with: ${instruction}. ` +
      "Match the existing design style, fonts, colors and lighting of the flyer. " +
      "Keep everything outside the mask exactly unchanged."
    : "Completely remove any content in the masked areas. Fill the masked areas ONLY " +
      "with a seamless continuation of the surrounding background, textures, colors and " +
      "lighting. Absolutely DO NOT generate any text, letters, words, numbers, symbols " +
      "or new objects in the masked areas under any circumstances. The masked areas must " +
      "look like empty background that blends perfectly with the surroundings. Keep " +
      "everything outside the mask exactly unchanged.";

  try {
    const { url } = await ideogram.editMasked({
      apiKey: IDEOGRAM_KEY,
      prompt,
      imageBuffer: image.buffer,
      imageType: image.mime,
      maskBuffer: mask.buffer,
    });
    const dl = await ideogram.download(url);
    sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}` });
  } catch (e) {
    console.error("correct error:", e.message);
    sendError(res, 502, "Korrektur fehlgeschlagen: " + e.message);
  }
});

// Sauberes Entfernen (LaMa via Replicate): die markierten Flächen werden
// wirklich gelöscht und content-aware mit Hintergrund aufgefüllt — im
// Gegensatz zu /api/correct (Ideogram), das in der Lücke neuen Inhalt erfindet.
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

// Ziel-Formate → Ideogram-V3-Resolution-Enum. Die Wunschgrößen (1080x1350,
// 1080x1080) existieren im Enum nicht; gewählt ist jeweils der Enum-Wert
// mit exakt passendem Seitenverhältnis.
const REFRAME_RESOLUTIONS = {
  feed:   "896x1120",  // 4:5
  square: "1024x1024", // 1:1
};

// Deterministischer Seed aus den Master-Bytes (FNV-1a): gleiches Master ⇒
// gleicher Seed für alle Zielformate und Wiederholungen — Reframes bleiben
// damit "pro Session" (= pro generiertem Flyer) konsistent.
function seedFromBuffer(buf) {
  let h = 2166136261;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = (h * 16777619) >>> 0;
  }
  return h % 2147483647;
}

// Multi-Format-Export: erweitert das 9:16-Master-Bild per Ideogram V3 Reframe
// intelligent auf ein anderes Seitenverhältnis (keine schwarzen Ränder, kein
// hartes Cropping). Auth-geschützt wie /api/generate.
// Kosten: Jeder Reframe-Aufruf ist ein zusätzlicher Ideogram-Call (~0,20 USD).
//
// Stiltreue: Der Reframe-Endpoint akzeptiert laut Ideogram-Doku KEIN
// prompt / negative_prompt / style_type — die gewünschte Steuerung läuft
// stattdessen über die unterstützten Hebel: das Master-Bild selbst als
// style_reference_image (Farbgebung, Textur und Look der erweiterten Flächen
// folgen dem Flyer — DER entscheidende Hebel gegen Fantasietext und falsche
// Hintergrundfarben), rendering_speed QUALITY (höchste Fidelity) und ein
// fester, aus dem Master abgeleiteter Seed.
router.post("/api/reframe", async (req, res) => {
  if (!IDEOGRAM_KEY) return sendError(res, 500, "IDEOGRAM_API_KEY not configured");

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

  const resolution = REFRAME_RESOLUTIONS[body.targetFormat];
  if (!resolution) return sendError(res, 400, "Unbekanntes Zielformat");

  try {
    const { url } = await ideogram.reframe({
      apiKey: IDEOGRAM_KEY,
      imageBuffer: image.buffer,
      imageType: image.mime,
      resolution,
      styleReferenceBuffer: image.buffer, // Master als Style-Referenz
      styleReferenceType: image.mime,
      renderingSpeed: "QUALITY",
      seed: seedFromBuffer(image.buffer),
    });
    const dl = await ideogram.download(url);
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
    src: `/templates/${t.file}`,
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

async function runIdeogramJob(jobId, ev, file) {
  const prompt = buildPrompt(ev);
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
