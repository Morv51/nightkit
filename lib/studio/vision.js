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
  "collage of tiles. Reply with STRICT JSON only (no markdown, " +
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

module.exports = { isConfigured, analyzeMoodboard, analyzeFlyer, MODELS };
