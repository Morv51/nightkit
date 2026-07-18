"use strict";

// Anthropic Vision für das Template Studio. Nutzt dieselbe Dependency + denselben
// API-Key wie lib/caption.js, aber mit Image-Content-Blocks (Vision). caption.js
// bleibt unangetastet.

const Anthropic = require("@anthropic-ai/sdk");

const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;

// Default Haiku (wie caption.js), umschaltbar auf Sonnet.
const MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5", // aktuelles Sonnet (das alte „claude-sonnet-4-6" wird abgelehnt)
};
const DEFAULT_MODEL = "haiku";

function isConfigured() {
  return !!client;
}

function modelId(key) {
  return MODELS[key] || MODELS[DEFAULT_MODEL];
}

// Robustes JSON-Parsing aus einer Modellantwort (entfernt evtl. ```json-Fences).
function parseJSON(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
  // Erst direkt, sonst den ersten {...}-Block extrahieren.
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  // [VISION-RAW] Temporaeres Diagnose-Logging (leicht entfernbar): den Rohtext der
  // fehlgeschlagenen Analyse zeigen, BEVOR der bekannte Fehler geworfen wird. Reines
  // Logging, der Fehlerpfad bleibt exakt gleich (der Fehler wird danach unveraendert geworfen).
  console.log("[VISION-RAW] FEHLGESCHLAGEN len=" + String(text || "").length + " head=" + JSON.stringify(String(text || "").slice(0, 800)));
  throw new Error("Konnte keine JSON-Antwort aus der Vision-Analyse lesen");
}

// [VISION-RAW] Temporaeres Diagnose-Logging (leicht entfernbar: diese Funktion + die
// zwei Aufrufe in visionCall/visionCallMulti + die FEHLGESCHLAGEN-Zeile in parseJSON
// loeschen). Zeigt die ROHE Claude-Antwort direkt vor dem Parsen. Reines Logging, keine
// Verhaltensaenderung; ein interner try/catch sorgt nur dafuer, dass das Logging selbst
// nie den Ablauf stoert.
function logVisionRaw(message) {
  try {
    const block = ((message && message.content) || []).find((b) => b.type === "text");
    const stop = message && message.stop_reason;
    if (!block) { console.log("[VISION-RAW] kein Textblock, stop_reason=" + stop); return; }
    const text = block.text || "";
    console.log("[VISION-RAW] stop_reason=" + stop + " len=" + text.length + " head=" + JSON.stringify(text.slice(0, 800)));
  } catch (_) {}
}

async function visionCall({ system, instruction, imageBase64, mediaType, model, maxTokens = 2000 }) {
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");
  const message = await client.messages.create({
    model: modelId(model),
    max_tokens: maxTokens,
    system,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: instruction },
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
      ],
    }],
  });
  const block = (message.content || []).find((b) => b.type === "text");
  logVisionRaw(message); // [VISION-RAW] Diagnose-Logging (temporaer, leicht entfernbar)
  return parseJSON(block ? block.text : "");
}

// Wie visionCall, aber mit EINEM ODER MEHREREN Bildern (für Modus 2 / Referenzen).
async function visionCallMulti({ system, instruction, images, model, maxTokens = 2000 }) {
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");
  const content = [{ type: "text", text: instruction }];
  for (const img of images || []) {
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
  }
  const message = await client.messages.create({
    model: modelId(model), max_tokens: maxTokens, system,
    messages: [{ role: "user", content }],
  });
  const block = (message.content || []).find((b) => b.type === "text");
  logVisionRaw(message); // [VISION-RAW] Diagnose-Logging (temporaer, leicht entfernbar)
  return parseJSON(block ? block.text : "");
}

// Treue Farb-/Hintergrund-Erfassung (Korrektur): echten Hintergrund übernehmen
// (hell/farbig statt default-schwarz) + Farbsparsamkeit JE EINZEL-Stück erfassen.
const COLOR_FIDELITY =
  "Capture the COLORS FAITHFULLY. Identify the ACTUAL background treatment: if the reference(s) use light " +
  "or colored backgrounds (e.g. pastel blue, mint, olive, cream), record a LIGHT/COLORED background — do " +
  "NOT default to black or dark backgrounds unless the references are truly dark. Note how FEW colors are " +
  "used per single design: these references are minimal — typically ONE colored background + ONE " +
  "contrasting color for the illustration + one or two colors for text. Record a LIMITED palette of very " +
  "few colors, NOT a rainbow of many bright colors. For a moodboard, capture the PER-PIECE simplicity, NOT " +
  "the combined variety across all the pieces. color_world MUST reflect the real background AND this restraint. ";

// ── Modus 2: Moodboard → Stil-DNA ────────────────────────────────
const MOODBOARD_SYSTEM =
  "You are an art director extracting the STYLE DNA from a moodboard so a NEW, " +
  "ORIGINAL club event flyer can be created in the same spirit. Describe ONLY the " +
  "abstract visual style for reinterpretation — the LOOK, never the CONTENT. Do " +
  "NOT transcribe or describe any text, names, dates, logos, or the specific " +
  "objects/people/scenes shown; those must NOT be reproduced. Describe imagery_style " +
  "as an abstract aesthetic (e.g. 'grainy analog flash photography', 'high-contrast " +
  "duotone print') and typography_character as a font feel (e.g. 'condensed brutalist " +
  "sans, all caps'), not the actual words. " +
  "IMPORTANT: a moodboard is a COLLAGE of many separate reference pieces. Extract ONLY " +
  "the shared visual language across them (color palette, typographic character, " +
  "texture, mood, illustration style). Do NOT describe the collage layout, the number " +
  "of pieces, the grid/sticker/tile arrangement, or that there are multiple items — the " +
  "arrangement of the moodboard is NOT part of the style to reproduce. 'composition' and " +
  "'visual_hierarchy' must describe a SINGLE cohesive poster layout, never a grid or " +
  "collage of tiles. " + COLOR_FIDELITY + "Reply with STRICT JSON only (no markdown, " +
  "no commentary) using EXACTLY these keys: look_mood, color_world, imagery_style, " +
  "typography_character, composition, visual_hierarchy, texture_grain_light, " +
  "editorial_club_look. Each value is one concise English phrase usable directly " +
  "inside an image-generation prompt.";

async function analyzeMoodboard({ imageBase64, mediaType, model }) {
  return visionCall({
    system: MOODBOARD_SYSTEM,
    instruction: "Extract the style DNA of this moodboard as JSON for reinterpretation.",
    imageBase64, mediaType, model,
  });
}

// ── Modus 2: Referenzart-spezifische Stil-Analyse (1 oder mehrere Bilder) ──
// Wiederverwendbare Bausteine (auch fuer die erweiterte Auto-Flow-2-Analyse).
const TYPO_CHAR_HINT =
  "For typography_character, be SPECIFIC about the HEADLINE lettering — its weight, " +
  "shape / personality, casing and any effect or treatment (e.g. outline, glow, distressed, chrome, script) — " +
  "as well as the secondary-text typography, so both can be mirrored. ";
