"use strict";

// INHALTS-Bausteine fuer den serverseitigen Auto-Flow-Orchestrator. SPIEGELT die Logik aus
// lib/studio/routes.js 1:1 (deescalate, downloadToDataUrl, outpaintTo916, Analyse, Varianten,
// Generierung), damit der Server-Lauf INHALTLICH identisch zum bisherigen browsergetriebenen
// Weg ist. routes.js bleibt dabei komplett unangetastet (Sicherheit zuerst).

const ideogram = require("../ideogram");     // read-only: download()
const fal = require("../fal");               // read-only: outpaint()
const openaiImage = require("./openaiImage");
const vision = require("./vision");
const promptBuilder = require("./promptBuilder");
const usage = require("../admin/usage");

const FAL_KEY = process.env.FAL_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

// data:<mime>;base64,<data> -> { buffer, mediaType } (null wenn ungueltig).
function parseDataUrl(s) {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(String(s || ""));
  if (!m) return null;
  try { return { buffer: Buffer.from(m[2], "base64"), mediaType: m[1] }; } catch (_) { return null; }
}

// --- 1:1 aus routes.js gespiegelt (Wort-Entschaerfung) ---
const DEESCALATE = [
  [/\bsensual(ly)?\b/gi, "elegant"], [/\bsultry\b/gi, "stylish"],
  [/\bseductive(ly)?\b/gi, "confident"], [/\bsexy\b/gi, "stylish"],
  [/\balluring\b/gi, "striking"], [/\bprovocative\b/gi, "bold"],
  [/\brevealing\b/gi, "fashionable"], [/\btight\b/gi, "fitted"],
  [/\bbare\b/gi, "open"], [/\bexposed\b/gi, "open"], [/\bskin\b/gi, "look"],
  [/\bbikini\b/gi, "swimwear"], [/\blingerie\b/gi, "outfit"],
  [/\bunderwear\b/gi, "outfit"], [/\bhot\b/gi, "striking"],
  [/\bnaked\b/gi, "minimal"], [/\bnude\b/gi, "neutral-toned"],
];
function deescalate(text) {
  let t = typeof text === "string" ? text : "";
  for (const [re, rep] of DEESCALATE) t = t.replace(re, rep);
  return t;
}

async function downloadToDataUrl(url) {
  const dl = await ideogram.download(url);
  return `data:${dl.contentType};base64,${dl.buffer.toString("base64")}`;
}

// Best-effort 9:16-Outpaint (wie routes.outpaintTo916): schlaegt es fehl oder fehlt FAL_KEY,
// kommt das 2:3-Bild unveraendert zurueck, nie eine harte Fehlerquelle.
async function outpaintTo916(dataUrl) {
  if (!FAL_KEY) return dataUrl;
  try {
    const { url } = await fal.outpaint({ imageDataUrl: dataUrl, top: 142, bottom: 142, left: 0, right: 0, outputFormat: "png" });
    try { usage.count("fal_outpaint"); } catch (_) {}
    return await downloadToDataUrl(url);
  } catch (e) { console.error("[autoflow-gen] FAL 9:16-Outpaint uebersprungen:", e.message); return dataUrl; }
}

// Analyse (Sonnet) -> { dna, mainPrompt }. Identisch zum /admin/analyze Bild-Pfad.
// typo (nur Auto-Flow 2): erweiterte Analyse (Typo je Textrolle + Beispieltexte +
// Varianz) und deren wörtliche Übernahme in den Prompt.
async function analyze({ imageBase64, mediaType, model, loose, typo }) {
  if (!vision.isConfigured()) throw new Error("ANTHROPIC_API_KEY not configured");
  const dna = await vision.analyzeReference({ images: [{ base64: imageBase64, mediaType }], refType: "single", model, typo: !!typo });
  try { usage.count("claude_analyze"); } catch (_) {}
  const mainPrompt = promptBuilder.buildMoodboardPrompt(dna, { refType: "single", looseInspiration: !!loose, typo: !!typo });
  return { dna, mainPrompt };
}

// Varianten-Prompts (Sonnet) -> [{ label, prompt }]. Identisch zu /admin/auto-variants.
async function variantPrompts({ dna, count, model, loose, typo }) {
  if (!vision.isConfigured()) throw new Error("ANTHROPIC_API_KEY not configured");
  const specs = await vision.generateVariationSpecs({ dna, count, model });
  try { usage.count("claude_variantspecs"); } catch (_) {}
  return specs.map((s) => ({
    label: s.label || [s.color_world, s.imagery_style, s.layout].filter(Boolean).join(" · ").slice(0, 70),
    prompt: promptBuilder.buildMoodboardPrompt(dna, {
      refType: "single", looseInspiration: !!loose, typo: !!typo,
      variant: { color_world: s.color_world, imagery_style: s.imagery_style, layout: s.layout },
    }),
  }));
}

// EIN Bild erzeugen (Prompt -> finales Bild als data-URL). Identisch zum /admin/auto-generate:
// textOnly => generateImage + 9:16-Outpaint; sonst editImage (Referenzbild als Vorlage).
async function generateFinalImage({ prompt, imageBuffer, imageType, textOnly }) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not configured");
  const sentPrompt = deescalate(prompt);
  let image;
  if (textOnly) {
    const out = await openaiImage.generateImage({ apiKey: OPENAI_KEY, prompt: sentPrompt, moderation: "low", timeoutMs: 180000 });
    try { usage.count("openai_gptimage"); } catch (_) {}
    image = out.b64 ? `data:image/png;base64,${out.b64}` : await downloadToDataUrl(out.url);
    if (openaiImage.GEN_SIZE === "1024x1536") { try { image = await outpaintTo916(image); } catch { /* 2:3 behalten */ } }
  } else {
    const { b64 } = await openaiImage.editImage({ apiKey: OPENAI_KEY, prompt: sentPrompt, imageBuffer, imageType, inputFidelity: "", moderation: "low" });
    try { usage.count("openai_gptimage"); } catch (_) {}
    image = `data:image/png;base64,${b64}`;
  }
  return image;
}

module.exports = { parseDataUrl, deescalate, downloadToDataUrl, outpaintTo916, analyze, variantPrompts, generateFinalImage };
