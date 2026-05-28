"use strict";

const https = require("https");

const HOST = "api.ideogram.ai";
const PATH = "/v1/edit";
const TIMEOUT_MS = 90 * 1000;

function buildMultipart(fields, imageBuffer, imageField, imageFilename) {
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

  parts.push(Buffer.from(
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="${imageField}"; filename="${imageFilename}"${CRLF}` +
    `Content-Type: image/png${CRLF}${CRLF}`,
    "utf8"
  ));
  parts.push(imageBuffer);
  parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`, "utf8"));

  return { body: Buffer.concat(parts), boundary };
}

function edit({ apiKey, prompt, imageBuffer, aspectRatio = "9x16", magicPrompt = "OFF" }) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error("IDEOGRAM_API_KEY not configured"));
    if (!imageBuffer || !imageBuffer.length) return reject(new Error("Template image missing"));

    const { body, boundary } = buildMultipart(
      { prompt, aspect_ratio: aspectRatio, magic_prompt: magicPrompt },
      imageBuffer,
      "images",
      "template.png"
    );

    const req = https.request(
      {
        hostname: HOST,
        path: PATH,
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

module.exports = { edit };