const NEUTRAL_WORDING =
  "Describe a FAITHFUL, not exaggerated, style. " +
  "Use NEUTRAL, fashion / editorial / business wording throughout: describe any people or clothing only as " +
  "'fashionable', 'elegant', 'stylish', 'modern', 'confident', 'editorial' or 'party' looks. Do NOT use body- " +
  "or revealing-related words (e.g. sensual, sultry, seductive, sexy, revealing, tight, skin, bare, exposed, " +
  "bikini, lingerie, underwear, hot) — keep the actual visual style intact, just in neutral wording.";

const STYLE_KEYS_TAIL =
  COLOR_FIDELITY +
  "Reply with STRICT JSON only (no markdown, no commentary) using EXACTLY these keys: look_mood, " +
  "color_world, imagery_style, typography_character, composition, visual_hierarchy, texture_grain_light, " +
  "editorial_club_look. " + TYPO_CHAR_HINT + "Each value is one concise English " +
  "phrase usable directly inside an image-generation prompt. " + NEUTRAL_WORDING;

// ── Leitidee-Stufe (nur Auto-Flow 1-3, opt-in via leitidee=true). Erfasst die KOMPOSITION /
//    Verhaeltnisse der Referenz (nicht nur die Bauteile) und wird im Bildprompt VORANGESTELLT.
//    Modus 2 nutzt weiter STYLE_KEYS_TAIL (unveraendert). ──
// stil_kategorie + fehlende_rollen dienen NUR dem Regelwerk-Abgleich (Auswahl der passenden
// Regeln). Sie gehen NIE selbst in den Bildprompt — der Prompt-Bauer liest ausschliesslich die
// Felder, die er ausdruecklich kennt. Ohne Regelwerk-Schalter bleiben sie also folgenlos.
const LEITIDEE_KEYS = "leitidee, fuellgrad, blickfang, rangfolge, lautstaerke, motiv_darstellung, " +
  "stil_kategorie, fehlende_rollen, ";
const LEITIDEE_SPEC =
  "leitidee is ONE or two sentences describing, the way a graphic designer would, WHY the reference works — " +
  "its guiding idea and character (the RELATIONSHIPS: how much air, where the eye lands first, what " +
  "subordinates to what), NOT a list of what it contains. " +
  "fuellgrad is an INTEGER percentage — the roughly estimated share of the canvas AREA covered by content " +
  "versus empty space (e.g. 25 = airy with lots of empty space, 85 = dense and full). " +
  "blickfang names the SINGLE element the eye lands on FIRST and WHY (its size, colour, position or isolation). " +
  "rangfolge lists the main elements in order of visual importance, most important first. " +
  "lautstaerke says how loud / assertive the overall design is, from 'restrained' to 'loud', with a short " +
  "reason. " +
  "motiv_darstellung is EXACTLY one of 'fotografie', 'illustration', 'zeichnung', 'vektor' or 'gemischt' — " +
  "HOW the reference renders its MOTIF (the person / vehicle / object). Judge this from the reference ONLY and " +
  "be precise: a high-contrast, black-and-white or cut-out PHOTOGRAPH is still 'fotografie' — never call it " +
  "'zeichnung' or 'illustration' just because it is high-contrast, monochrome or cut out. A hand-drawn motif is " +
  "'zeichnung', a flat vector graphic is 'vektor', and 'gemischt' only when the reference genuinely combines " +
  "media. " +
  "stil_kategorie is EXACTLY ONE of these values, nothing else: grunge, elegant, minimal, neon, retro, " +
  "streetstyle, glamour, sonstige. Choose the ONE that best fits THIS reference; use 'sonstige' only when " +
  "none genuinely fits. " +
  "fehlende_rollen is an ARRAY naming which of the four roles 'djs', 'location', 'uhrzeit', 'datum' do NOT " +
  "appear on this reference AT ALL — use exactly those four spellings, and an EMPTY array when all four are " +
  "present. A role counts as missing ONLY when it is genuinely not shown; never list a role just because it " +
  "is small, plain or unobtrusive. " +
  "Read leitidee, fuellgrad, blickfang, rangfolge, lautstaerke, motiv_darstellung, stil_kategorie and " +
  "fehlende_rollen FAITHFULLY from THIS reference — NEVER a default: a restrained reference must give " +
  "restrained values, a loud one loud values. ";

// Gemeinsamer Spec-Baustein der Auto-Flow-2-Typo-Analyse (text_elements + Varianz).
const TYPO_SPEC =
  "text_elements is an ARRAY with ONE object per text role, in this order and using EXACTLY these role " +
  "values: headline, subline, datum, uhrzeit, dj_namen, location, clubname, website. Each object has EXACTLY " +
  "these keys: role; sample (a SHORT, GENERIC example text with a plausible word length for that role — " +
  "invent NEUTRAL placeholder-style wording, NEVER a real club, label, brand, festival or real DJ / person " +
  "name, no real trademarks; e.g. a headline like 'NIGHT SIGNAL', a DJ line like 'DJ ORBIT', a location like " +
  "'Hall Nord', a club like 'Club Vega'); type_class (font class, e.g. 'grotesque sans', 'slab serif', " +
  "'condensed display', 'monospace', 'handwritten script'); weight ('light' | 'regular' | 'medium' | 'bold' | " +
  "'black'); slant ('upright' | 'italic'); tracking (letter-spacing: 'tight' | 'normal' | 'wide' | 'spaced " +
  "caps'); effect ('none' | 'outline' | 'soft glow' | 'drop shadow' | 'gradient fill' | 'chrome' | other); " +
  "colour (the ACTUAL colour of THIS text element as it appears in the reference, e.g. 'white', 'black', " +
  "'cream', 'burnt orange'; if it sits on a coloured area, name both, e.g. 'white on a red panel'. Judge THIS " +
  "element's OWN colour from the reference — do NOT fall back to the most common text colour on the flyer); " +
  "size_pct (INTEGER — this element's size relative to the headline in percent, headline itself = 100); align " +
  "('left' | 'center' | 'right'). " +
  "The dj_namen object ADDITIONALLY has a group_treatment key: ONE concise English phrase describing how the " +
  "reference sets the DJ names AS A WHOLE GROUP — e.g. a shared panel or area, a rotation, colour alternation " +
  "between the lines, a size stepping across the names — so the lineup is one DESIGNED group, not three " +
  "identical stacked lines. For EVERY OTHER role set group_treatment to an empty string ''. " +
  "Judge every attribute FAITHFULLY from the reference. " +
  "typographic_variance is EXACTLY one of 'high', 'medium' or 'low', describing how strongly the SECONDARY " +
  "texts (everything except the headline) differ from EACH OTHER in size, weight and slant: 'high' = visibly " +
  "different treatments per element; 'low' = they look uniform. Judge this from the reference, do NOT default. ";

