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
  throw new Error("Konnte keine JSON-Antwort aus der Vision-Analyse lesen");
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
const STYLE_KEYS_TAIL =
  COLOR_FIDELITY +
  "Reply with STRICT JSON only (no markdown, no commentary) using EXACTLY these keys: look_mood, " +
  "color_world, imagery_style, typography_character, composition, visual_hierarchy, texture_grain_light, " +
  "editorial_club_look. For typography_character, be SPECIFIC about the HEADLINE lettering — its weight, " +
  "shape / personality, casing and any effect or treatment (e.g. outline, glow, distressed, chrome, script) — " +
  "as well as the secondary-text typography, so both can be mirrored. Each value is one concise English " +
  "phrase usable directly inside an image-generation prompt. Describe a FAITHFUL, not exaggerated, style. " +
  "Use NEUTRAL, fashion / editorial / business wording throughout: describe any people or clothing only as " +
  "'fashionable', 'elegant', 'stylish', 'modern', 'confident', 'editorial' or 'party' looks. Do NOT use body- " +
  "or revealing-related words (e.g. sensual, sultry, seductive, sexy, revealing, tight, skin, bare, exposed, " +
  "bikini, lingerie, underwear, hot) — keep the actual visual style intact, just in neutral wording.";

const SINGLE_SYSTEM =
  "You are an art director extracting the STYLE DNA from a SINGLE reference image (one flyer/design used " +
  "purely as inspiration) so a NEW, ORIGINAL club event flyer can be created in the same spirit. Stay " +
  "CLOSE to the reference: faithfully capture its look, color_world, typography_character, texture, mood " +
  "AND its composition logic / layout approach. BUT the result must remain a NEW flyer — do NOT copy or " +
  "transcribe its text, names, dates, logos or specific objects/people; those must NOT be reproduced. " +
  STYLE_KEYS_TAIL;

const MULTIPLE_SYSTEM =
  "You are an art director extracting the SHARED STYLE DNA across MULTIPLE reference images so a NEW, " +
  "ORIGINAL club event flyer can be created in their common spirit. Extract ONLY the shared visual " +
  "denominator across ALL of the images (the common color palette, typographic character, texture, mood, " +
  "illustration style). Do NOT copy any single image's content, text, logos or specific objects, do NOT " +
  "describe the images individually, and do NOT reproduce a grid/collage. 'composition' and " +
  "'visual_hierarchy' must describe a SINGLE cohesive poster layout. " +
  STYLE_KEYS_TAIL;

const REF_SYSTEM = { moodboard: MOODBOARD_SYSTEM, single: SINGLE_SYSTEM, multiple: MULTIPLE_SYSTEM };

// Eine ODER mehrere Referenzen → Stil-DNA, je nach refType ("moodboard" |
// "single" | "multiple"). images: [{ base64, mediaType }].
async function analyzeReference({ images, refType, model }) {
  const sys = REF_SYSTEM[refType] || MOODBOARD_SYSTEM;
  const instruction = refType === "single"
    ? "Extract the style DNA of this single reference image as JSON for a faithful reinterpretation."
    : refType === "multiple"
    ? "Extract the SHARED style DNA across these reference images as JSON for reinterpretation."
    : "Extract the style DNA of this moodboard as JSON for reinterpretation.";
  return visionCallMulti({ system: sys, instruction, images, model });
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

module.exports = { isConfigured, analyzeMoodboard, analyzeReference, generateVariationSpecs, variantPrompts, analyzeFlyer, tagFlyer, MODELS };
