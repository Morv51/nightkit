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

// Verfügbare Segmind-Modelle im Auto-Flow (zum direkten Vergleich). Jedes Modell
// hat eigene Body-Felder (Referenzbild, Seitenverhältnis, Moderation heißen je
// Modell anders) → pro Modell eine body()-Funktion, die die generischen Eingaben
// (prompt, imageUrls, aspectRatio, safety) auf die richtigen Feldnamen mappt.
// Referenzbild geht überall als ÖFFENTLICHE URL mit. Leicht erweiterbar.
//   g = { prompt, imageUrls:[url], aspectRatio:"9:16", safety }
// Nano Banana: image_urls + aspect_ratio + safety_tolerance (6 = permissiv).
function nanoBody(g) {
  return { prompt: g.prompt, ...(g.imageUrls.length ? { image_urls: g.imageUrls } : {}),
    aspect_ratio: g.aspectRatio, safety_tolerance: g.safety, output_format: "png" };
}
// Seedream 4.0: image_input + aspect_ratio + size; KEIN Moderations-Parameter
// (inhaltliche Ablehnung kommt als FAILED → als Fehler sichtbar).
function seedreamBody(g) {
  return { prompt: g.prompt, ...(g.imageUrls.length ? { image_input: g.imageUrls } : {}),
    aspect_ratio: g.aspectRatio, size: "2K", max_images: 1 };
}
// FLUX.2 Pro: image_urls + width/height (kein aspect_ratio) + safety_tolerance.
// 1152x2048 = exakt 9:16 (beide Vielfache von 16).
function fluxBody(g) {
  return { prompt: g.prompt, ...(g.imageUrls.length ? { image_urls: g.imageUrls } : {}),
    width: 1152, height: 2048, safety_tolerance: g.safety, output_format: "png" };
}

const MODELS = {
  "nano-banana-pro": { path: "/v1/nano-banana-pro", label: "Nano Banana Pro", body: nanoBody },
  "nano-banana-2":   { path: "/v1/nano-banana-2",   label: "Nano Banana 2",   body: nanoBody },
  "seedream-4":      { path: "/v1/seedream-4",       label: "Seedream 4.0",    body: seedreamBody },
  "flux-2-pro":      { path: "/v1/flux-2-pro",       label: "FLUX.2 Pro",      body: fluxBody },
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

    // Pro-Modell die richtigen Feldnamen bauen (Referenz/Format/Moderation
    // heißen je Modell anders). safety: 6 = permissivste Stufe.
    const payload = JSON.stringify(
      MODELS[key].body({ prompt, imageUrls, aspectRatio, safety: safetyTolerance, outputFormat })
    );

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