// Erweiterter Analyse-Tail NUR fuer Auto-Flow 2 (opt-in via typo=true).
const TYPO_KEYS_TAIL =
  COLOR_FIDELITY +
  "Reply with STRICT JSON only (no markdown, no commentary) using EXACTLY these keys: look_mood, " +
  "color_world, imagery_style, typography_character, composition, visual_hierarchy, texture_grain_light, " +
  "editorial_club_look, text_elements, typographic_variance. " +
  TYPO_SPEC +
  TYPO_CHAR_HINT + "Each of the 8 style values is one concise English phrase usable directly inside an " +
  "image-generation prompt. " + NEUTRAL_WORDING;

// Leitidee-Varianten (Auto-Flow 1-3). Leitidee-Felder ZUERST, dann die Stil-Keys (+ typo).
const STYLE_KEYS_TAIL_LEIT =
  COLOR_FIDELITY +
  "Reply with STRICT JSON only (no markdown, no commentary) using EXACTLY these keys: " + LEITIDEE_KEYS +
  "look_mood, color_world, imagery_style, typography_character, composition, visual_hierarchy, " +
  "texture_grain_light, editorial_club_look. " + LEITIDEE_SPEC + TYPO_CHAR_HINT +
  "Each of the eight STYLE phrases (look_mood through editorial_club_look) is one concise English phrase " +
  "usable directly inside an image-generation prompt. " + NEUTRAL_WORDING;
const TYPO_KEYS_TAIL_LEIT =
  COLOR_FIDELITY +
  "Reply with STRICT JSON only (no markdown, no commentary) using EXACTLY these keys: " + LEITIDEE_KEYS +
  "look_mood, color_world, imagery_style, typography_character, composition, visual_hierarchy, " +
  "texture_grain_light, editorial_club_look, text_elements, typographic_variance. " +
  LEITIDEE_SPEC + TYPO_SPEC + TYPO_CHAR_HINT +
  "Each of the eight STYLE phrases (look_mood through editorial_club_look) is one concise English phrase " +
  "usable directly inside an image-generation prompt. " + NEUTRAL_WORDING;

const SINGLE_INTRO =
  "You are an art director extracting the STYLE DNA from a SINGLE reference image (one flyer/design used " +
  "purely as inspiration) so a NEW, ORIGINAL club event flyer can be created in the same spirit. Stay " +
  "CLOSE to the reference: faithfully capture its look, color_world, typography_character, texture, mood " +
  "AND its composition logic / layout approach. BUT the result must remain a NEW flyer — do NOT copy or " +
  "transcribe its text, names, dates, logos or specific objects/people; those must NOT be reproduced. ";
const MULTIPLE_INTRO =
  "You are an art director extracting the SHARED STYLE DNA across MULTIPLE reference images so a NEW, " +
  "ORIGINAL club event flyer can be created in their common spirit. Extract ONLY the shared visual " +
  "denominator across ALL of the images (the common color palette, typographic character, texture, mood, " +
  "illustration style). Do NOT copy any single image's content, text, logos or specific objects, do NOT " +
  "describe the images individually, and do NOT reproduce a grid/collage. 'composition' and " +
  "'visual_hierarchy' must describe a SINGLE cohesive poster layout. ";

const SINGLE_SYSTEM = SINGLE_INTRO + STYLE_KEYS_TAIL;
const MULTIPLE_SYSTEM = MULTIPLE_INTRO + STYLE_KEYS_TAIL;
// typo-Varianten (nur Auto-Flow 2). moodboard braucht keine typo-Variante (Flow 2 = single).
const SINGLE_SYSTEM_TYPO = SINGLE_INTRO + TYPO_KEYS_TAIL;
const MULTIPLE_SYSTEM_TYPO = MULTIPLE_INTRO + TYPO_KEYS_TAIL;
// Leitidee-Varianten (Auto-Flow 1-3): mit und ohne typo.
const SINGLE_SYSTEM_LEIT = SINGLE_INTRO + STYLE_KEYS_TAIL_LEIT;
const MULTIPLE_SYSTEM_LEIT = MULTIPLE_INTRO + STYLE_KEYS_TAIL_LEIT;
const SINGLE_SYSTEM_TYPO_LEIT = SINGLE_INTRO + TYPO_KEYS_TAIL_LEIT;
const MULTIPLE_SYSTEM_TYPO_LEIT = MULTIPLE_INTRO + TYPO_KEYS_TAIL_LEIT;

const REF_SYSTEM = { moodboard: MOODBOARD_SYSTEM, single: SINGLE_SYSTEM, multiple: MULTIPLE_SYSTEM };
const REF_SYSTEM_TYPO = { moodboard: MOODBOARD_SYSTEM, single: SINGLE_SYSTEM_TYPO, multiple: MULTIPLE_SYSTEM_TYPO };
const REF_SYSTEM_LEIT = { moodboard: MOODBOARD_SYSTEM, single: SINGLE_SYSTEM_LEIT, multiple: MULTIPLE_SYSTEM_LEIT };
const REF_SYSTEM_TYPO_LEIT = { moodboard: MOODBOARD_SYSTEM, single: SINGLE_SYSTEM_TYPO_LEIT, multiple: MULTIPLE_SYSTEM_TYPO_LEIT };

// Eine ODER mehrere Referenzen → Stil-DNA, je nach refType ("moodboard" |
// "single" | "multiple"). images: [{ base64, mediaType }]. typo=true (nur Auto-Flow 2)
// fordert zusaetzlich text_elements (Typo je Rolle + Beispieltext) + typographic_variance.
// leitidee=true (Auto-Flow 1-3) stellt die Leitidee + vier Kompositions-Felder VORAN.
async function analyzeReference({ images, refType, model, typo, leitidee }) {
  const table = leitidee
    ? (typo ? REF_SYSTEM_TYPO_LEIT : REF_SYSTEM_LEIT)
    : (typo ? REF_SYSTEM_TYPO : REF_SYSTEM);
  const sys = table[refType] || table.moodboard || MOODBOARD_SYSTEM;
  const instruction = refType === "single"
    ? "Extract the style DNA of this single reference image as JSON for a faithful reinterpretation."
    : refType === "multiple"
    ? "Extract the SHARED style DNA across these reference images as JSON for reinterpretation."
    : "Extract the style DNA of this moodboard as JSON for reinterpretation.";
  // typo-Schema ist deutlich groesser (8 Textrollen x 9 Attribute) -> mehr Kopffreiheit,
  // sonst schneidet das JSON ab. Leitidee-Felder brauchen etwas zusaetzlichen Platz.
  const maxTokens = (typo ? 4000 : 2000) + (leitidee ? 800 : 0);
  return visionCallMulti({ system: sys, instruction, images, model, maxTokens });
}

