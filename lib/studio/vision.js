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
const LEITIDEE_KEYS = "leitidee, fuellgrad, blickfang, rangfolge, lautstaerke, motiv_darstellung, ";
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
  "Read leitidee, fuellgrad, blickfang, rangfolge, lautstaerke and motiv_darstellung FAITHFULLY from THIS " +
  "reference — NEVER a default: a restrained reference must give restrained values, a loud one loud values. ";

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
const DESIGN_ANALYSIS_SYSTEM =
  "You are a senior graphic designer analysing ONE finished club / event flyer in order to extract DESIGN " +
  "PATTERNS. You are NOT rebuilding it and NOT describing its content for reproduction — you answer a fixed " +
  "catalogue about HOW it is designed, strictly from what you SEE in THIS flyer. Never guess or generalise; if " +
  "something is genuinely not present, say so. " +
  "Answer in GERMAN (the reader is a German-speaking designer), concise and concrete — one to three sentences " +
  "per field, and give real NUMBERS where a number is asked for. " +
  "Reply with STRICT JSON only (no markdown, no commentary) using EXACTLY these keys: blickfang, " +
  "flaechenaufteilung, klassen, fehlende_rollen, datum, schrift_disziplin, tiefe, ordnung, vibe, " +
  "stil_kategorie, lautstaerke, herleitung_rollen. " +
  "All values are strings EXCEPT herleitung_rollen, which is an OBJECT (see below). " +
  "Answer exactly these questions: " +
  "blickfang — Welches Element wird ZUERST gesehen, und WODURCH (Groesse, Farbe, Freistellung, Position)? Ist " +
  "es EIN klarer Blickfang oder konkurrieren mehrere? " +
  "flaechenaufteilung — Wie hoch ist der geschaetzte Anteil UNGENUTZTER Flaeche in PROZENT (nenne die Zahl)? " +
  "Ist der Weissraum GEBUENDELT an einer Stelle oder ueber den Flyer VERTEILT? " +
  "klassen — Welche Texte sind LAUT gestaltet, welche ruhig als reine Sachinfo? Woran genau unterscheiden sie " +
  "sich (Groesse, Schnitt, Farbe, Behandlung)? " +
  "fehlende_rollen — Kommen DJs, Location und Uhrzeit ueberhaupt vor? Falls ja, wie sind sie eingebunden " +
  "(bewusst gestaltet oder auf reine Info reduziert)? Beschreibe die KONKRETE Behandlung der DJ-Namen. " +
  "datum — Wo steht das Datum und wie ist es gesetzt? Bekommt es eine eigene Flaeche / ein eigenes Feld oder " +
  "steht es frei? " +
  "schrift_disziplin — Wie viele SCHRIFTFAMILIEN werden verwendet und wie viele BUNTFARBEN (nenne beide " +
  "Zahlen)? " +
  "tiefe — Liegt Text HINTER dem Motiv? Ueberlappt das Motiv andere Elemente? " +
  "ordnung — Gibt es eine gemeinsame Ausrichtungskante (ja/nein)? Ist die Anordnung diagonal, gestapelt oder " +
  "spaltig? " +
  "vibe — Der Charakter in EINEM Satz, so wie ein Grafiker ihn beschreiben wuerde. " +
  "stil_kategorie — EXAKT EINER dieser Werte, nichts anderes: grunge, elegant, minimal, neon, retro, " +
  "streetstyle, glamour, sonstige. Waehle den EINEN, der diesen Flyer am besten trifft; 'sonstige' nur, wenn " +
  "wirklich keiner passt. Leite den Wert aus DIESEM Flyer ab, nie als Voreinstellung. " +
  "lautstaerke — EXAKT EINER dieser Werte, nichts anderes: zurueckhaltend, mittel, laut. Wie aufdringlich " +
  "tritt die Gestaltung insgesamt auf? Leite den Wert aus DIESEM Flyer ab, nie als Voreinstellung. " +
  "herleitung_rollen — REKONSTRUIERE die GESTALTUNGS-HERLEITUNG der Nebenrollen, nicht nur ihr Aussehen. " +
  "Ziel: verstehen, aus welcher LOGIK der Grafiker die Gestaltung einer Rolle ABGELEITET hat, denn nur die " +
  "Herleitung laesst sich auf andere Stile uebertragen. Ein OBJEKT, dessen Schluessel die im Flyer " +
  "VORHANDENEN Nebenrollen aus {djs, location, uhrzeit, datum} sind; im Flyer FEHLENDE Rollen laesst du " +
  "komplett weg. Jede vorhandene Rolle ist ein Objekt mit GENAU zwei Schluesseln: " +
  "bezugspunkt — woran sich die Gestaltung dieser Rolle orientiert, EXAKT EINER dieser Werte, nichts " +
  "anderes: 'eigene Schrift der Sachinfo-Gruppe', 'abgeleitet vom Titel', 'abgeleitet vom Datum', " +
  "'eigenständig inszeniert mit Foto oder Fläche', 'anderer'. " +
  "reduktion — was GEGENUEBER diesem Bezugspunkt getan wurde: entweder etwas WEGGENOMMEN (Effekt entfernt, " +
  "Farbe neutralisiert, Groesse verkleinert) ODER etwas HINZUGEFUEGT (Foto, Flaeche, Farbe). Formuliere so, " +
  "dass die HERLEITUNG erkennbar wird, nicht nur das Endergebnis — NICHT 'DJ schlicht weiß', sondern z.B. " +
  "'DJ nimmt die Schrift der Genre-Liste, ohne Effekt, eine Stufe kleiner'. " +
  "Leite jeden Wert AUS DIESEM Flyer ab, nie als Voreinstellung.";

