"use strict";

// BETA-BEFUELLWEG (Flyer generieren (Beta)). Strikt getrennt vom bestehenden
// Weg: lib/prompt.js (buildPrompt) und ideogram.edit() werden hier NICHT
// benutzt und nicht veraendert.
//
// Ablauf:
//   1. Vision-Call (gpt-5.6-sol) bestimmt je Platzhalter eine Box.
//   2. Pruefung: mehr Werte als Boxen -> ABBRUCH vor dem ersten bezahlten
//      Bild-Aufruf. Es gibt mit festen Boxen keine Flaeche fuer einen
//      ueberzaehligen Wert; ein Notbehelf (zwei Namen in eine Box) wuerde die
//      Typografie brechen.
//   3. Leere Platzhalter: EIN LaMa-Aufruf raeumt alle ihre Boxen zugleich.
//   4. Je befuellter Box ein eigener editMasked-Aufruf, PARALLEL (Deckel
//      GRENZE), alle auf demselben Ausgangsbild. Danach wird aus jedem
//      Teilergebnis nur die eigene Box uebernommen.
//
// ACHTUNG, entgegengesetzte Maskenkonventionen:
//   LaMa (Replicate):  WEISS = entfernen,  SCHWARZ = behalten
//   Ideogram editMasked: SCHWARZ = bearbeiten, WEISS = behalten
// Darum baut maskPng() beide Varianten aus denselben Boxen.

const sharp = require("sharp");
const ideogram = require("./ideogram");
const replicate = require("./replicate");
const openaiText = require("./studio/openaiText");

const P = "[BETA-FILL]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

// Der Erkennungs-Prompt. Sucht nach den EXAKTEN kanonischen Zeichenketten —
// die Templates werden darauf vereinheitlicht. Was nicht gefunden wird, wird
// uebersprungen und protokolliert, nicht geraten.
//
// CLUB LOGO ist der elfte Eintrag: slotsForEvent liefert ihn immer mit leerem
// Wert, und der alte Weg raeumt ihn ausdruecklich weg. Ohne ihn in dieser Liste
// bliebe er auf Templates stehen, die ihn zeigen — ein sichtbarer Rueckschritt
// gegenueber dem alten Weg.
const FIND_PROMPT = [
  "This is a 9:16 event flyer template. Find every occurrence of the following eleven placeholder strings in the image:",
  "HEADLINE, SUBLINE, 19.06.26, UHRZEIT, DJ NAME 1, DJ NAME 2, DJ NAME 3, CLUBNAME, LOCATION, www.website.com, CLUB LOGO",
  "",
  "For each one, return a JSON object with: the string, and a bounding box as x, y, width, height in fractions of the image dimensions (0 to 1, origin top left). If a string is set across more than one line, return one box that covers all of its parts.",
  "Omit any string you cannot find. Do not guess a position.",
  "",
  "Return only the JSON array, nothing else.",
].join("\n");

// Antwort einsammeln: das Modell liefert oft einen Code-Zaun drumherum.
function parseBoxes(text) {
  const roh = String(text == null ? "" : text).trim();
  const ohneZaun = roh.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let arr;
  try { arr = JSON.parse(ohneZaun); }
  catch {
    const m = /\[[\s\S]*\]/.exec(ohneZaun);      // Array aus Fliesstext schneiden
    if (!m) return null;
    try { arr = JSON.parse(m[0]); } catch { return null; }
  }
  if (!Array.isArray(arr)) return null;
  const raus = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const s = typeof e.string === "string" ? e.string : (typeof e.text === "string" ? e.text : "");
    const x = Number(e.x), y = Number(e.y), w = Number(e.width), h = Number(e.height);
    if (!s || ![x, y, w, h].every(Number.isFinite)) continue;
    if (w <= 0 || h <= 0) continue;
    raus.push({ string: s.trim(), x, y, width: w, height: h });
  }
  return raus;
}

async function detectBoxes({ apiKey, imageBase64, imageType }) {
  const res = await openaiText.analyzeImage({
    apiKey, prompt: FIND_PROMPT, imageBase64, imageType,
  });
  // VORGABE: die rohe Antwort landet im Protokoll. Suchbegriff "[BETA-FILL] vision raw:"
  log("vision raw: " + String(res.text || "").replace(/\s+/g, " ").slice(0, 4000));
  const boxes = parseBoxes(res.text);
  if (!boxes) throw new Error("Vision-Antwort war kein JSON-Array — siehe Protokoll unter \"[BETA-FILL] vision raw:\"");
  log("vision: " + boxes.length + " Boxen erkannt (" + boxes.map((b) => b.string).join(" | ") + ")");
  return boxes;
}