// ── Modus 2: Varianten-Vorgaben aus dem AKTUELLEN Stil-Anker (Text-Call, kein
//    Bild). Erzeugt N verschiedene {color_world, imagery_style, layout}, die ALLE
//    INNERHALB des Ankers liegen — kein stil-fremdes Hartkodieren mehr. ──
const VARIANT_SYSTEM =
  "You are an art director creating distinct variations of ONE club event flyer, all within ONE fixed " +
  "style. You receive the STYLE ANCHOR (its style DNA). Produce the requested number of DISTINCT variations " +
  "that ALL stay strictly INSIDE this style — same mood, typography, texture, illustration / rendering " +
  "style and the same energy / colour intensity (whatever the anchor has — bold stays bold, restrained " +
  "stays restrained). Vary ONLY three things, and keep each WITHIN the anchor: " +
  "(1) color_world — a specific color combination drawn ONLY from this anchor's own palette / colour world " +
  "(never introduce colours foreign to the anchor; if the anchor is dark/metallic, stay dark/metallic; if " +
  "it is light/pastel, stay light/pastel); (2) imagery_style — a different illustration motif / subject, but " +
  "rendered in the EXACT same illustration / rendering style as the anchor (change only the subject, never " +
  "the rendering style); IF the subject is or includes a person/figure, ALSO vary the depicted person across " +
  "the variations — including GENDER (mix male and female subjects) and appearance / look — while keeping the " +
  "same style, mood and quality (if the anchor shows no person, this simply does not apply); " +
  "(3) layout — a BOLD, art-directed composition arrangement: place the DOMINANT " +
  "headline differently (top, centre or bottom) and arrange the secondary text grouped / offset / asymmetric " +
  "but balanced (not a plain left-aligned stacked column), one big subject + text + negative space. Make the " +
  "LAYOUTS visibly different from one another across the variations, but all unmistakably the same style " +
  "family. Give each a short human label like 'bronze on teal · palm silhouette · headline bottom'. Reply " +
  'with STRICT JSON only (no markdown): { "variants": [ { "label": "...", "color_world": "...", ' +
  '"imagery_style": "...", "layout": "..." } ] }.';

// Einzelne flache {…}-Objekte aus (evtl. abgeschnittenem / umschlossenem) Text
// bergen — je Objekt separat parsen, ein unvollständiges letztes einfach überspringen.
// Rettet die Varianten, wenn das Gesamt-JSON nicht als Ganzes parst.
function salvageObjects(text) {
  const out = [];
  const re = /\{[^{}]*\}/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    try { const o = JSON.parse(m[0]); if (o && typeof o === "object") out.push(o); } catch {}
  }
  return out;
}

// Varianten-Vorgaben rein aus dem Stil-Anker (TEXT/dna) — KEIN Referenzbild nötig.
// Gehärtet: viel Token-Kopffreiheit (kein Abschneiden bei bis zu 24), tolerante
// Feldnamen, Rettung einzelner Objekte bei kaputtem Gesamt-JSON, ein Wiederholversuch
// bei leerem Ergebnis. So scheitert nicht der ganze Varianten-Satz an einem Aussetzer.
async function generateVariationSpecs({ dna, count, model }) {
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");
  const n = Math.max(1, Math.min(24, parseInt(count, 10) || 10));
  const anchor = JSON.stringify(dna || {}, null, 2);
  const s = (x) => (typeof x === "string" ? x.trim() : "");
  const pick = (x, ...keys) => { for (const k of keys) { const v = s(x && x[k]); if (v) return v; } return ""; };

  async function attempt() {
    const message = await client.messages.create({
      model: modelId(model),
      max_tokens: 8000, // Kopffreiheit für bis zu 24 Varianten → kein abgeschnittenes JSON
      system: VARIANT_SYSTEM,
      messages: [{
        role: "user",
        content: [{ type: "text", text:
          `STYLE ANCHOR (stay strictly within this — do NOT introduce anything outside it):\n${anchor}\n\n` +
          `Produce exactly ${n} distinct variations. Reply with STRICT JSON only, no prose.` }],
      }],
    });
    const block = (message.content || []).find((b) => b.type === "text");
    const text = block ? block.text : "";
    let arr = [];
    try {
      const parsed = parseJSON(text);
      arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.variants) ? parsed.variants : []);
    } catch {
      arr = salvageObjects(text); // abgeschnitten/umschlossen → einzelne Objekte bergen
    }
    return arr.slice(0, n).map((x) => ({
      label: pick(x, "label"),
      color_world: pick(x, "color_world", "colorWorld", "colors", "color", "palette"),
      imagery_style: pick(x, "imagery_style", "imageryStyle", "imagery", "subject", "motif"),
      layout: pick(x, "layout", "composition", "arrangement"),
    })).filter((x) => x.color_world || x.imagery_style || x.layout);
  }

  let specs = await attempt();
  if (!specs.length) specs = await attempt(); // einmalige Wiederholung bei Aussetzer
  return specs;
}

// ── Clean-Flow (eigenstaendig): EIN Bild-Aufruf -> N Varianten-FARBWELTEN als Kollektion.
//    RADIKAL vereinfacht: Sonnet generiert NUR noch Farbwelten. Alles andere (vibe_anchor,
//    imagery_style, layout) wurde entfernt, weil jede generierte Beschreibung etwas Schaedliches
//    einschleppte (Anordnungs-Bauplaene, Kleidungs-/Frisurdetails, Positionsangaben, sogar Logos).
//    Das Bildmodell SIEHT das Original ueber editImage; es braucht keine Beschreibung der Bauteile.
//    KEINE Anordnungsregeln, kein Zonen-Zwang — das ist NICHT das Regelwerk. ──
const CLEAN_VARIANT_SYSTEM =
  "You are an art director. You receive ONE club event flyer as an image. Design a COLLECTION of matching " +
  "COLOUR WORLDS for variations of it, with a clear red thread so they belong together. " +
  "Give ONLY a colour world per variation — a specific colour combination, e.g. \"deep crimson and charcoal with " +
  "silver accents\". Describe NOTHING else: no layout, no subject, no imagery, no positions. " +
  "PROGRESSION: variation 1 stays CLOSE to the original's colours — a light, fresh take, NOT a clone. Each " +
  "further variation drifts progressively further while the whole set stays a coherent family. " +
  "Reply with STRICT JSON only (no markdown): { \"variants\": [ { \"label\": \"…\", \"color_world\": \"…\" } ] }.";

