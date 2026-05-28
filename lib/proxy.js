"use strict";

const https = require("https");
const { URL } = require("url");

const ALLOW_HOSTS = new Set([
  "ideogram.ai",
  "api.ideogram.ai",
  "ideogram.ai.s3.amazonaws.com",
]);

function isAllowed(hostname) {
  if (ALLOW_HOSTS.has(hostname)) return true;
  if (hostname.endsWith(".ideogram.ai")) return true;
  if (hostname.endsWith(".amazonaws.com")) return true;
  return false;
}

function proxy(req, res, targetUrl) {
  if (!targetUrl) {
    res.writeHead(400);
    res.end("missing url");
    return;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.writeHead(400);
    res.end("invalid url");
    return;
  }

  if (parsed.protocol !== "https:") {
    res.writeHead(400);
    res.end("only https allowed");
    return;
  }

  if (!isAllowed(parsed.hostname)) {
    res.writeHead(403);
    res.end("host not allowed");
    return;
  }

  const upstream = https.get(parsed.toString(), (uRes) => {
    if (uRes.statusCode && uRes.statusCode >= 400) {
      res.writeHead(uRes.statusCode);
      res.end("upstream " + uRes.statusCode);
      return;
    }
    res.setHeader("Content-Type", uRes.headers["content-type"] || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.writeHead(200);
    uRes.pipe(res);
  });

  upstream.setTimeout(30000, () => upstream.destroy(new Error("proxy timeout")));
  upstream.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502);
    res.end("proxy error: " + e.message);
  });
}

module.exports = { proxy, isAllowed };