// Bruchteile -> ganze Pixel, in die Bildflaeche gezwungen. EINE Stelle, weil
// Maske und spaeterer Ausschnitt exakt gleich runden muessen — ein Pixel
// Unterschied und der Ausschnitt passt nicht zur bearbeiteten Flaeche.
function rechteck(b, width, height) {
  const x = Math.max(0, Math.min(width - 1, Math.round(b.x * width)));
  const y = Math.max(0, Math.min(height - 1, Math.round(b.y * height)));
  const w = Math.max(1, Math.min(width - x, Math.round(b.width * width)));
  const h = Math.max(1, Math.min(height - y, Math.round(b.height * height)));
  return { x, y, w, h };
}

// Eine Maske in Bildgroesse: Grundflaeche in einer Farbe, die Boxen in der
// anderen. invert=false -> Ideogram (weiss behalten, schwarz bearbeiten),
// invert=true -> LaMa (schwarz behalten, weiss entfernen).
async function maskPng({ width, height, boxes, invert }) {
  const grund = invert ? 0 : 255;
  const box = invert ? 255 : 0;
  const rechtecke = boxes.map((b) => {
    const r = rechteck(b, width, height);
    return { input: { create: { width: r.w, height: r.h, channels: 3, background: { r: box, g: box, b: box } } }, left: r.x, top: r.y };
  });
  return sharp({ create: { width, height, channels: 3, background: { r: grund, g: grund, b: grund } } })
    .composite(rechtecke)
    .png()
    .toBuffer();
}

// Prompt je Box: genau EIN Wert, keine Liste. Bewusst nah an buildAdjustPrompt,
// aber eigener Text — lib/prompt.js bleibt unberuehrt.
function boxPrompt(wert) {
  return [
    `Render exactly this text in the edited region: "${wert}".`,
    "Correct spelling, EVERY letter present, no missing, dropped or swapped letters; spell each word in full.",
    "Match the flyer's existing design at that spot: same letterforms, material and construction as the text already there, including its font, weight, style, effect, colour and size. If the existing text is made of a physical material or object rather than printed type, build the new text from that same material in the same way, seamlessly integrated with the surrounding artwork.",
  ].join("\n");
}

const alsDataUrl = (buf, typ) => `data:${typ || "image/png"};base64,${buf.toString("base64")}`;

// Ideogram erlaubt laut Doku standardmaessig 10 GLEICHZEITIGE Anfragen. Zehn
// Boxen waeren exakt der Anschlag — ohne Luft fuer einen zweiten Nutzer, der
// im selben Moment generiert. Darum ein Deckel deutlich darunter, per Env
// verstellbar, falls das Konto ein hoeheres Limit hat.
const GRENZE = Math.max(1, Math.min(8, Number(process.env.BETA_FILL_CONCURRENCY) || 4));

// Arbeiter-Pool: hoechstens GRENZE Aufrufe gleichzeitig. Ein fehlgeschlagener
// Aufruf wird EINMAL wiederholt (Aussetzer sind meist voruebergehend) und
// reisst die anderen nicht mit — sie laufen zu Ende, damit nichts halb
// Bezahltes verworfen wird.
async function fuelleParallel({ ideogramKey, basis, width, height, aufgaben, melde }) {
  const ergebnisse = new Array(aufgaben.length);
  const fehler = [];
  let naechste = 0, fertig = 0;

  async function eine(i) {
    const a = aufgaben[i];
    const maske = await maskPng({ width, height, boxes: [a.box], invert: false });
    for (let versuch = 1; versuch <= 2; versuch++) {
      try {
        const { url } = await ideogram.editMasked({
          apiKey: ideogramKey, prompt: boxPrompt(a.value), imageBuffer: basis, maskBuffer: maske,
        });
        const dl = await ideogram.download(url);
        ergebnisse[i] = dl.buffer;
        return;
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (versuch === 2) { fehler.push({ token: a.token, message: msg }); log("FEHLER " + a.token + ": " + msg); return; }
        log("Wiederholung fuer " + a.token + " nach: " + msg);
      }
    }
  }

  async function arbeiter() {
    for (;;) {
      const i = naechste++;
      if (i >= aufgaben.length) return;
      await eine(i);
      fertig++;
      melde({ phase: "fuellen", schritt: fertig, gesamt: aufgaben.length, token: aufgaben[i].token });
    }
  }

  log("fuelle " + aufgaben.length + " Boxen, hoechstens " + GRENZE + " gleichzeitig");
  await Promise.all(Array.from({ length: Math.min(GRENZE, aufgaben.length) }, arbeiter));
  return { ergebnisse, fehler };
}