// -> { variants:[{ label, color_world }] }. Robustheit wie generateVariationSpecs: tolerante
// Feldnamen, Rettung einzelner Objekte bei kaputtem Gesamt-JSON, ein Wiederholversuch bei leer.
async function cleanVariantSpecs({ imageBase64, mediaType, count, model }) {
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");
  const n = Math.max(1, Math.min(10, parseInt(count, 10) || 5));
  const s = (x) => (typeof x === "string" ? x.trim() : "");
  const pick = (x, ...keys) => { for (const k of keys) { const v = s(x && x[k]); if (v) return v; } return ""; };

  async function attempt() {
    const message = await client.messages.create({
      model: modelId(model),
      max_tokens: 2000, // nur noch Farbwelten -> kompakt
      system: CLEAN_VARIANT_SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Here is the original flyer. Design exactly " + n + " matching colour worlds as " +
            "one family, variation 1 close to the original's colours. Reply with STRICT JSON only, no prose." },
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
        ],
      }],
    });
    const block = (message.content || []).find((b) => b.type === "text");
    const text = block ? block.text : "";
    let arr = [];
    try {
      const parsed = parseJSON(text);
      arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.variants) ? parsed.variants : []);
    } catch { arr = salvageObjects(text); }
    const variants = arr.slice(0, n).map((x) => ({
      label: pick(x, "label"),
      color_world: pick(x, "color_world", "colorWorld", "colors", "color", "palette"),
    })).filter((x) => x.color_world);
    return { variants };
  }

  let out = await attempt();
  if (!out.variants.length) out = await attempt();
  return out;
}

// ── Varianten-Prompts: EIN Referenzbild → GENAU n komplette Text-Prompts für
//    Varianten DESSELBEN Flyers (nur Text, keine Bilderzeugung). KONSTANT: Genre,
//    Grundstimmung, Farbpalette. VARIABEL: Komposition über 10 benannte Layout-
//    Archetypen (einer je Prompt) + Motiv moderat, jeweils hochwertig gestaltet.
//    EIN Sonnet-Aufruf; Robustheit wie bei den Varianten-Specs. ──
const VARIANT_PROMPTS_SYSTEM =
  "You are an art director. You receive ONE finished club event flyer as an image. Produce alternative " +
  "text-to-image PROMPTS, each describing a VARIANT of THIS SAME flyer, so they read as one clearly related " +
  "series while giving a real choice. " +
  "FIRST identify, from the image, the flyer's CARRYING visual elements (its main motifs, graphic devices and " +
  "how it is composed) AND its COLOUR PALETTE and colour mood. " +
  "HOLD CONSTANT across ALL variants (this is the fixed 'vibe'): the GENRE and occasion of the flyer, the " +
  "general MOOD LEVEL of the original (whatever it is — for example dark and moody, or bright and playful), the " +
  "vertical 9:16 aspect ratio, and ABOVE ALL the COLOUR WORLD — keep the colour palette and colour mood almost " +
  "IDENTICAL to the original in every one of the variants, only minimal nuances allowed. Colour is the CONSTANT, " +
  "not the variable: do NOT recolour the flyer, do NOT introduce colours foreign to the original palette. " +
  "ALSO HOLD CONSTANT (strict, non-negotiable): the professional flyer STRUCTURE and the high production QUALITY " +
  "of the original. Every one of the variants must read as a polished, agency-made, ready-to-sell CLUB / event " +
  "flyer, NOT as fine art, a horror poster, a chaotic art piece or an obviously AI-generated image. Word EACH " +
  "prompt with concrete professional design principles that a picture model responds to: a clear typographic " +
  "HIERARCHY (one dominant headline, a clearly subordinate subline, and a cleanly set, well-organised info block " +
  "carrying the placeholder date, DJ names, location, clubname and website); deliberate use of NEGATIVE SPACE / " +
  "breathing room instead of an overfilled surface; ONE defined visual FOCAL POINT; clean, consistent MARGINS " +
  "and grid-based ALIGNMENT; balanced visual weight; strong READABILITY of every text; and print-ready, " +
  "professional graphic-design polish. " +
  "KEY VARIATION LEVER — give the variants DIFFERENT, clearly named LAYOUT ARCHETYPES so they are " +
  "compositionally FUNDAMENTALLY different, not the same grid ten times with another motif. Assign the " +
  "archetypes ONE PER PROMPT, in this exact order (prompt 1 = archetype 1, prompt 2 = archetype 2, and so on), " +
  "and have each prompt CONCRETELY realise its archetype as an image composition: " +
  "1) main motif at the TOP, large headline typography at the BOTTOM; " +
  "2) full-bleed motif filling the frame, typography as a centred OVERLAY; " +
  "3) DIAGONAL split of the image, typography on one half; " +
  "4) TEXT-DOMINANT, with a small motif as an accent; " +
  "5) CENTRED motif framed by typography above and below; " +
  "6) motif anchored at the BOTTOM / ground, typography at the TOP; " +
  "7) SIDE split (motif on the left or right, a text column beside it); " +
  "8) FRAME composition (motif elements around the edges, text in a calm centre); " +
  "9) large VERTICAL / stacked typography as the hero element, motif secondary; " +
  "10) MINIMAL, lots of negative space, one strong focal point. " +
  "Within its assigned archetype, vary the concrete MOTIF and image idea only to a MODERATE, controlled degree; " +
  "genre, occasion and mood of the original stay the same throughout, and colour stays near the original. Keep " +
  "it GENERAL for any flyer genre: never name specific example motifs — describe the carrying elements of THIS " +
  "uploaded flyer abstractly, adapted to each archetype. " +
  "PRIORITY on any conflict: clean, high-quality club-flyer DESIGN comes FIRST, experiment SECOND — keep every " +
  "variant polished and club-ready rather than original but cheap-, chaotic- or overloaded-looking. " +
  "Each PROMPT must be COMPACT (roughly 80-140 words) yet COMPLETE and self-contained, directly usable in an " +
  "image generator: name its layout archetype and describe that composition concretely; state the genre, the " +
  "preserved colour palette / colour mood and the vibe faithfully to the reference; require the professional " +
  "structure and the design-quality principles above (hierarchy, negative space, one focal point, clean grid " +
  "alignment, readable text, 9:16); then give this variant's own motif / image idea within the archetype. " +
  "CONTENT RULES — every prompt MUST follow them: no real, recognisable or famous people and no celebrities — " +
  "only GENERIC, FICTIONAL people (if the flyer shows a person, describe a generic fictional person of a " +
  "similar type); never reproduce or mention any logos, brand marks, watermarks or emblems from the reference " +
  "(the variants contain NO logos or brand marks); do NOT invent concrete event names, titles, dates, DJ names, " +
  "venues or slogans — the only texts are the fixed placeholders HEADLINE, SUBLINE, 19.06.2026, UHRZEIT, " +
  "LOCATION, DJ NAME 1, DJ NAME 2, DJ NAME 3, CLUBNAME, www.website.com, each rendered exactly as given and " +
  "each exactly once, with no other text; it is ONE single vertical 9:16 club event flyer, one cohesive poster, " +
  "never a collage, grid or multiple designs. " +
  'Reply with STRICT JSON only, no markdown, shape: { "prompts": ["full prompt 1", "full prompt 2", ...] }.';

