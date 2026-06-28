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
// Format: "auto" → das Modell folgt dem Seitenverhältnis des Referenzbildes
// (unser Original ist 9:16) und formt es NICHT auf ein festes Format um. So
// bleibt der Edit formattreu. Per Env OPENAI_IMAGE_SIZE überschreibbar, falls
// ein konkretes Hochformat-Token gewünscht ist.
const SIZE = process.env.OPENAI_IMAGE_SIZE || "auto";
// MOTIVERHALT: input_fidelity="high" bewahrt Gesichter/Personen/Details des
// Eingabebildes (so macht es auch die ChatGPT-Oberfläche), während der Prompt
// die Textänderung steuert. WICHTIG (Lehre aus dem Bug): KEINE zusätzliche
// "bewahre alles / nur Text ändern"-Vorrede in den Prompt mischen — kombiniert
// mit hoher Fidelity fror das den Edit ein, sodass auch der Text NICHT ersetzt
// wurde. Wir senden EXAKT den generierten Prompt, identisch zu dem, der in der
// ChatGPT-Oberfläche korrekt funktioniert. Per Env OPENAI_INPUT_FIDELITY
// umstellbar ("low" zum Gegentesten, leer = Parameter weglassen).
const INPUT_FIDELITY = process.env.OPENAI_INPUT_FIDELITY === undefined
  ? "high"
  : process.env.OPENAI_INPUT_FIDELITY;

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

// Original-Flyer (als Referenz) + Prompt → neues Bild (b64) über den Edit-/
// Image-to-Image-Endpunkt mit input_fidelity=high: Personen/Hauptmotiv bleiben
// erhalten, nur der Text ändert sich. BEWUSST KEINE Maske — eine Voll- oder
// Personen-Maske würde das Motiv zur Neugenerierung freigeben (genau das wollen
// wir verhindern). Format folgt dem Referenzbild.
function editImage({ apiKey, prompt, imageBuffer, imageType = "image/png", size = SIZE, quality = "high" }) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error("OPENAI_API_KEY not configured"));
    if (!prompt) return reject(new Error("Prompt missing"));
    if (!imageBuffer || !imageBuffer.length) return reject(new Error("Image missing"));

    const ext = imageType === "image/jpeg" ? "jpg" : imageType === "image/webp" ? "webp" : "png";
    // EXAKT den generierten Prompt senden — identisch zu dem, der in der ChatGPT-
    // Oberfläche korrekt arbeitet. input_fidelity (Default high) bewahrt das Motiv.
    const fields = { model: MODEL, prompt, size, quality, n: "1" };
    if (INPUT_FIDELITY) fields.input_fidelity = INPUT_FIDELITY;
    const { body, boundary } = buildMultipart(
      fields,
      [{ field: "image", filename: `flyer.${ext}`, contentType: imageType, buffer: imageBuffer }]
    );
    console.log(`[studio-openai] → POST https://${HOST}${PATH} | model=${MODEL} fidelity=${INPUT_FIDELITY || "-"} size=${size} quality=${quality} image=${imageBuffer.length}B`);

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
