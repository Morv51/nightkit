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

// Liefert IMMER ein strukturiertes Ergebnis zurueck (wirft nie), damit ein Endpunkt es
// direkt als JSON ausgeben kann. { ok, file, original, plan, result, view916, viewOriginal,
// estCost, error }.
async function run(mode) {
  const onlyFind = String(mode || "run").toLowerCase() === "find";
  const r = { ok: false, mode: onlyFind ? "find" : "run", model: MODEL };
  try {
    const file = findUrban91();
    if (!file) { r.error = "Template 'Urban 91' (Kategorie Urban) nicht gefunden"; log(r.error); return r; }
    r.file = file;
    r.viewOriginal = "/api/template-image?file=" + encodeURIComponent(file);

    // Masse ueber die Lese-Schicht (R2 mit Repo-Rueckfall).
    const buf = await templateSource.getTemplateFile(file);
    const meta = await sharp(buf).metadata();
    const w = meta.width, h = meta.height;
    const targetH = Math.round(w / TARGET);
    const extra = Math.max(0, targetH - h);
    const top = Math.floor(extra / 2), bottom = extra - top;
    r.original = { w, h, ratio: +(w / h).toFixed(4) };
    r.plan = { top, bottom, targetW: w, targetH: h + extra, targetRatio: +(w / (h + extra)).toFixed(4) };
    log("BESTAETIGUNG Datei: " + file + " | " + w + "x" + h + " (Verhaeltnis " + (w / h).toFixed(4) + ")");
    log("Plan 9:16: oben +" + top + " px, unten +" + bottom + " px, links/rechts 0 -> " + w + "x" + (h + extra));

    if (onlyFind) { r.ok = true; r.note = "Nur-Suche: kein fal-Aufruf, keine Kosten, nichts geschrieben."; return r; }
    if (extra <= 0) { r.error = "Bild ist bereits mindestens 9:16"; return r; }
    if (!process.env.FAL_KEY) { r.error = "FAL_KEY fehlt in der Umgebung"; log(r.error); return r; }

    // Teures Modell direkt ueber @fal-ai/client. image_url als data-URL (kein Upload noetig).
    const { fal } = require("@fal-ai/client");
    fal.config({ credentials: process.env.FAL_KEY });
    const dataUrl = "data:" + ctype(file) + ";base64," + buf.toString("base64");
    log("fal-Aufruf mit TEUREM Modell " + MODEL + " ...");
    const t0 = Date.now();
    let result;
    try {
      result = await fal.subscribe(MODEL, {
        input: { image_url: dataUrl, expand_top: top, expand_bottom: bottom, expand_left: 0, expand_right: 0, output_format: "png" },
      });
    } catch (e) {
      r.error = "fal-Aufruf fehlgeschlagen: " + fehlerText(e) + " (bei Forbidden/402 ist meist das fal-Guthaben leer)";
      log(r.error);
      return r;
    }
    const out = result && result.data ? result.data : result;
    const url = out && out.images && out.images[0] && out.images[0].url;
    if (!url) { r.error = "Kein Ergebnisbild von fal erhalten"; return r; }
    r.ms = Date.now() - t0;

    // Ergebnis laden + Masse messen.
    const res = await fetch(url);
    if (!res.ok) { r.error = "Ergebnis-Download fehlgeschlagen: HTTP " + res.status; return r; }
    const outBuf = Buffer.from(await res.arrayBuffer());
    let om = {}; try { om = await sharp(outBuf).metadata(); } catch (_) {}
    const oW = om.width || w, oH = om.height || (h + extra), oMP = (oW * oH) / 1e6;
    r.result = { w: oW, h: oH, ratio: +(oW / oH).toFixed(4), mp: +oMP.toFixed(2) };

    // ZUSAETZLICH nach R2 (Original bleibt unangetastet).
    const env = readS3Env();
    if (env.missing.length) { r.error = "R2-Variablen fehlen: " + env.missing.join(", "); return r; }
    const client = makeR2Client(env);
    await client.send(new PutObjectCommand({ Bucket: env.BUCKET, Key: OUT_KEY, Body: outBuf, ContentType: "image/png" }));
    r.key = OUT_KEY;
    r.view916 = "/api/template-image?file=" + encodeURIComponent(OUT_FILE);
    r.estCost = +(oMP * 0.03).toFixed(3); // flux-2-pro rechnet das ganze Bild, ca. 0,03 USD/MP
    r.ok = true;
    log("GESPEICHERT in R2: " + OUT_KEY + " | 9:16: " + r.view916 + " | ~$" + r.estCost);
    return r;
  } catch (e) {
    r.error = fehlerText(e);
    log("Fehler: " + r.error);
    return r;
  }
}

// ── Hintergrundlauf: der teure fal-Aufruf laeuft NICHT in der HTTP-Anfrage, sondern im
// Hintergrund. Der Endpunkt startet den Job und antwortet SOFORT; das Frontend fragt danach
// den Status ab. So kann die Klick-Anfrage nie haengen. Zustand im Speicher (Einzelinstanz-
// Annahme wie bei den uebrigen Admin-Overlays). ──
let job = null; // { status:"running"|"done"|"error", startedAt, result, error }

function startJob() {
  if (job && job.status === "running") return job; // laeuft schon: nicht doppelt starten
  job = { status: "running", startedAt: Date.now(), result: null, error: null };
  const cur = job;
  Promise.resolve()
    .then(() => run("run"))
    .then((r) => {
      if (r && r.ok) { cur.status = "done"; cur.result = r; }
      else { cur.status = "error"; cur.error = (r && r.error) || "unbekannter Fehler"; cur.result = r || null; }
      log("Job " + cur.status + (cur.error ? ": " + cur.error : ""));
    })
    .catch((e) => { cur.status = "error"; cur.error = fehlerText(e); log("Job-Fehler: " + cur.error); });
  return job;
}

function jobStatus() {
  if (!job) return { status: "idle" };
  const out = { status: job.status, startedAt: job.startedAt };
  if (job.result) out.result = job.result;
  if (job.error) out.error = job.error;
  return out;
}

module.exports = { run, startJob, jobStatus };

// Eigenstaendig startbar: node test-outpaint-916.js [find|run]
if (require.main === module) {
  run(process.argv[2] || "run").then((r) => {
    if (r && r.ok) { log("OK" + (r.view916 ? " | 9:16: " + r.view916 : "")); process.exit(0); }
    log("NICHT ausgefuehrt: " + ((r && r.error) || "unbekannt"));
    process.exit(1);
  });
}