async function variantPrompts({ imageBase64, mediaType, model, count }) {
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");
  const n = Math.max(1, Math.min(12, parseInt(count, 10) || 10));
  async function attempt() {
    const message = await client.messages.create({
      model: modelId(model),
      max_tokens: 8000, // Kopffreiheit für 10 vollständige Prompts → kein abgeschnittenes JSON
      system: VARIANT_PROMPTS_SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "text", text:
            `Analyse this flyer and produce EXACTLY ${n} variant prompts. Give each prompt a DIFFERENT one of the ` +
            `10 named layout archetypes from the system instruction, ONE per prompt in that order, so the ${n} are ` +
            `compositionally fundamentally different (not the same grid with another motif). Keep the genre, mood ` +
            `level, 9:16 and ESPECIALLY the colour palette almost identical to the original, and make every variant ` +
            `a polished, agency-quality club flyer: clear typographic hierarchy, deliberate negative space, one ` +
            `focal point, clean grid alignment, readable text. Vary the concrete motif only moderately within each ` +
            `archetype. Clean high-quality club-flyer design comes before experiment. Reply with STRICT JSON only, no prose.` },
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
        ],
      }],
    });
    const block = (message.content || []).find((b) => b.type === "text");
    const text = block ? block.text : "";
    let arr = [];
    try {
      const parsed = parseJSON(text);
      arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.prompts) ? parsed.prompts : []);
    } catch { arr = []; }
    return arr.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).slice(0, n);
  }
  let prompts = await attempt();
  if (prompts.length < n) { const retry = await attempt(); if (retry.length > prompts.length) prompts = retry; }
  return prompts;
}

// ── Modus 1: fertiger Flyer → Textzonen + Rollen ─────────────────
const ROLES = "HEADLINE, SUBLINE, DATUM, UHRZEIT, LOCATION, DJ NAME 1, DJ NAME 2, DJ NAME 3, CLUBNAME, WEBSITE, OTHER";
const FLYER_SYSTEM =
  "You are analyzing a finished event flyer to turn it into a generic, reusable " +
  "template. Detect every distinct TEXT element. For each, return its exact text " +
  "content, a normalized bounding box [x, y, w, h] with values 0..1 relative to the " +
  "image, the single most likely ROLE from EXACTLY this set: " + ROLES + ", and a " +
  "rough description of its FONT so its style can be reused: font.style (serif, sans, " +
  "script, or display), font.casing (UPPERCASE, lowercase, Title, or Mixed) and " +
  "font.weight (light, regular, bold, or black). " +
  "Transcribe each text VERBATIM and carefully — including rotated, vertical or sideways " +
  "text such as a vertical credit line along an edge (mentally rotate it upright first). " +
  "Read every letter and digit exactly; do NOT guess or approximate. " +
  "Use OTHER for text that is none of the roles (taglines, prices, fine print). Order " +
  "zones top-to-bottom. Reply with STRICT JSON only (no markdown), shape: " +
  '{ "zones": [ { "text": "...", "role": "HEADLINE", "bbox": [x,y,w,h], ' +
  '"font": { "style": "serif", "casing": "UPPERCASE", "weight": "bold" } } ] }.';

async function analyzeFlyer({ imageBase64, mediaType, model }) {
  const out = await visionCall({
    system: FLYER_SYSTEM,
    instruction: "Detect the text zones of this flyer and their roles as JSON.",
    imageBase64, mediaType, model,
  });
  return Array.isArray(out.zones) ? out.zones : [];
}

// ── Grafik-Analyse (Bestandsverwaltung, Phase 2): EIN Flyer -> ein strukturierter
//    Datensatz nach FESTEM Fragenkatalog. Dient der Musterextraktion fuer spaetere
//    Gestaltungsregeln (Phase 3) — laeuft EINMALIG, NICHT bei der Generierung. Die Bilder
//    werden nur analysiert, nie als Vorlage gespeichert oder nachgebaut. Additiv: beruehrt
//    keine bestehende Analyse. Antworten auf DEUTSCH (der Katalog wird von Hand geprueft). ──
// Katalog NEU ausgerichtet: nicht mehr generische Merkmale abhaken (Groessenunterschiede ja/nein,
// Kategorie, Lautstaerke), sondern die KONKRETE RAEUMLICHE ANORDNUNG des Sekundaer-Info-Blocks in
// diesem echten Flyer beschreiben. Ziel: aus 40 echten Flyern lernen, WIE Profis die Nebeninfos
// (vor allem den DJ-Block) tatsaechlich anordnen, damit eine fehlende Rolle auf unseren Templates
// authentisch sitzt. Darum nur raeumliche Beschreibungs-Felder, keine Sortier-Felder mehr.
const DESIGN_ANALYSIS_SYSTEM =
  "You are a senior graphic designer analysing ONE finished club / event flyer to learn HOW the SECONDARY " +
  "INFORMATION is spatially ARRANGED, so this real-world arrangement can later be reproduced on our templates " +
  "when a role (above all the DJ lineup) is missing. You are NOT rebuilding the flyer and NOT describing its " +
  "content for reproduction. Describe ONLY what you SEE in THIS flyer, concretely and spatially. " +
  "SECONDARY INFORMATION = the DJ names, date, time, location, club name and website (everything EXCEPT the " +
  "headline / hero text and the main motif). " +
  "Answer in GERMAN, concrete and SPATIAL, one to three sentences per field. Do NOT answer yes/no and do NOT " +
  "give generic design advice — describe the ACTUAL placement, as if pointing at the layout. Give rough numbers " +
  "(percent, thirds, size ratios) where they help. If something is genuinely absent, say so plainly. " +
  "Reply with STRICT JSON only (no markdown, no commentary) using EXACTLY these keys, ALL string values: " +
  "block_position, flaechenaufteilung, gruppen_verhaeltnis, dj_block, flaechenfuellung, fehlende_rollen. " +
  "Answer exactly these questions: " +
  "block_position — WO sitzt der gesamte Sekundaer-Infoblock im Verhaeltnis zum Hauptmotiv und zum Format? " +
  "Konkret: unter dem Motiv, seitlich daneben, in einer Ecke verankert, als Band ueber die volle Breite, das " +
  "Motiv ueberlappend? An welche Bildkante ist er gebunden? " +
  "flaechenaufteilung — Welchen Anteil der Flyerflaeche nimmt der Sekundaerblock ein (grobe Prozent- oder " +
  "Drittel-Angabe), und wie ist er DARIN verteilt: ein kompaktes Feld, mehrere ueber die Flaeche verstreute " +
  "Anker, eine schmale Spalte an einer Kante? " +
  "gruppen_verhaeltnis — Wie stehen die einzelnen Info-Gruppen (DJ-Lineup, Datum/Uhrzeit/Location, " +
  "Clubname/Website) raeumlich ZUEINANDER? Konkret: dicht gedraengt als ein Klotz, durch klare Abstaende " +
  "getrennt, versetzt / ineinander verschachtelt? Wo liegt welche Gruppe? " +
  "dj_block — WO sitzt der DJ-Block relativ zu Datum, Location und Clubname, und wie ist er selbst gesetzt " +
  "(eine Reihe, gestapelt, ueber die Breite gesperrt, als abgesetzter eigener Block)? Wie dominant ist er " +
  "gegenueber den uebrigen Sekundaer-Infos? Falls KEIN DJ-Block vorhanden ist, sage das ausdruecklich. " +
  "flaechenfuellung — Wie wird die Flaeche GEFUELLT statt nur bestueckt? Wodurch wirkt der Block bewusst " +
  "gestaltet und nicht wie lose hingesetzte Zeilen: Groessenkontraste, Sperrung ueber die Breite, Trennlinien, " +
  "Balken/Flaechen, Ausrichtung an einer gemeinsamen Kante, bewusster Weissraum zwischen Gruppen? " +
  "fehlende_rollen — Kommen DJs, Location und Uhrzeit ueberhaupt vor? Nenne, welche FEHLEN, und wie die " +
  "vorhandenen eingebunden sind (bewusst gestaltet oder auf reine Info reduziert).";