async function analyzeDesignPatterns({ imageBase64, mediaType, model }) {
  return visionCall({
    system: DESIGN_ANALYSIS_SYSTEM,
    instruction: "Analysiere diesen Flyer und beantworte den festen Fragenkatalog als JSON.",
    imageBase64, mediaType, model, maxTokens: 3200,
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
//    ZWEISTUFIG, damit nie zu viel Text auf EINMAL entsteht: ein einziger Aufruf ueber alle
//    Datensaetze sprengt die Token-Grenze, und ein hoeheres max_tokens verschiebt das Problem
//    nur. Stattdessen kleinere Portionen:
//      Stufe 1 — je stil_kategorie EIN Aufruf ueber NUR deren Datensaetze -> Teil-Regelwerk.
//      Stufe 2 — EIN Aufruf ueber die TEIL-ERGEBNISSE (nicht die Rohdatensaetze) -> universelle
//                Regeln, also die Muster, die ueber mehrere Kategorien hinweg gelten.
//    Ergebnisstruktur bleibt unveraendert (universelle_regeln + stilabhaengige_regeln je
//    Kategorie), nur der Weg dorthin ist gestueckelt. Fuer JEDE Regel nennt das Modell die
//    belege = Liste der GLOBALEN Datensatz-Indizes; die ANZAHL zaehlen WIR im Code (ehrliche
//    Belastbarkeit statt geratener Zahl). Das Regelwerk wird getrennt gespeichert, NIE in den
//    Bildprompt-Code geschrieben. ──

// Stufe 1: Teil-Regelwerk EINER Stil-Kategorie.
const DESIGN_RULES_CAT_SYSTEM =
  "You are a senior graphic designer DISTILLING the flyer analyses of ONE single style category into a compact " +
  "PARTIAL RULESET. You receive the category name and a JSON array of its datasets; each has an integer `idx` " +
  "(the GLOBAL dataset index — use EXACTLY these values, never renumber them) and the fixed catalogue fields " +
  "(blickfang, flaechenaufteilung, klassen, fehlende_rollen, datum, schrift_disziplin, tiefe, ordnung, vibe, " +
  "stil_kategorie, lautstaerke, herleitung_rollen). " +
  "Your task: extract the RECURRING design PATTERNS WITHIN this category and phrase them as RULES — its TYPICAL " +
  "treatment, and ESPECIALLY the herleitung_rollen pattern: how the secondary roles a template often lacks (above " +
  "all the DJs, also location, uhrzeit, datum) are DERIVED in this style — the bezugspunkt (what the design " +
  "borrows from) plus the reduktion (what is taken away or added). " +
  "Report ONLY what REPEATS across MULTIPLE datasets — never restate an individual case, never invent a pattern " +
  "that is not actually in the data. If this category has too few datasets to show a repeating pattern, return " +
  "FEW or NO rules rather than padding it out. " +
  "For EVERY rule you MUST include `belege`: the array of `idx` values of the datasets that ACTUALLY support that " +
  "rule. Be honest and precise — add an idx ONLY if that dataset really shows the pattern, do NOT pad the list. " +
  "The number of belege is how the reader judges how strong a rule is, so it must be truthful. " +
  "Write all RULE TEXTS in GERMAN, concise and concrete. Stay compact: at most 8 regeln. " +
  "Reply with STRICT JSON only (no markdown, no commentary) with EXACTLY this shape: " +
  '{ "regeln": [ { "regel": "…", "belege": [1,4] } ], ' +
  '"herleitung_rollen": [ { "rolle": "djs", "muster": "bezugspunkt + reduktion in einem Satz", "belege": [1,4] } ] }';

// Stufe 2: universelle Regeln, abgeleitet aus den Teil-Regelwerken.
const DESIGN_RULES_UNI_SYSTEM =
  "You are a senior graphic designer. You receive the ALREADY DISTILLED partial rulesets of several style " +
  "categories — per category: its name, its dataset count, its rules and its role-derivation patterns, each with " +
  "`belege` = the GLOBAL dataset indices that support it. " +
  "Your task: derive the UNIVERSELLE REGELN — the patterns that hold ACROSS the style categories, i.e. that show " +
  "up in the partial rulesets of MULTIPLE DIFFERENT categories (e.g. the split into loud design roles vs. quiet " +
  "info roles, a limited number of type families, the motif overlapping text). " +
  "Include a rule ONLY if it genuinely appears in at least TWO DIFFERENT categories and covers a large part of " +
  "the data. Do NOT repeat a pattern that is specific to a single category — that one stays in its category " +
  "ruleset. Never invent a pattern that is not in the partial rulesets. " +
  "For EVERY universal rule you MUST include `belege`: the union of the `idx` values of the underlying partial " +
  "rules. Use ONLY idx values that actually appear in the given partial rulesets, do NOT invent numbers and do " +
  "NOT pad the list — the count is how the reader judges how strong a rule is. " +
  "Write all RULE TEXTS in GERMAN, concise and concrete. At most 10 regeln. " +
  "Reply with STRICT JSON only (no markdown, no commentary) with EXACTLY this shape: " +
  '{ "universelle_regeln": [ { "regel": "…", "belege": [0,3,7] } ] }';

// EIN Teil-Aufruf des Destillierens. `abschnitt` benennt den Teil (Kategorie bzw. Stufe 2) und
// steckt in JEDER Fehlermeldung, damit ein Abbruch zuordenbar ist statt still zu scheitern.
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

  // Kompakte, INDIZIERTE Eingabe: je Datensatz idx + Quelle + die Katalogfelder, gebuendelt.
  // Die idx werden EINMAL global vergeben und danach nur noch gruppiert — dadurch bleiben die
  // belege ueber alle Teil-Aufrufe hinweg vergleichbar und Stufe 2 kann sie vereinigen.
  const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const bundle = list.map((r, idx) => ({ idx, quelle: (r && r.sourceName) || "", ...((r && r.fields) || {}) }));

  // Nach stil_kategorie gruppieren. Es entstehen NUR Kategorien, die wirklich Datensaetze
  // haben — leere gibt es hier gar nicht erst. Ohne Angabe -> "unbekannt".
  const gruppen = new Map();
  for (const b of bundle) {
    const k = norm(b.stil_kategorie) || "unbekannt";
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(b);
  }
  const kategorien = {};
  for (const [k, arr] of gruppen) kategorien[k] = arr.length;

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

  // ── Stufe 1: je Kategorie ein eigener Aufruf ueber NUR deren Datensaetze. Parallel, damit
  //    der Lauf im Poll-Fenster des Frontends bleibt; scheitert einer, nennt der Fehler seine
  //    Kategorie und der ganze Lauf bricht sichtbar ab. ──
  const teile = await Promise.all([...gruppen.keys()].map(async (k) => {
    const arr = gruppen.get(k);
    const out = await distillCall({
      system: DESIGN_RULES_CAT_SYSTEM,
      userText: 'Stil-Kategorie: "' + k + '" — ' + arr.length + " Datensaetze. Destilliere das Teil-Regelwerk NUR " +
        "fuer diese Kategorie. NUR wiederkehrende Muster ueber mehrere Datensaetze, keine Einzelfaelle. Nenne fuer " +
        "JEDE Regel die belege (die vorgegebenen idx-Werte). Antworte mit striktem JSON.\n\n" + JSON.stringify(arr),
      model, maxTokens, abschnitt: 'Kategorie "' + k + '"',
    });
    return {
      kategorie: k,
      anzahl: arr.length,
      regeln: (Array.isArray(out.regeln) ? out.regeln : []).map(withCount).sort((a, b) => b.beruht_auf - a.beruht_auf),
      herleitung_rollen: (Array.isArray(out.herleitung_rollen) ? out.herleitung_rollen : []).map(withCount),
    };
  }));

  // ── Stufe 2: universelle Regeln aus den TEIL-ERGEBNISSEN ableiten, nicht aus allen
  //    Rohdatensaetzen — die Eingabe bleibt dadurch klein, egal wie viele Flyer analysiert sind. ──
  const uniInput = teile.map((t) => ({
    stil_kategorie: t.kategorie,
    datensaetze: t.anzahl,
    regeln: t.regeln.map((r) => ({ regel: r.regel, belege: r.belege })),
    herleitung_rollen: t.herleitung_rollen.map((r) => ({ rolle: r.rolle, muster: r.muster, belege: r.belege })),
  }));
  const uniOut = await distillCall({
    system: DESIGN_RULES_UNI_SYSTEM,
    userText: "Diese " + teile.length + " Teil-Regelwerke stammen aus insgesamt " + n + " Datensaetzen. Leite " +
      "daraus die universellen Regeln ab: NUR Muster, die in MEHREREN Kategorien auftauchen. Nenne fuer JEDE " +
      "Regel die belege (idx-Werte aus den Teil-Regelwerken). Antworte mit striktem JSON.\n\n" + JSON.stringify(uniInput),
    model, maxTokens, abschnitt: "Universelle Regeln (Stufe 2)",
  });
  const uni = (Array.isArray(uniOut.universelle_regeln) ? uniOut.universelle_regeln : [])
    .map(withCount).sort((a, b) => b.beruht_auf - a.beruht_auf);

  // Kategorien nach Belegdichte sortiert ablegen (die Anzeige sortiert ohnehin, aber so ist
  // schon die gespeicherte Datei in sinnvoller Reihenfolge lesbar).
  const stil = {};
  for (const t of [...teile].sort((a, b) => b.anzahl - a.anzahl)) {
    stil[t.kategorie] = { anzahl: t.anzahl, regeln: t.regeln, herleitung_rollen: t.herleitung_rollen };
  }

  return { basis: { datensaetze: n, kategorien }, universelle_regeln: uni, stilabhaengige_regeln: stil };
}

module.exports = { isConfigured, analyzeMoodboard, analyzeReference, generateVariationSpecs, variantPrompts, analyzeFlyer, tagFlyer, analyzeDesignPatterns, distillDesignRules, MODELS };
