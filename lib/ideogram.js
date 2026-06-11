"use strict";

const https = require("https");

const HOST = "api.ideogram.ai";
const PATH = "/v1/edit";
const EDIT_V3_PATH = "/v1/ideogram-v3/edit";
const REFRAME_V3_PATH = "/v1/ideogram-v3/reframe";
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
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            return reject(new Error("Parse error: " + raw.slice(0, 200)));
          }
          if (res.statusCode !== 200) {
            return reject(new Error(parsed.detail || parsed.message || raw.slice(0, 300)));
          }
          const url = parsed.data?.[0]?.url;
          if (!url) return reject(new Error("No image URL in response"));
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

// Masked inpainting via the Ideogram 3.0 Edit endpoint. Mask convention per
// the Ideogram docs: BLACK pixels are regenerated, WHITE pixels are kept
// unchanged. The mask must have exactly the same dimensions as the image.
function editMasked({ apiKey, prompt, imageBuffer, imageType = "image/png", maskBuffer, magicPrompt = "OFF" }) {
  if (!imageBuffer || !imageBuffer.length) return Promise.reject(new Error("Image missing"));
  if (!maskBuffer || !maskBuffer.length) return Promise.reject(new Error("Mask missing"));
  return postMultipart({
    apiKey,
    path: EDIT_V3_PATH,
    fields: { prompt, magic_prompt: magicPrompt },
    files: [
      { field: "image", filename: "image.png", contentType: imageType, buffer: imageBuffer },
      { field: "mask", filename: "mask.png", contentType: "image/png", buffer: maskBuffer },
    ],
  });
}

// Reframe via the Ideogram 3.0 Reframe endpoint: intelligently extends the
// image to a new aspect ratio (no black bars, no hard crop). `resolution`
// must be one of the enum values from the docs, e.g. "1024x1024".
function reframe({ apiKey, imageBuffer, imageType = "image/png", resolution }) {
  if (!imageBuffer || !imageBuffer.length) return Promise.reject(new Error("Image missing"));
  if (!resolution) return Promise.reject(new Error("Resolution missing"));
  return postMultipart({
    apiKey,
    path: REFRAME_V3_PATH,
    fields: { resolution },
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

module.exports = { edit, editMasked, reframe, download };
