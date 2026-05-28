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

  let ev;
  try {
    ev = await readJson(req);
  } catch (e) {
    return sendError(res, e.status || 400, e.message);
  }

  const templateId = ev.templateId || "default";
  const template = templates.get(templateId);
  if (!template) return sendError(res, 400, `Unknown template: ${templateId}`);

  if (!ev.name || !ev.date) {
    return sendError(res, 400, "Event name and date are required");
  }

  const jobId = jobs.create();
  sendJson(res, 202, { jobId });

  runIdeogramJob(jobId, ev, templateId).catch((e) => {
    console.error(`Job ${jobId} failed:`, e.message);
    jobs.set(jobId, { status: "error", error: e.message });
  });
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
  sendJson(res, 200, { templates: templates.list() });
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

async function runIdeogramJob(jobId, ev, templateId) {
  const prompt = buildPrompt(ev);
  console.log(`Job ${jobId} template=${templateId} prompt:\n${prompt}`);

  let imgBuffer;
  try {
    imgBuffer = templates.loadBuffer(templateId);
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
