"use strict";

const https = require("https");

const HOST = "api.ideogram.ai";
const PATH = "/v1/edit";
const REMIX_V4_PATH = "/v1/ideogram-v4/remix";
const TIMEOUT_MS = 90 * 1000;

// files: [{ field, filename, contentType, buffer }]
function buildMultipart(fields, files) {
  const boundary = "----NKB" + Date.now().toString(36);
  const CRLF = "\r\n";
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
      `${value}${CRLF}`,
      "utf8"
    ));
  }

  for (const f of files) {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${f.field}"; filename="${f.filename}"${CRLF}` +
      `Content-Type: ${f.contentType || "image/png"}${CRLF}${CRLF}`,
      "utf8"
    ));
    parts.push(f.buffer);
    parts.push(Buffer.from(CRLF, "utf8"));
  }

  parts.push(Buffer.from(`--${boundary}--${CRLF}`, "utf8"));
  return { body: Buffer.concat(parts), boundary };
}

function postMultipart({ apiKey, path, fields, files }) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error("IDEOGRAM_API_KEY not configured"));

    const { body, boundary } = buildMultipart(fields, files);

    // DIAGNOSE: exakte Wire-Form des Calls. Zeigt Endpoint, alle Text-Felder
    // (inkl. ob eine "mask" dabei ist) und die Datei-Felder mit Feldname +
    // Bytegröße — damit ist nachweisbar, ob das Template wirklich als Basis
    // (und unter welchem Feldnamen) übergeben wird.
    const fileSummary = files.map((f) => `${f.field}="${f.filename}"(${f.buffer ? f.buffer.length : 0}B,${f.contentType})`).join(", ");
    console.log(`[ideogram-diag] → POST https://${HOST}${path} | textFields=[${Object.keys(fields).join(", ")}] | files=[${fileSummary || "NONE"}]`);

    const req = https.request(
      {
        hostname: HOST,
        path,
        method: "POST",
        headers: {
          "Api-Key": apiKey,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          // DIAGNOSE: rohe Ideogram-Antwort. Ein zurückgespiegelter "prompt"
          // oder "resolution"/"seed" im Body deutet auf einen Generate-/Remix-
          // Pfad hin (Edit ohne Maske wird serverseitig nicht als echtes Edit
          // behandelt) — der entscheidende Beleg für H1 vs H2.
          console.log(`[ideogram-diag] ← HTTP ${res.statusCode} | body=${raw.slice(0, 600)}`);
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            return reject(new Error("Parse error: " + raw.slice(0, 200)));
          }
          if (res.statusCode !== 200) {
            const err = new Error(parsed.detail || parsed.message || raw.slice(0, 300));
            err.response = raw.slice(0, 2000); // voller Ideogram-Response fürs Server-Log
            return reject(err);
          }
          const url = parsed.data?.[0]?.url;
          if (!url) {
            const err = new Error("No image URL in response");
            err.response = raw.slice(0, 2000);
            return reject(err);
          }
          resolve({ url, raw: parsed });
        });
      }
    );

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error("Ideogram request timeout"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function edit({ apiKey, prompt, imageBuffer, aspectRatio = "9x16", magicPrompt = "OFF" }) {
  if (!imageBuffer || !imageBuffer.length) {
    return Promise.reject(new Error("Template image missing"));
  }
  return postMultipart({
    apiKey,
    path: PATH,
    fields: { prompt, aspect_ratio: aspectRatio, magic_prompt: magicPrompt },
    files: [{ field: "images", filename: "template.png", contentType: "image/png", buffer: imageBuffer }],
  });
}

// Ideogram 4.0 Remix: Basisbild + Prompt → neues Bild in Ziel-Resolution.
// Genutzt für die Format-Adaption (fertiger Flyer als Vorlage). Laut Doku
// sind die remix-v4-Felder: image, text_prompt (nicht "prompt"),
// image_weight, resolution, rendering_speed — KEIN magic_prompt (OFF ist
// implizit) und KEIN negative_prompt (Verbote gehören in den text_prompt).
// Kosten: ca. 0,03–0,10 USD pro V4-Bild.
function remixV4({
  apiKey,
  textPrompt,
  imageBuffer,
  imageType = "image/png",
  resolution,
  imageWeight = 80,           // justierbar: hoch = nah an der Vorlage
  renderingSpeed = "QUALITY", // beste verfügbare V4-Stufe
}) {
  if (!imageBuffer || !imageBuffer.length) return Promise.reject(new Error("Image missing"));
  if (!textPrompt) return Promise.reject(new Error("Prompt missing"));
  if (!resolution) return Promise.reject(new Error("Resolution missing"));
  return postMultipart({
    apiKey,
    path: REMIX_V4_PATH,
    fields: {
      text_prompt: textPrompt,
      resolution,
      image_weight: String(imageWeight),
      rendering_speed: renderingSpeed,
    },
    files: [{ field: "image", filename: "image.png", contentType: imageType, buffer: imageBuffer }],
  });
}

// Download an Ideogram result image (ephemeral CDN URL) into a buffer so the
// server can return it inline as base64.
function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 3) return reject(new Error("Too many redirects"));
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("Image download failed: HTTP " + res.statusCode));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: res.headers["content-type"] || "image/png",
      }));
      res.on("error", reject);
    });
    req.setTimeout(60 * 1000, () => req.destroy(new Error("Image download timeout")));
    req.on("error", reject);
  });
}

module.exports = { edit, remixV4, download };
