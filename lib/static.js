"use strict";

const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif":  "image/gif",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".mp4":  "video/mp4",
};

const SAFE_PATH = /^[a-zA-Z0-9._\-/]+$/;

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function createServer({ roots, rewrites = {} }) {
  const resolvedRoots = roots.map((r) => ({
    prefix: r.prefix,
    dir: path.resolve(r.dir),
  }));

  function findRoot(reqPath) {
    for (const r of resolvedRoots) {
      if (reqPath === r.prefix || reqPath.startsWith(r.prefix + "/") ||
          (r.prefix === "/" && reqPath.startsWith("/"))) {
        return r;
      }
    }
    return null;
  }

  function serve(req, res) {
    let urlPath = rewrites[req.url] || rewrites[req.urlPathname] || req.urlPathname;

    if (!SAFE_PATH.test(urlPath)) {
      res.writeHead(400);
      res.end("Bad path");
      return true;
    }

    const root = findRoot(urlPath);
    if (!root) return false;

    const rel = root.prefix === "/"
      ? urlPath.slice(1)
      : urlPath.slice(root.prefix.length).replace(/^\//, "");

    const filePath = path.join(root.dir, rel);
    if (!filePath.startsWith(root.dir + path.sep) && filePath !== root.dir) {
      res.writeHead(403);
      res.end("Forbidden");
      return true;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.setHeader("Content-Type", mimeFor(filePath));
      res.setHeader("Cache-Control", "public, max-age=300");
      res.writeHead(200);
      res.end(data);
    });
    return true;
  }

  return { serve };
}

module.exports = { createServer, mimeFor };