async function analyzeDesignPatterns({ imageBase64, mediaType, model }) {
  return visionCall({
    system: DESIGN_ANALYSIS_SYSTEM,
    instruction: "Analysiere die raeumliche Anordnung des Sekundaer-Info-Blocks in diesem Flyer als JSON.",
    imageBase64, mediaType, model, maxTokens: 2600,
  });
}

// ── Verschlagwortung: kurze, konsistente Such-Stichworte (kein voller Prompt) ──
const TAG_SYSTEM =
  "You assign a few SHORT, DISTINCTIVE search KEYWORDS in GERMAN to ONE club / party flyer, for a filterable " +
  "library. Assign ONLY tags that DIFFERENTIATE this flyer from other party/club flyers — features that SOME " +
  "flyers have and others do NOT. Focus on: the MAIN MOTIF / subject (e.g. basketball, auto, handy, tattoo, " +
  "totenkopf, palme, blumen, engel, geld), the COLOUR WORLD (e.g. neon, pink, rot, schwarzweiß, gold, lila, " +
  "pastell, grün), the SPECIFIC STYLE / ERA (e.g. y2k, retro, vintage, grunge, oldmoney, minimalistisch, luxus, " +
  "streetwear, barock, comic), and other NOTABLE distinctive elements. If a clearly depicted person is central " +
  "you may add 'mann' or 'frau'. Do NOT assign generic words that apply to almost EVERY club flyer — NEVER use: " +
  "party, club, clubbing, musik, tanz, tanzen, event, veranstaltung, dj, djs, nightlife, feiern, feier, disco, " +
  "nacht, ausgehen, flyer. 4–7 keywords total, each ONE word or at most two words, ALL lowercase, German, " +
  "consistent and reusable, no duplicates, no punctuation, no sentences. Reply with STRICT JSON only: " +
  "{ \"keywords\": [\"…\", \"…\"] }.";

// Sicherheitsnetz: Allerwelts-Begriffe verwerfen, falls das Modell sie doch liefert.
const TAG_STOP = new Set([
  "party", "club", "clubbing", "musik", "music", "tanz", "tanzen", "dance", "event", "veranstaltung",
  "dj", "djs", "nightlife", "feiern", "feier", "disco", "nacht", "night", "ausgehen", "flyer",
  "clubnacht", "clubevent", "clubbing night", "night out",
]);

async function tagFlyer({ imageBase64, mediaType, model }) {
  const out = await visionCall({
    system: TAG_SYSTEM,
    instruction: "Give the search keywords for this flyer as JSON.",
    imageBase64, mediaType, model, maxTokens: 400,
  });
  const arr = Array.isArray(out) ? out
    : (out && typeof out === "object" ? (out.keywords || out.tags || out.schlagworte || out.stichworte || []) : []);
  return (Array.isArray(arr) ? arr : [])
    .map((x) => String(x == null ? "" : x))
    .filter((w) => { const n = w.toLowerCase().trim(); return n && !TAG_STOP.has(n); }); // Stoppwörter raus; Rest normalisiert keywords.js
}

// ── Grafik-Analyse, Phase 3: Destillieren der gesammelten Datensaetze zu einem REGELWERK.
//    EINSTUFIG und UNIVERSELL: EIN Aufruf ueber ALLE Datensaetze gemeinsam, damit das
//    GEMEINSAME Anordnungsmuster ueber alle 40 Flyer entsteht — nicht getrennt pro Stil-
//    Kategorie (das zerstueckelte das Grafiker-Wissen in kraftlose Haeufchen). Der fruehere
//    Token-Grund fuer die Zweistufigkeit entfaellt genau durch diese Ausrichtung: ohne
//    Kategorie-Detail ist die AUSGABE kompakt (ein Muster-Absatz + wenige konkrete Regeln +
//    Rollen-Herleitung), egal wie viele Flyer eingehen; die Eingabe von ~40 knappen Datensaetzen
//    passt bequem in EINEN Aufruf. Fuer JEDE Regel nennt das Modell die belege = Datensatz-
//    Indizes; die ANZAHL zaehlen WIR im Code (ehrliche Belastbarkeit statt geratener Zahl). Das
//    Regelwerk wird getrennt gespeichert, NIE in den Bildprompt-Code geschrieben. Skalenweg fuer
//    deutlich mehr als 40 Flyer: Map-Reduce ueber gleichartige Stichproben, NICHT wieder eine
//    Kategorie-Trennung. ──
const DESIGN_RULES_SYSTEM =
  "You are a senior graphic designer DISTILLING the spatial-arrangement analyses of MANY real, professionally " +
  "designed club flyers into ONE concrete ARRANGEMENT GUIDE for the SECONDARY INFORMATION block (DJ names, date, " +
  "time, location, club name, website). You receive a JSON array of datasets; each has an integer `idx` (the " +
  "dataset index — use EXACTLY these values, never renumber) and the fields block_position, flaechenaufteilung, " +
  "gruppen_verhaeltnis, dj_block, flaechenfuellung, fehlende_rollen. " +
  "Your task: find the RECURRING ARRANGEMENT patterns that show up ACROSS the flyers and form the TYPICAL " +
  "designer arrangement from what actually REPEATS — NOT 40 individual descriptions, NOT a split by style. " +
  "Phrase EVERYTHING as CONCRETE spatial placement a text-to-image model can execute (where the block sits, how " +
  "the area is divided, how the groups relate, where the DJ block sits relative to the others, how the area is " +
  "FILLED rather than merely populated), NEVER as abstract design principles. " +
  "Report ONLY what REPEATS across MULTIPLE datasets; never restate a single case, never invent a pattern that is " +
  "not in the data. For EVERY rule and EVERY role derivation you MUST give `belege` = the array of `idx` values " +
  "that ACTUALLY show it; be honest, do NOT pad — the count is how the reader judges how strong it is. " +
  "Deliver THREE things: " +
  "(1) anordnung_muster — ONE concrete German paragraph describing the TYPICAL arrangement of the whole secondary " +
  "block, as tangible and reproducible as possible (a designer's placement brief, not a principle). " +
  "(2) regeln — the recurring CONCRETE placement rules, at most 10. " +
  "(3) herleitung_rollen — for the roles a template often lacks (above all `djs`, also `location`, `uhrzeit`, " +
  "`datum`): a CONCRETE placement instruction DERIVED from the flyers that DO show that role — where it sits " +
  "relative to the others and how it fills its area, so a MISSING role can be placed authentically. " +
  // Sprache: die Datensaetze sind DEUTSCH (der Fragenkatalog wird von Hand geprueft), das
  // RESULTAT muss ENGLISCH sein. Es fliesst woertlich in den ansonsten englischen Bildprompt,
  // und gpt-image setzt einsprachig englische Prompts praeziser um als gemischte.
  "LANGUAGE: the datasets you receive are written in GERMAN, but your OUTPUT MUST BE IN ENGLISH — every " +
  "anordnung_muster, regel and muster text in fluent, concise, concrete ENGLISH. The rule texts are fed " +
  "verbatim into an English image prompt, so do NOT reply in German and do NOT mix languages. " +
  "Reply with STRICT JSON only (no markdown, no commentary) with EXACTLY this shape: " +
  '{ "anordnung_muster": "…", "regeln": [ { "regel": "…", "belege": [1,4] } ], ' +
  '"herleitung_rollen": [ { "rolle": "djs", "muster": "…", "belege": [1,4] } ] }';

