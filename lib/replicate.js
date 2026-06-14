"use strict";

// Replicate-Client für sauberes Object-Removal (LaMa-Inpainting).
// Modell: zylim0702/remove-object — füllt maskierte Flächen content-aware mit
// Hintergrund auf, statt neuen Inhalt zu erfinden (Doku:
// https://replicate.com/zylim0702/remove-object).
//
// Maskenkonvention (LaMa): WEISS = entfernen/auffüllen, SCHWARZ = behalten —
// invers zur Ideogram-Edit-Maske.
//
// Kosten: Replicate LaMa ca. 0,0005 USD pro Lauf.

const https = require("https");

const HOST = "api.replicate.com";
const PREDICTIONS_PATH = "/v1/predictions";

// Feste Modell-Version (latest_version.id laut Replicate-API). Gepinnt, damit
// das Ergebnis reproduzierbar bleibt und nicht still mit dem Modell driftet.
const REMOVE_OBJECT_VERSION =
  "0e3a841c913f597c1e4c321560aa69e2bc1f15c65f8c366caafc379240efd8ba";

const POLL_INTERVAL_MS = 1500;   // Replicate arbeitet asynchron → Status pollen
const PREDICTION_TIMEOUT_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000; // pro einzelnem HTTP-Call

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ein JSON-HTTP-Call gegen die Replicate-API. Replicate akzeptiert sowohl
// "Bearer" als auch "Token"; die aktuelle Doku nutzt Bearer.
function requestJson({ token, method, path, body }) {
  return new Promise((resolve, reject) => {
    if (!token) return reject(new Error("REPLICATE_API_TOKEN not configured"));
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;

    const req = https.request(
      {
        hostname: HOST,
        path,
        method,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": payload.length } : {}),
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
            return reject(new Error("Replicate parse error: " + raw.slice(0, 200)));
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(parsed.detail || parsed.title || raw.slice(0, 300));
            err.response = raw.slice(0, 2000);
            return reject(err);
          }
          resolve(parsed);
        });
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("Replicate request timeout"));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Startet eine remove-object-Prediction und pollt bis zum Terminalzustand.
// image/mask werden als data:-URL (Base64) übergeben — Replicate akzeptiert
// data-URIs direkt als URI-Input, ein separater Upload entfällt.
// Gibt { url } der Ergebnis-Bild-URI zurück. Wirft bei Timeout (60 s) oder
// fehlgeschlagener Prediction mit klarer Meldung.
async function removeObject({ token, imageDataUrl, maskDataUrl }) {
  if (!imageDataUrl || !maskDataUrl) throw new Error("Image and mask required");

  const created = await requestJson({
    token,
    method: "POST",
    path: PREDICTIONS_PATH,
    body: {
      version: REMOVE_OBJECT_VERSION,
      input: { image: imageDataUrl, mask: maskDataUrl },
    },
  });

  // Poll-URL aus der Antwort übernehmen, sonst aus der Prediction-ID bauen.
  let getPath = `${PREDICTIONS_PATH}/${created.id}`;
  if (created.urls && created.urls.get) {
    const u = new URL(created.urls.get);
    getPath = u.pathname + u.search;
  }

  const deadline = Date.now() + PREDICTION_TIMEOUT_MS;
  let pred = created;
  while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled") {
    if (Date.now() > deadline) {
      throw new Error("Zeitüberschreitung nach 60 Sekunden. Bitte erneut versuchen.");
    }
    await sleep(POLL_INTERVAL_MS);
    pred = await requestJson({ token, method: "GET", path: getPath });
  }

  if (pred.status !== "succeeded") {
    throw new Error(pred.error ? String(pred.error) : `Replicate-Status: ${pred.status}`);
  }

  // Output ist eine einzelne URI (string); robust auch gegen Array-Form.
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!out || typeof out !== "string") throw new Error("Kein Ergebnis-Bild von Replicate.");
  return { url: out };
}

module.exports = { removeObject, REMOVE_OBJECT_VERSION };