// Aus jedem Teilergebnis NUR die eigene Box uebernehmen, alles andere bleibt
// das Ausgangsbild. Ideogram liefert ein volles Bild zurueck und darf ausserhalb
// der Maske abweichen — dieser Schritt schliesst das aus, wie compositeMask im
// Frontend. Die Ergebnisse werden vorher auf die Basismasse gezwungen, falls
// der Dienst anders skaliert zurueckgibt.
async function setzeZusammen({ basis, width, height, aufgaben, ergebnisse }) {
  const teile = [];
  for (let i = 0; i < aufgaben.length; i++) {
    const buf = ergebnisse[i];
    if (!buf) continue;
    const r = rechteck(aufgaben[i].box, width, height);
    const norm = await sharp(buf).resize(width, height, { fit: "fill" }).png().toBuffer();
    const stueck = await sharp(norm).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).png().toBuffer();
    teile.push({ input: stueck, left: r.x, top: r.y });
  }
  log("setze " + teile.length + " Ausschnitte auf das Ausgangsbild");
  return sharp(basis).composite(teile).png().toBuffer();
}

// slots: [{ token, value }] — token ist die kanonische Zeichenkette, value der
// einzusetzende Wert ("" = Platzhalter soll verschwinden).
// onFortschritt(schritt) meldet den Stand in den Job.
async function run({ openaiKey, ideogramKey, replicateToken, imageBuffer, imageType, slots, onFortschritt }) {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width, height = meta.height;
  if (!width || !height) throw new Error("Bildmasse nicht lesbar");

  const melde = (o) => { try { onFortschritt && onFortschritt(o); } catch (_) {} };
  melde({ phase: "vision" });

  const boxes = await detectBoxes({ apiKey: openaiKey, imageBase64: imageBuffer.toString("base64"), imageType });
  const boxNach = new Map(boxes.map((b) => [b.string, b]));

  // ── Fall 2: mehr Werte als Boxen -> ABBRUCH vor jedem bezahlten Bild-Aufruf ──
  const fehlend = slots.filter((s) => s.value && !boxNach.has(s.token)).map((s) => s.token);
  if (fehlend.length) {
    const e = new Error(
      "Das Template hat keine Fläche für: " + fehlend.join(", ") + ". "
      + "Mit festen Boxen lässt sich dafür kein Platz schaffen, ohne die Typografie zu brechen. "
      + "Bitte weniger Werte eintragen oder ein Template mit mehr Slots wählen."
    );
    e.noBox = true;
    e.fehlend = fehlend;
    throw e;
  }

  const zuFuellen = slots.filter((s) => s.value && boxNach.has(s.token));
  const zuLeeren = slots.filter((s) => !s.value && boxNach.has(s.token));
  log("Plan: " + zuFuellen.length + " zu befuellen, " + zuLeeren.length + " zu raeumen, "
    + (boxes.length - zuFuellen.length - zuLeeren.length) + " Boxen ohne Slot");

  let bild = imageBuffer;

  // ── Fall 1: leere Platzhalter in EINEM LaMa-Aufruf raeumen ──
  if (zuLeeren.length) {
    melde({ phase: "raeumen", boxen: zuLeeren.length });
    const maske = await maskPng({ width, height, boxes: zuLeeren.map((s) => boxNach.get(s.token)), invert: true });
    log("LaMa: raeume " + zuLeeren.map((s) => s.token).join(", "));
    const { url } = await replicate.removeObject({
      token: replicateToken,
      imageDataUrl: alsDataUrl(bild, imageType),
      maskDataUrl: alsDataUrl(maske, "image/png"),
    });
    const dl = await ideogram.download(url);
    bild = dl.buffer;
  }

  // ── Je Box ein eigener editMasked-Aufruf, PARALLEL ──
  //    Alle Aufrufe bekommen DASSELBE Ausgangsbild. Jeder liefert ein volles
  //    Bild zurueck, aus dem nur seine eigene Box uebernommen wird — genau wie
  //    das Frontend es bei adjust-text macht (compositeMask). Serielles Ketten
  //    waere nicht noetig, weil die Boxen voneinander unabhaengig sind.
  const aufgaben = zuFuellen.map((s) => ({ token: s.token, value: s.value, box: boxNach.get(s.token) }));
  const { ergebnisse, fehler } = await fuelleParallel({ ideogramKey, basis: bild, width, height, aufgaben, melde });

  // Teilergebnis AUSLIEFERN statt wegwerfen: was durchlief, wird zusammengesetzt,
  // die gescheiterten Felder werden gemeldet. Der Aufrufer macht daraus eine
  // deutliche Warnung — ein halbfertiger Flyer darf nicht als fertig gelten.
  bild = await setzeZusammen({ basis: bild, width, height, aufgaben, ergebnisse });
  const gelungen = ergebnisse.filter(Boolean).length;
  if (fehler.length) log("TEILERGEBNIS: " + gelungen + " von " + aufgaben.length + " gesetzt, offen: " + fehler.map((f) => f.token).join(", "));
  return { buffer: bild, boxes, gefuellt: gelungen, geraeumt: zuLeeren.length, fehler };
}

module.exports = { run, detectBoxes, parseBoxes, maskPng, boxPrompt, rechteck, setzeZusammen, FIND_PROMPT, GRENZE };
