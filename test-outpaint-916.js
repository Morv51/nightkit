"use strict";

// ISOLIERTER EINZELtest (kein Dauerbetrieb): bringt EIN bestehendes 2:3-Template per
// teurem fal-Modell (fal-ai/flux-2-pro/outpaint) auf 9:16 und legt das Ergebnis
// ZUSAETZLICH in R2 ab. Das Original wird NICHT angefasst.
//
// STRIKT isoliert:
// - Aendert NICHTS an ideogram.edit, den Auto-Flows, der Generierung, den Overlays,
//   der Lese-Schicht. Nutzt sie nur LESEND (templateSource.getTemplateFile).
// - Aendert die Modell-Konstante in lib/fal.js NICHT. Der teure fal-Aufruf laeuft hier
//   direkt ueber @fal-ai/client mit dem Modell fal-ai/flux-2-pro/outpaint, nur fuer
//   diesen einen Test. Der Normalbetrieb (image-apps-v2 in lib/fal.js) bleibt unberuehrt.
// - Schreibt NUR eine zusaetzliche Datei nach R2 (templates/_test916/...). Das "_" sorgt
//   dafuer, dass sie NICHT in Galerie/Verwaltung auftaucht; ueber /api/template-image ist
//   sie trotzdem ansehbar (R2-Lesepfad).
//
// Modi:
//   node test-outpaint-916.js find   -> nur Datei suchen + Plan loggen (KEIN fal, KEINE Kosten)
//   node test-outpaint-916.js run    -> voller Test (fal-Aufruf + Ablage in R2)
// Am Server gated ueber TEST_OUTPAINT_916 (Wert "find" oder "run"), siehe server.js.

const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("./lib/r2");
const templates = require("./lib/templates");           // nur lesend: list()/listRaw()
const templateSource = require("./lib/templateSource"); // nur lesend: getTemplateFile()
const sharp = require("sharp");

const P = "[TEST-916]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

const MODEL = "fal-ai/flux-2-pro/outpaint"; // BEWUSST das teure Modell, NUR fuer diesen Test
const TARGET = 0.5625;                        // 9:16
const OUT_FILE = "_test916/urban-91-916.png"; // zusaetzliche Ablage (Original bleibt)
const OUT_KEY = "templates/" + OUT_FILE;      // voller R2-Schluessel (Lesepfad: TPL_PREFIX)

// "Urban 91" (Kategorie Urban) robust finden: erst ueber den effektiven Anzeigenamen,
// sonst ueber den Dateinamen urban-91. Erst die Overlay-Liste, dann die Rohliste als Netz.
function findUrban91() {
  const pick = (arr) =>
    (arr.find((t) => t.category === "Urban" && t.name === "Urban 91")) ||
    (arr.find((t) => /(^|\/)urban-0*91\.(jpe?g|png)$/i.test(t.file)));
  let hit = null;
  try { hit = pick(templates.list()); } catch (_) {}
  if (!hit) { try { hit = pick(templates.listRaw()); } catch (_) {} }
  return hit ? hit.file : null;
}

function ctype(file) {
  const f = String(file).toLowerCase();
  return f.endsWith(".png") ? "image/png" : f.endsWith(".webp") ? "image/webp" : "image/jpeg";
}

