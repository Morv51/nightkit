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
// Env (Hauptanalyse):
//   OPENAI_TEXT_MODEL       Default "gpt-5.6-sol"
//   OPENAI_TEXT_EFFORT      Default "medium"
//   OPENAI_TEXT_VERBOSITY   Default "medium" (low | medium | high)
//   OPENAI_TEXT_MAX_OUTPUT  Default 16000, wird nie unter 16000 gesetzt
//   OPENAI_TEXT_TIMEOUT_MS  Default 600000 (10 min)
//
// Env (kleiner Zweit-Call fuer den Genre/Vibe-Vorschlag):
//   OPENAI_CLASSIFY_MODEL       Default "gpt-5.6-luna"
//   OPENAI_CLASSIFY_EFFORT      Default "low"
//   OPENAI_CLASSIFY_VERBOSITY   Default "low"
//   OPENAI_CLASSIFY_MAX_OUTPUT  Default 4000
//   OPENAI_CLASSIFY_TIMEOUT_MS  Default 90000
//
// JEDE dieser Stufen-/Verbosity-Variablen darf LEER gesetzt werden. Leer heisst
// "Feld weglassen" — damit laesst sich ohne Deploy ein Modell ansteuern, das
// reasoning oder text nicht kennt (ein Nicht-Reasoning-Modell quittiert
// reasoning sonst mit einem 400er).

const https = require("https");

const HOST = "api.openai.com";
const PATH = "/v1/responses";

// Unterscheidet BEWUSST zwischen "nicht gesetzt" (Default gilt) und "leer
// gesetzt" (Feld weglassen) — || wuerde beides gleich behandeln.
const envOr = (name, fallback) => (process.env[name] === undefined ? fallback : process.env[name]);

// Verbosity steuert die AUSFUEHRLICHKEIT der Antwort. Hintergrund: der ueber die
// API erzeugte Produktionsprompt fiel gegenueber dem aus der ChatGPT-Oberflaeche
// zu komprimiert aus (mehrere Vorgaben pro Satz statt ein Block pro Element, was
// das Bildmodell nur teilweise verarbeitet). Default "medium" — das ist die
// Einstellung, mit der der brauchbare Prompt in der Oberflaeche entstand.
// Ein Wert ausserhalb der Liste faellt auf den Default zurueck, damit ein
// Tippfehler in der Render-Konfiguration nicht jeden Aufruf zerlegt.
const VERBOSITY_ALLOWED = ["low", "medium", "high"];
function pickVerbosity(v, fallback) {
  if (v === "") return "";                                  // bewusst leer -> Feld weglassen
  if (VERBOSITY_ALLOWED.indexOf(v) !== -1) return v;
  if (v != null) console.warn('[studio-openai-text] Unbekannte Verbosity "' + v + '" — nutze "' + fallback + '"');
  return fallback;
}

const MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5.6-sol";
const EFFORT = envOr("OPENAI_TEXT_EFFORT", "medium");
const VERBOSITY = pickVerbosity(envOr("OPENAI_TEXT_VERBOSITY", "medium"), "medium");

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

// Kleiner Zweit-Call (Genre/Vibe-Vorschlag): eigenes, guenstiges Modell auf
// niedriger Stufe. Die Antwort sind zwei Zeilen, darum kein Job-Muster — aber
// ein knappes Zeitlimit DEUTLICH unter dem 120-s-Socket aus server.js, damit ein
// Haenger als saubere Meldung ankommt statt als abgeschnittene Verbindung.
// max_output_tokens ist eine Obergrenze, kein Kostenfaktor: 4000 schuetzt davor,
// dass Reasoning-Tokens die zwei Zeilen auffressen.
const CLASSIFY_MODEL = process.env.OPENAI_CLASSIFY_MODEL || "gpt-5.6-luna";
const CLASSIFY_EFFORT = envOr("OPENAI_CLASSIFY_EFFORT", "low");
const CLASSIFY_VERBOSITY = pickVerbosity(envOr("OPENAI_CLASSIFY_VERBOSITY", "low"), "low");
const CLASSIFY_MAX_OUTPUT = Number(process.env.OPENAI_CLASSIFY_MAX_OUTPUT) || 4000;
const CLASSIFY_TIMEOUT_MS = Number(process.env.OPENAI_CLASSIFY_TIMEOUT_MS) || 90 * 1000;

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
function analyzeImage({ apiKey, prompt, instructions = "", imageBase64, imageType = "image/png", model = MODEL, effort = EFFORT, verbosity = VERBOSITY, maxOutput = MAX_OUTPUT, timeoutMs = TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error("OPENAI_API_KEY ist nicht gesetzt"));
    if (!prompt) return reject(new Error("Analyse-Prompt fehlt"));
    if (!imageBase64) return reject(new Error("Referenzbild fehlt"));

    let settled = false;
    let killer = null;
    const done = (fn) => { if (settled) return; settled = true; if (killer) clearTimeout(killer); fn(); };

    const koerper = {
      model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: "data:" + imageType + ";base64," + imageBase64 },
        ],
      }],
      max_output_tokens: maxOutput,
    };
    // Leerer Wert -> Feld faellt WEG (siehe Env-Hinweis oben). Gleiches gilt fuer
    // instructions: fehlt oder leer die Vorlagendatei, wird das Feld nicht gesendet.
    if (effort) koerper.reasoning = { effort };
    if (verbosity) koerper.text = { verbosity };
    if (instructions) koerper.instructions = instructions;
    const payload = JSON.stringify(koerper);

    console.log("[studio-openai-text] -> POST https://" + HOST + PATH + " (image->text) | model=" + model + " effort=" + (effort || "-") + " verbosity=" + (verbosity || "-") + " maxOut=" + maxOutput + " promptLen=" + prompt.length + " instrLen=" + (instructions ? instructions.length : 0));

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

module.exports = {
  analyzeImage,
  MODEL, EFFORT, VERBOSITY, MAX_OUTPUT, TIMEOUT_MS,
  CLASSIFY_MODEL, CLASSIFY_EFFORT, CLASSIFY_VERBOSITY, CLASSIFY_MAX_OUTPUT, CLASSIFY_TIMEOUT_MS,
};
