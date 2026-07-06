"use strict";

// FAL.ai-Client für den Outpaint (9:16-Nachzug und /api/reframe). Das Outpaint-
// Modell hängt AUSSCHLIESSLICH an der Konstante MODEL unten — zum Wechseln nur
// diese eine Zeile ändern, sonst nichts.
//
// Aktuell: image-apps-v2/outpaint. Es generiert laut fal NUR die erweiterten
// Ränder (die Streifen), nicht das ganze Bild neu → ca. Faktor 5-6 günstiger als
// das vorherige flux-2-pro/outpaint (das die vollen ~1,86 MP pro Bild abrechnete).
// Doku: https://fal.ai/models/fal-ai/image-apps-v2/outpaint/api
// Kosten: ca. 0,035 USD pro Megapixel, aber nur auf die Streifen berechnet.

const { fal } = require("@fal-ai/client");

const MODEL = "fal-ai/image-apps-v2/outpaint"; // 9:16-Nachzug; leicht austauschbar
const TIMEOUT_MS = 60 * 1000;

let configured = false;
function ensureConfigured() {
  if (configured) return;
  fal.config({ credentials: process.env.FAL_KEY });
  configured = true;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Erweitert das Bild um left/right/top/bottom Pixel je Seite und gibt die
// Ergebnis-Bild-URL zurück. Das Bild wird als data:-URL übergeben — FAL
// akzeptiert data-URIs direkt als image_url (kein Upload nötig).
// fal.subscribe wartet bis zum Ergebnis; Timeout nach 60s.
async function outpaint({ imageDataUrl, left = 0, right = 0, top = 0, bottom = 0, outputFormat = "png" }) {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY not configured");
  if (!imageDataUrl) throw new Error("Image required");
  ensureConfigured();

  const result = await withTimeout(
    fal.subscribe(MODEL, {
      input: {
        image_url: imageDataUrl,
        expand_left: left,
        expand_right: right,
        expand_top: top,
        expand_bottom: bottom,
        // image-apps-v2 hat einen Default-Zoom von 20 %, der das Bild verkleinern
        // und ringsum schwarze Ränder anlegen würde. Auf 0 setzen → reine Kanten-
        // Erweiterung, nur die Streifen oben/unten, kein Verkleinern des Motivs.
        zoom_out_percentage: 0,
        output_format: outputFormat,
      },
    }),
    TIMEOUT_MS,
    "Zeitüberschreitung nach 60 Sekunden. Bitte erneut versuchen.",
  );

  // Neuer @fal-ai/client verpackt den Output in result.data; ältere geben ihn
  // direkt zurück — beide Formen abfangen.
  const out = result && result.data ? result.data : result;
  const url = out && out.images && out.images[0] && out.images[0].url;
  if (!url) throw new Error("Kein Ergebnis-Bild von FAL");
  return { url };
}

module.exports = { outpaint, MODEL };
