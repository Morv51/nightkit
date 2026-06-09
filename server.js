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
  const list = templates.list().map((t) => ({ ...t, src: `/templates/${t.file}` }));
  sendJson(res, 200, { templates: list });
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
