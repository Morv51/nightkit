"use strict";

// Isolierte Ideogram-V3-Generierung MIT Style-Reference fürs Template Studio
// (Modus 2). Bewusst eigenständig, weil lib/ideogram.js kein V3-generate /
// style_reference_images kennt und dessen postMultipart privat ist — diese
// Datei verändert dort nichts. Multipart-Muster gespiegelt aus lib/ideogram.js.

const https = require("https");

const HOST = "api.ideogram.ai";
const PATH = "/v1/ideogram-v3/generate";
const EDIT_PATH = "/v1/ideogram-v3/edit";
const TIMEOUT_MS = 120 * 1000; // QUALITY kann länger dauern

// files: [{ field, filename, contentType, buffer }]
function buildMultipart(fields, files) {
  const boundary = "----NKSTUDIO" + Date.now().toString(36);
  const CRLF = "\r\n";
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`,
      "utf8"
    ));
  }
  for (const f of files) {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${f.field}"; filename="${f.filename}"${CRLF}` +
      `Content-Type: ${f.contentType || "image/png"}${CRLF}${CRLF}`,
      "utf8"
    ));
    parts.push(f.buffer);
    parts.push(Buffer.from(CRLF, "utf8"));
  }
  parts.push(Buffer.from(`--${boundary}--${CRLF}`, "utf8"));
  return { body: Buffer.concat(parts), boundary };
}

function postMultipart({ apiKey, path = PATH, fields, files }) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error("IDEOGRAM_API_KEY not configured"));
    const { body, boundary } = buildMultipart(fields, files);
    const fileSummary = files.map((f) => `${f.field}(${f.buffer ? f.buffer.length : 0}B)`).join(", ");
    console.log(`[studio-ideogramV3] → POST https://${HOST}${path} | fields=[${Object.keys(fields).join(", ")}] | files=[${fileSummary}]`);

    const req = https.request({
      hostname: HOST, path, method: "POST",
      headers: {
        "Api-Key": apiKey,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { return reject(new Error("Parse error: " + raw.slice(0, 200))); }
        if (res.statusCode !== 200) {
          const err = new Error(parsed.detail || parsed.message || raw.slice(0, 300));
          err.response = raw.slice(0, 2000);
          return reject(err);
        }
        const url = parsed.data && parsed.data[0] && parsed.data[0].url;
        if (!url) { const e = new Error("No image URL in response"); e.response = raw.slice(0, 2000); return reject(e); }
        resolve({ url, raw: parsed });
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("Ideogram request timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Modus 2: Prompt + ein oder mehrere Style-Reference-Bilder (Moodboard) → Flyer.
// magic_prompt OFF, aspect_ratio 9x16, höchste Qualität. styleRefBuffers: Array
// von Buffern (gesamt ≤10 MB laut Ideogram).
function generateWithStyleRef({
  apiKey, prompt, styleRefBuffers, styleRefType = "image/png",
  aspectRatio = "9x16", magicPrompt = "OFF", renderingSpeed = "QUALITY",
}) {
  if (!prompt) return Promise.reject(new Error("Prompt missing"));
  const refs = (styleRefBuffers || []).filter((b) => b && b.length);
  if (!refs.length) return Promise.reject(new Error("Style reference image missing"));
  const ext = styleRefType === "image/jpeg" ? "jpg" : styleRefType === "image/webp" ? "webp" : "png";
  return postMultipart({
    apiKey,
    fields: {
      prompt,
      aspect_ratio: aspectRatio,
      magic_prompt: magicPrompt,
      rendering_speed: renderingSpeed,
    },
    files: refs.map((buffer, i) => ({
      field: "style_reference_images",
      filename: `ref-${i}.${ext}`,
      contentType: styleRefType,
      buffer,
    })),
  });
}

// Modus 1: MASKIERTER Edit (V3 Inpainting). Es wird NUR der maskierte Bereich
// neu generiert; der Rest bleibt unangetastet. magic_prompt OFF. image + mask
// müssen gleiche Maße haben. Masken-Konvention V3 (laut Doku): SCHWARZ = zu
// bearbeitender Bereich, WEISS = behalten. (Falls invertiert: MASK_EDIT_BLACK
// im Frontend kippen — der Composite macht eine falsche Polarität ungefährlich.)
function editMasked({
  apiKey, prompt, imageBuffer, maskBuffer, imageType = "image/png",
  magicPrompt = "OFF", renderingSpeed = "QUALITY",
}) {
  if (!prompt) return Promise.reject(new Error("Prompt missing"));
  if (!imageBuffer || !imageBuffer.length) return Promise.reject(new Error("Image missing"));
  if (!maskBuffer || !maskBuffer.length) return Promise.reject(new Error("Mask missing"));
  const ext = imageType === "image/jpeg" ? "jpg" : imageType === "image/webp" ? "webp" : "png";
  return postMultipart({
    apiKey,
    path: EDIT_PATH,
    fields: { prompt, magic_prompt: magicPrompt, rendering_speed: renderingSpeed },
    files: [
      { field: "image", filename: `image.${ext}`, contentType: imageType, buffer: imageBuffer },
      { field: "mask", filename: "mask.png", contentType: "image/png", buffer: maskBuffer },
    ],
  });
}

module.exports = { generateWithStyleRef, editMasked };
