"use strict";

// Vision -> Text gegen OpenAI. NEU, weil openaiImage.js ausschliesslich die
// Bild-Endpunkte (/v1/images/edits, /v1/images/generations) spricht — einen
// Text-Rueckgabe-Call gab es im Repo bisher nicht. Bauform bewusst identisch zu
// openaiImage.js: rohes https (KEINE neue npm-Abhaengigkeit), Key aus
// OPENAI_API_KEY, Modell aus einer Env-Variablen, hartes Wall-Clock-Timeout,
// strukturierte Fehler mit .status und .response.
//
// Endpunkt ist /v1/responses, weil nur der Bild-Eingabe UND eine Reasoning-Stufe
// zusammen kann.
//
// Env:
//   OPENAI_TEXT_MODEL       Default "gpt-5.6-sol"
//   OPENAI_TEXT_EFFORT      Default "high" (hoechste Stufe)
//   OPENAI_TEXT_MAX_OUTPUT  Default 16000, wird nie unter 16000 gesetzt
//   OPENAI_TEXT_TIMEOUT_MS  Default 600000 (10 min)

const https = require("https");

const HOST = "api.openai.com";
const PATH = "/v1/responses";

const MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5.6-sol";
const EFFORT = process.env.OPENAI_TEXT_EFFORT || "high";

// WICHTIG: Bei der Responses API zaehlen die Reasoning-Tokens gegen
// max_output_tokens. Steht der Wert zu niedrig, kommt eine abgeschnittene oder
// leere Antwort zurueck, obwohl der Call bezahlt ist. Der Analyse-Prompt ist
// lang und die Stufe steht auf "high" — darum ein hoher Sockel, der per Env nur
// nach OBEN verschiebbar ist.
const MAX_OUTPUT_FLOOR = 16000;
const MAX_OUTPUT = Math.max(MAX_OUTPUT_FLOOR, Number(process.env.OPENAI_TEXT_MAX_OUTPUT) || 0);

// Grosszuegig: der Aufruf laeuft hinter dem Job-Muster, der Browser haengt nicht
// am selben Socket. Schuetzt nur vor dem Ewig-Haenger.
const TIMEOUT_MS = Number(process.env.OPENAI_TEXT_TIMEOUT_MS) || 600 * 1000;

// Saemtliche output_text-Stuecke der Antwort einsammeln. Reasoning-Items haben
// keinen output_text und fallen dabei von selbst weg.
function extractText(parsed) {
  const out = [];
  const items = Array.isArray(parsed && parsed.output) ? parsed.output : [];
  for (const item of items) {
    const content = Array.isArray(item && item.content) ? item.content : [];
    for (const c of content) {
      if (c && c.type === "output_text" && typeof c.text === "string") out.push(c.text);
    }
  }
  return out.join("").trim();
}

// Ein Call: Bild + Analyse-Prompt rein, reiner Text raus.
function analyzeImage({ apiKey, prompt, imageBase64, imageType = "image/png", model = MODEL, effort = EFFORT, maxOutput = MAX_OUTPUT, timeoutMs = TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error("OPENAI_API_KEY ist nicht gesetzt"));
    if (!prompt) return reject(new Error("Analyse-Prompt fehlt"));
    if (!imageBase64) return reject(new Error("Referenzbild fehlt"));

    let settled = false;
    let killer = null;
    const done = (fn) => { if (settled) return; settled = true; if (killer) clearTimeout(killer); fn(); };

    const payload = JSON.stringify({
      model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: "data:" + imageType + ";base64," + imageBase64 },
        ],
      }],
      reasoning: { effort },
      max_output_tokens: maxOutput,
    });

    console.log("[studio-openai-text] -> POST https://" + HOST + PATH + " (image->text) | model=" + model + " effort=" + effort + " maxOut=" + maxOutput + " promptLen=" + prompt.length);

    const req = https.request({
      hostname: HOST, path: PATH, method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("error", (e) => done(() => reject(new Error("OpenAI-Antwort abgebrochen: " + e.message))));
      res.on("end", () => done(() => {
        let parsed;
        try { parsed = JSON.parse(raw); }
        catch { return reject(new Error("OpenAI lieferte kein JSON (HTTP " + res.statusCode + "): " + raw.slice(0, 200))); }

        if (res.statusCode !== 200) {
          const er = parsed.error || {};
          const tag = (er.code || er.type) ? " [" + (er.code || er.type) + "]" : "";
          const err = new Error((er.message || "HTTP " + res.statusCode) + tag);
          err.response = raw.slice(0, 2000);
          err.status = res.statusCode;
          console.error("[studio-openai-text] FEHLER " + res.statusCode + ":", raw.slice(0, 1000));
          return reject(err);
        }

        const u = parsed.usage || {};
        const reasoningTok = (u.output_tokens_details && u.output_tokens_details.reasoning_tokens) || 0;
        console.log("[studio-openai-text] <- status=" + parsed.status + " in=" + (u.input_tokens || 0) + " out=" + (u.output_tokens || 0) + " (davon reasoning " + reasoningTok + ")");

        // EIGENER FEHLERFALL, nicht als leeres Ausgabefeld durchreichen: Die
        // Reasoning-Tokens zaehlen gegen max_output_tokens. Reisst der Lauf das
        // Limit, ist status "incomplete" und der Text fehlt oder bricht ab —
        // obwohl der Call bezahlt ist. Das muss der Bediener im Klartext sehen.
        if (parsed.status === "incomplete") {
          const reason = (parsed.incomplete_details && parsed.incomplete_details.reason) || "unbekannt";
          const hint = reason === "max_output_tokens"
            ? " Die Reasoning-Tokens haben das Ausgabelimit von " + maxOutput + " aufgebraucht. Abhilfe: OPENAI_TEXT_MAX_OUTPUT höher setzen (aktuell " + maxOutput + ") oder OPENAI_TEXT_EFFORT senken."
            : "";
          const err = new Error("Antwort unvollständig (status: incomplete, Grund: " + reason + ")." + hint);
          err.incomplete = true;
          err.reason = reason;
          err.response = raw.slice(0, 2000);
          return reject(err);
        }

        if (parsed.status && parsed.status !== "completed") {
          const er = parsed.error || {};
          const err = new Error("OpenAI-Lauf endete mit status \"" + parsed.status + "\"" + (er.message ? ": " + er.message : ""));
          err.response = raw.slice(0, 2000);
          return reject(err);
        }

        const text = extractText(parsed);
        if (!text) {
          const err = new Error("OpenAI lieferte keinen Text (status " + parsed.status + ", keine output_text-Bloecke)");
          err.response = raw.slice(0, 2000);
          return reject(err);
        }
        return resolve({ text, model, effort, usage: u });
      }));
    });

    req.on("error", (e) => done(() => reject(new Error("OpenAI-Verbindung fehlgeschlagen: " + e.message))));
    killer = setTimeout(() => done(() => {
      req.destroy();
      reject(new Error("Zeitüberschreitung: OpenAI hat nicht innerhalb von " + Math.round(timeoutMs / 1000) + " s geantwortet"));
    }), timeoutMs);

    req.write(payload);
    req.end();
  });
}

module.exports = { analyzeImage, MODEL, EFFORT, MAX_OUTPUT, TIMEOUT_MS };
