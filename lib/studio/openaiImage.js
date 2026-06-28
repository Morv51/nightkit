"use strict";

// Zweite Bild-Engine fürs Template Studio (Modus 1): OpenAI GPT Image, als
// Vergleich zu Ideogram V3. Bewusst isoliert (eigener Pfad, eigener Key), per
// rohem https — keine neue npm-Abhängigkeit. Ändert nichts am Ideogram/FAL-Pfad.
//
// Image-to-Image Edit: das Original-Flyer-Bild geht als Basis rein, der Prompt
// steuert die Umsetzung. Key aus Env OPENAI_API_KEY (nie hardcoden). Modell aus
// Env OPENAI_IMAGE_MODEL, Default "gpt-image-1" (auf "gpt-image-2" o.ä. über die
// Env umstellbar, ohne Code-Änderung).

const https = require("https");

const HOST = "api.openai.com";
const PATH = "/v1/images/edits";
const TIMEOUT_MS = 180 * 1000; // hohe Qualität kann lange dauern
const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

function buildMultipart(fields, files) {
  const boundary = "----NKOPENAI" + Date.now().toString(36);
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

// Original-Flyer + Prompt → neues Bild (b64). Hochformat (1024x1536 = höchstes
// Portrait, das gpt-image bietet — nicht exakt 9:16), höchste Qualität.
function editImage({ apiKey, prompt, imageBuffer, imageType = "image/png", size = "1024x1536", quality = "high" }) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error("OPENAI_API_KEY not configured"));
    if (!prompt) return reject(new Error("Prompt missing"));
    if (!imageBuffer || !imageBuffer.length) return reject(new Error("Image missing"));

    const ext = imageType === "image/jpeg" ? "jpg" : imageType === "image/webp" ? "webp" : "png";
    const { body, boundary } = buildMultipart(
      { model: MODEL, prompt, size, quality, n: "1" },
      [{ field: "image", filename: `flyer.${ext}`, contentType: imageType, buffer: imageBuffer }]
    );
    console.log(`[studio-openai] → POST https://${HOST}${PATH} | model=${MODEL} size=${size} quality=${quality} image=${imageBuffer.length}B`);

    const req = https.request({
      hostname: HOST, path: PATH, method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
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
          const msg = (parsed.error && parsed.error.message) || raw.slice(0, 300);
          const err = new Error(msg);
          err.response = raw.slice(0, 2000);
          return reject(err);
        }
        const b64 = parsed.data && parsed.data[0] && parsed.data[0].b64_json;
        if (!b64) { const e = new Error("No image in response"); e.response = raw.slice(0, 2000); return reject(e); }
        resolve({ b64 });
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("OpenAI request timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = { editImage, MODEL };
