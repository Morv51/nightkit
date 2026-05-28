"use strict";

const { URL } = require("url");

function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const isRegex = pattern instanceof RegExp;
    routes.push({ method, pattern, handler, isRegex });
  }

  async function handle(req, res) {
    const parsed = new URL(req.url, "http://x");
    req.urlPathname = parsed.pathname;
    req.urlQuery = Object.fromEntries(parsed.searchParams);

    for (const r of routes) {
      if (r.method !== req.method && r.method !== "*") continue;
      let match = false;
      let params = null;
      if (r.isRegex) {
        const m = req.urlPathname.match(r.pattern);
        if (m) { match = true; params = m.slice(1); }
      } else if (r.pattern === req.urlPathname) {
        match = true;
      }
      if (!match) continue;

      try {
        const handled = await r.handler(req, res, params);
        if (handled !== false) return true;
      } catch (e) {
        console.error("Route error:", e);
        if (!res.headersSent) {
          res.setHeader("Content-Type", "application/json");
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message || "Internal error" }));
        }
        return true;
      }
    }
    return false;
  }

  return {
    get:  (p, h) => add("GET", p, h),
    post: (p, h) => add("POST", p, h),
    any:  (p, h) => add("*", p, h),
    use:  (h)    => add("*", /.*/, h),
    handle,
  };
}

module.exports = { createRouter };