// EIN Aufruf des Destillierens. `abschnitt` steckt in JEDER Fehlermeldung, damit ein Abbruch
// zuordenbar ist statt still zu scheitern.
async function distillCall({ system, userText, model, maxTokens, abschnitt }) {
  const message = await client.messages.create({
    model: modelId(model),
    max_tokens: maxTokens,
    // Denken AUS. Bei claude-sonnet-5 ist adaptives Denken an, sobald `thinking` fehlt (beim
    // alten claude-sonnet-4-6 war es umgekehrt) — die Denk-Token zaehlen voll gegen max_tokens
    // und liessen fuer das Regelwerk kaum Budget uebrig. Destillieren ist Mustererkennung nach
    // festem Schema, dafuer braucht es kein Denken; so stehen die vollen Token dem JSON zu.
    thinking: { type: "disabled" },
    system,
    messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
  });
  const block = (message.content || []).find((b) => b.type === "text");
  const raw = block ? block.text : "";
  // Der ECHTE Verbrauch aus usage — die Zeichenzahl des Textblocks misst nur einen Teil der
  // Ausgabe und sah bei einem Abbruch wie ein Widerspruch aus ("abgeschnitten bei 3348").
  const out = (message && message.usage && message.usage.output_tokens);
  const verbrauch = Number.isFinite(out) ? out + " von " + maxTokens + " Token verbraucht" : "Verbrauch unbekannt";
  // Der Abbruch-Fall ZUERST: ein an der Grenze abgeschnittenes JSON darf nie halb gedeutet
  // werden — parseJSON greift sich sonst evtl. einen Teilblock und die Regeln waeren lueckenhaft,
  // ohne dass es jemand merkt. Lieber ein klarer Fehler mit Angabe des Abschnitts.
  if (message && message.stop_reason === "max_tokens") {
    throw new Error(abschnitt + ": Antwort an der Token-Grenze abgeschnitten (" + verbrauch + ")");
  }
  try { return parseJSON(raw); }
  catch (e) { throw new Error(abschnitt + ": JSON nicht lesbar (" + verbrauch + ", " + raw.length + " Zeichen Text)"); }
}

async function distillDesignRules({ records, model, maxTokens = 8000 }) {
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");
  const list = Array.isArray(records) ? records : [];
  const n = list.length;
  if (!n) throw new Error("Keine Datensaetze zum Destillieren");

  // Kompakte, INDIZIERTE Eingabe: je Datensatz idx + die Anordnungsfelder. Ein Aufruf ueber
  // ALLE Flyer gemeinsam -> das gemeinsame Muster, nicht 40 Einzelbeschreibungen, nicht pro Stil.
  const bundle = list.map((r, idx) => ({ idx, ...((r && r.fields) || {}) }));

  // belege -> nur gueltige, eindeutige Indizes; beruht_auf = deren Anzahl (im Code gezaehlt).
  const clean = (arr) => {
    const seen = new Set();
    for (const x of (Array.isArray(arr) ? arr : [])) {
      const i = parseInt(x, 10);
      if (Number.isInteger(i) && i >= 0 && i < n) seen.add(i);
    }
    return [...seen].sort((a, b) => a - b);
  };
  const withCount = (rule) => {
    const belege = clean(rule && rule.belege);
    return { ...(rule || {}), belege, beruht_auf: belege.length };
  };

  // ── EIN Aufruf ueber ALLE Datensaetze: das wiederkehrende Anordnungsmuster + konkrete Regeln
  //    + Rollen-Herleitung. Scheitert er, nennt der Fehler den Abschnitt und der Lauf bricht
  //    sichtbar ab. ──
  const out = await distillCall({
    system: DESIGN_RULES_SYSTEM,
    // Anweisung bewusst ENGLISCH: eine deutsche Anweisung zoege die Ausgabe wieder ins
    // Deutsche, obwohl die Datensaetze deutsch sind und bleiben.
    userText: "These " + n + " datasets come from " + n + " real, professionally designed club flyers. The " +
      "dataset texts are in GERMAN; your OUTPUT must be in ENGLISH. Find the RECURRING arrangement patterns of " +
      "the secondary block across ALL of them and form the typical designer arrangement (one anordnung_muster " +
      "paragraph, concrete regeln, herleitung_rollen for the roles a template often lacks). Give belege (the " +
      "given idx values) for every rule and every derivation. Reply with strict JSON.\n\n" +
      JSON.stringify(bundle),
    model, maxTokens, abschnitt: "Anordnungs-Regelwerk",
  });

  const anordnung_muster = typeof out.anordnung_muster === "string" ? out.anordnung_muster.trim() : "";
  const universelle_regeln = (Array.isArray(out.regeln) ? out.regeln : [])
    .map(withCount).sort((a, b) => b.beruht_auf - a.beruht_auf);
  const herleitung_rollen = (Array.isArray(out.herleitung_rollen) ? out.herleitung_rollen : [])
    .map(withCount).sort((a, b) => b.beruht_auf - a.beruht_auf);

  return { basis: { datensaetze: n }, anordnung_muster, universelle_regeln, herleitung_rollen };
}

module.exports = { isConfigured, analyzeMoodboard, analyzeReference, generateVariationSpecs, cleanVariantSpecs, variantPrompts, analyzeFlyer, tagFlyer, analyzeDesignPatterns, distillDesignRules, MODELS };
