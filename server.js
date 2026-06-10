"use strict";

const http = require("http");
const path = require("path");

const { buildPrompt }       = require("./lib/prompt");
const ideogram              = require("./lib/ideogram");
const jobs                  = require("./lib/jobs");
const templates             = require("./lib/templates");
const { createServer: createStatic } = require("./lib/static");
const { proxy }             = require("./lib/proxy");
const { webmToMp4 }         = require("./lib/convert");
const { createRouter }      = require("./lib/router");
const auth                  = require("./lib/auth");
const caption               = require("./lib/caption");
const { readJson, readBody, sendJson, sendError, applyCors } = require("./lib/http");

const PORT         = process.env.PORT || 3000;
const IDEOGRAM_KEY = process.env.IDEOGRAM_API_KEY || "";

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
