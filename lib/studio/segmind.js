"use strict";

// Isolierte Segmind-Anbindung fürs Template Studio (Auto-Flow): Nano Banana Pro.
// Referenzbild(er) via image_urls (ÖFFENTLICHE URLs — kein Base64) + unser Prompt
// → neues Bild. Header x-api-key. Eigenständig per rohem https, verändert nichts
// an den anderen Engines (ideogram/openai/fal). safety_tolerance 1 (strikt) … 6
// (am wenigsten streng) — wir setzen die permissivste Stufe, damit Club-Motive
// nicht unnötig geblockt werden. Inhaltliche Ablehnung kommt als Fehler mit der
// echten Segmind-Meldung zurück (im UI sichtbar).

const https = require("https");

const HOST = "api.segmind.com";
const TIMEOUT_MS = 180 * 1000; // kann lange dauern

// Verfügbare Nano-Banana-Modelle bei Segmind (zum Vergleich im Auto-Flow). Alle
// nehmen denselben Body (prompt, image_urls, aspect_ratio, safety_tolerance,
// output_format). Pro = beste Qualität; Banana 2 = bessere Anweisungstreue +
// Fotorealismus. Default = Pro. Leicht erweiterbar.
const MODELS = {
  "nano-banana-pro": { path: "/v1/nano-banana-pro", label: "Nano Banana Pro" },
  "nano-banana-2":   { path: "/v1/nano-banana-2",   label: "Nano Banana 2" },
};
const DEFAULT_MODEL = "nano-banana-pro";
function modelKey(k) { return MODELS[k] ? k : DEFAULT_MODEL; }

// Bild-URL aus verschiedenen möglichen Antwort-Formen ziehen.
function pickUrl(j) {
  const isUrl = (s) => typeof s === "string" && /^https?:\/\//.test(s);
  if (isUrl(j.output)) return j.output;
  if (Array.isArray(j.output) && isUrl(j.output[0])) return j.output[0];
  if (isUrl(j.image)) return j.image;
  if (isUrl(j.image_url)) return j.image_url;
  if (isUrl(j.url)) return j.url;
  if (Array.isArray(j.images) && j.images[0]) {
    const c = j.images[0];
    if (isUrl(c)) return c;
    if (c && isUrl(c.url)) return c.url;
    if (c && isUrl(c.image_url)) return c.image_url;
  }
  if (Array.isArray(j.data) && j.data[0] && isUrl(j.data[0].url)) return j.data[0].url;
  return null;
}
// Base64-Bild aus verschiedenen möglichen Feldern ziehen.
function pickB64(j) {
  const cand = j.image || j.b64 || j.b64_json || (j.data && j.data[0] && (j.data[0].b64_json || j.data[0].b64));
  return (typeof cand === "string" && cand.length > 100 && !/^https?:\/\//.test(cand)) ? cand : null;
}

function generate({ apiKey, prompt, imageUrls = [], aspectRatio = "9:16", safetyTolerance = 6, outputFormat = "png", model }) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error("SEGMIND_API_KEY not configured"));
    if (!prompt) return reject(new Error("Prompt missing"));

    const key = modelKey(model);
    const PATH = MODELS[key].path;

    const payload = JSON.stringify({
      prompt,
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
      aspect_ratio: aspectRatio,
      safety_tolerance: safetyTolerance, // 6 = am wenigsten streng
      output_format: outputFormat,
    });

    let settled = false, killer = null;
    const done = (fn) => { if (settled) return; settled = true; if (killer) clearTimeout(killer); fn(); };

    console.log(`[studio-segmind] → POST https://${HOST}${PATH} | model=${key} refs=${imageUrls.length} aspect=${aspectRatio} safety=${safetyTolerance} promptLen=${prompt.length}`);

    const req = https.request({
      hostname: HOST, path: PATH, method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("error", (e) => done(() => reject(new Error("Segmind-Antwort abgebrochen: " + e.message))));
      res.on("end", () => done(() => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers["content-type"] || "";
        if (res.statusCode !== 200) {
          // Echte Segmind-Meldung durchreichen (z. B. inhaltliche Ablehnung).
          let msg = buf.toString("utf8").slice(0, 600);
          try { const j = JSON.parse(buf.toString("utf8")); msg = j.error || j.message || j.detail || msg; } catch {}
          const err = new Error(`HTTP ${res.statusCode}: ${msg}`);
          err.status = res.statusCode; err.response = buf.toString("utf8").slice(0, 2000);
          return reject(err);
        }
        if (ct.startsWith("image/")) return resolve({ buffer: buf, contentType: ct }); // Rohbild
        let j;
        try { j = JSON.parse(buf.toString("utf8")); }
        catch { return reject(new Error("Segmind lieferte unerwartetes Format: " + buf.toString("utf8").slice(0, 200))); }
        const url = pickUrl(j);
        if (url) return resolve({ url });
        const b64 = pickB64(j);
        if (b64) return resolve({ b64 });
        return reject(new Error("Segmind-Antwort ohne Bild: " + JSON.stringify(j).slice(0, 300)));
      }));
    });

    req.on("error", (e) => done(() => reject(new Error("Segmind-Verbindung fehlgeschlagen: " + e.message))));
    killer = setTimeout(() => done(() => {
      req.destroy();
      reject(new Error("Zeitüberschreitung: Segmind hat nicht innerhalb von 180 s geantwortet"));
    }), TIMEOUT_MS);
    req.write(payload);
    req.end();
  });
}

module.exports = { generate, MODELS, DEFAULT_MODEL };
