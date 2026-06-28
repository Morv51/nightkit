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
  sonnet: "claude-sonnet-4-6",
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
  "editorial_club_look. Each value is one concise English phrase usable directly inside an image-" +
  "generation prompt. Describe a FAITHFUL, not exaggerated, style.";

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
  "style and the same level of restraint. Vary ONLY three things, and keep each WITHIN the anchor: " +
  "(1) color_world — a specific color combination drawn ONLY from this anchor's own palette / colour world " +
  "(never introduce colours foreign to the anchor; if the anchor is dark/metallic, stay dark/metallic; if " +
  "it is light/pastel, stay light/pastel); (2) imagery_style — a different illustration motif / subject, but " +
  "rendered in the EXACT same illustration / rendering style as the anchor (change only the subject, never " +
  "the rendering style); (3) layout — a different composition arrangement of one big subject + text + " +
  "negative space. Make the variations clearly different from one another, but all unmistakably the same " +
  "style family. Give each a short human label like 'bronze on teal · palm silhouette · centred'. Reply " +
  'with STRICT JSON only (no markdown): { "variants": [ { "label": "...", "color_world": "...", ' +
  '"imagery_style": "...", "layout": "..." } ] }.';

async function generateVariationSpecs({ dna, count, model }) {
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");
  const n = Math.max(1, Math.min(24, parseInt(count, 10) || 10));
  const anchor = JSON.stringify(dna || {}, null, 2);
  const message = await client.messages.create({
    model: modelId(model),
    max_tokens: 3000,
    system: VARIANT_SYSTEM,
    messages: [{
      role: "user",
      content: [{ type: "text", text:
        `STYLE ANCHOR (stay strictly within this — do NOT introduce anything outside it):\n${anchor}\n\n` +
        `Produce exactly ${n} distinct variations as JSON.` }],
    }],
  });
  const block = (message.content || []).find((b) => b.type === "text");
  const parsed = parseJSON(block ? block.text : "");
  const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.variants) ? parsed.variants : []);
  const s = (x) => (typeof x === "string" ? x.trim() : "");
  return arr.slice(0, n).map((x) => ({
    label: s(x && x.label),
    color_world: s(x && x.color_world),
    imagery_style: s(x && x.imagery_style),
    layout: s(x && x.layout),
  })).filter((x) => x.color_world || x.imagery_style || x.layout);
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

module.exports = { isConfigured, analyzeMoodboard, analyzeReference, generateVariationSpecs, analyzeFlyer, MODELS };