async function run(mode) {
  const onlyFind = String(mode || "run").toLowerCase() === "find";

  const file = findUrban91();
  if (!file) { log("Template 'Urban 91' (Kategorie Urban) NICHT gefunden. Abbruch."); return; }

  // Masse ueber die Lese-Schicht (R2 mit Repo-Rueckfall).
  const buf = await templateSource.getTemplateFile(file);
  const meta = await sharp(buf).metadata();
  const w = meta.width, h = meta.height;
  const targetH = Math.round(w / TARGET);
  const extra = Math.max(0, targetH - h);
  const top = Math.floor(extra / 2), bottom = extra - top;
  log("BESTAETIGUNG Datei: " + file + " | " + w + "x" + h + " (Verhaeltnis " + (w / h).toFixed(4) + ")");
  log("Plan 9:16: oben +" + top + " px, unten +" + bottom + " px, links/rechts 0 -> " +
      w + "x" + (h + extra) + " (Verhaeltnis " + (w / (h + extra)).toFixed(4) + ")");

  if (onlyFind) { log("Nur-Suche-Modus: KEIN fal-Aufruf, KEINE Kosten, nichts geschrieben. Zum echten Lauf: TEST_OUTPAINT_916=run"); return; }
  if (extra <= 0) { log("Bild ist bereits mindestens 9:16, kein Outpaint noetig. Abbruch."); return; }
  if (!process.env.FAL_KEY) { log("FAL_KEY fehlt in der Umgebung. Abbruch (kein fal-Aufruf)."); return; }

  // Teures Modell direkt ueber @fal-ai/client. image_url als data-URL (kein Upload noetig).
  const { fal } = require("@fal-ai/client");
  fal.config({ credentials: process.env.FAL_KEY });
  const dataUrl = "data:" + ctype(file) + ";base64," + buf.toString("base64");
  log("fal-Aufruf mit TEUREM Modell " + MODEL + " ...");
  const t0 = Date.now();
  const result = await fal.subscribe(MODEL, {
    input: { image_url: dataUrl, expand_top: top, expand_bottom: bottom, expand_left: 0, expand_right: 0, output_format: "png" },
  });
  const out = result && result.data ? result.data : result;
  const url = out && out.images && out.images[0] && out.images[0].url;
  if (!url) { log("Kein Ergebnisbild von fal erhalten. Abbruch."); return; }
  log("fal fertig in " + ((Date.now() - t0) / 1000).toFixed(1) + " s.");

  // Ergebnis laden + Masse messen (fuer die Kostenrechnung).
  const res = await fetch(url);
  if (!res.ok) { log("Ergebnis-Download fehlgeschlagen: HTTP " + res.status); return; }
  const outBuf = Buffer.from(await res.arrayBuffer());
  let om = {}; try { om = await sharp(outBuf).metadata(); } catch (_) {}
  const oW = om.width || w, oH = om.height || (h + extra);
  const oMP = (oW * oH) / 1e6;
  log("Ergebnis-Masse: " + oW + "x" + oH + " (Verhaeltnis " + (oW / oH).toFixed(4) + ", " + oMP.toFixed(2) + " MP)");

  // ZUSAETZLICH nach R2 (Original bleibt unangetastet).
  const env = readS3Env();
  if (env.missing.length) { log("R2-Variablen fehlen (" + env.missing.join(", ") + "), kann Ergebnis nicht ablegen."); return; }
  const client = makeR2Client(env);
  await client.send(new PutObjectCommand({ Bucket: env.BUCKET, Key: OUT_KEY, Body: outBuf, ContentType: "image/png" }));
  log("GESPEICHERT in R2: " + OUT_KEY + "  (Original " + file + " unveraendert)");

  // Anschauen + Kostenschaetzung.
  log("ANSCHAUEN Original: /api/template-image?file=" + encodeURIComponent(file));
  log("ANSCHAUEN 9:16:     /api/template-image?file=" + encodeURIComponent(OUT_FILE));
  const est = oMP * 0.03; // flux-2-pro rechnet das GANZE Bild, ca. 0,03 USD/MP
  log("KOSTEN-Schaetzung: ~" + oMP.toFixed(2) + " MP x 0,03 USD/MP = ~$" + est.toFixed(3) +
      " (flux-2-pro verarbeitet das ganze Bild). Exakter Betrag im fal-Dashboard.");
}

module.exports = { run };

// Eigenstaendig startbar: node test-outpaint-916.js [find|run]
if (require.main === module) {
  run(process.argv[2] || "run").catch((e) => { log("Fehler: " + fehlerText(e)); process.exit(1); });
}
