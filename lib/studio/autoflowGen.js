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
const cleanFlow = require("./cleanFlow");                    // Clean-Flow: fester Prompt + Varianten-Bau
const usage = require("../admin/usage");
const designRules = require("../admin/designRules");        // read-only: das destillierte Regelwerk aus R2
const designRulesPrompt = require("./designRulesPrompt");    // rein: Auswahl der passenden Regeln

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

// Das destillierte Regelwerk EINMAL je Lauf laden (A/B-Schalter an). Fehlt es oder ist R2
// nicht erreichbar, kommt null zurueck und der Lauf laeuft ohne Regelwerk weiter — der
// Schalter darf einen Lauf nie zum Scheitern bringen.
async function loadRuleset() {
  try {
    const r = await designRules.loadRuleset();
    if (!r || r.ok === false || !r.ruleset) {
      console.log("[autoflow-gen] Regelwerk nicht verfuegbar (" + ((r && r.error) || "noch keins destilliert") + ") — Lauf ohne Regelwerk");
      return null;
    }
    return r.ruleset;
  } catch (e) {
    console.error("[autoflow-gen] Regelwerk laden fehlgeschlagen:", e && e.message ? e.message : e);
    return null;
  }
}

// Die zur Referenz passenden Regelzeilen waehlen. ruleset=null (Schalter aus) -> leere Liste,
// der Prompt ist dann Zeichen fuer Zeichen der bisherige.
// opts (nur Handpfad): fehlendeRollen aus der geprueften Zuordnung statt aus der Vision,
// vorrang "original" statt der Leitidee (die es im Handpfad nicht gibt).
function ruleLinesFor(ruleset, dna, opts = {}) {
  if (!ruleset) return [];
  // Das Regelwerk ist universell; es braucht keine Stil-Kategorie mehr. Nur die fehlenden Rollen
  // steuern die Herleitungs-Zeilen (Handpfad: aus der Zuordnung; Auto-Flow: aus der DNA).
  const { lines, meta } = designRulesPrompt.selectRuleLines(ruleset, {
    fehlendeRollen: Array.isArray(opts.fehlendeRollen) ? opts.fehlendeRollen : ((dna && dna.fehlende_rollen) || []),
    vorrang: opts.vorrang || "",
  });
  console.log("[autoflow-gen] Regelwerk: " + meta.grund + (meta.rollen.length ? " | Herleitung fuer: " + meta.rollen.join(", ") : ""));
  return lines;
}

// Analyse (Sonnet) -> { dna, mainPrompt }. Identisch zum /admin/analyze Bild-Pfad.
// typo (nur Auto-Flow 2): erweiterte Analyse (Typo je Textrolle + Beispieltexte +
// Varianz) und deren wörtliche Übernahme in den Prompt.
// ruleset (A/B-Schalter): null = wie bisher; gesetzt = passende Regeln zusaetzlich im Prompt.
// handZones/infoRef (ZUSAETZLICHER Eingang aus dem Prompting Tool): geprueftes Rollen-Mapping.
// Gesetzt -> der Hauptprompt kommt aus dem Handprompt-Bauer. Nicht gesetzt -> exakt wie bisher.
async function analyze({ imageBase64, mediaType, model, loose, typo, ruleset, handZones, infoRef }) {
  if (!vision.isConfigured()) throw new Error("ANTHROPIC_API_KEY not configured");
  // leitidee: true fuer ALLE Auto-Flows (1-3) — Komposition/Verhaeltnisse voran, uebergeordnet.
  const dna = await vision.analyzeReference({ images: [{ base64: imageBase64, mediaType }], refType: "single", model, typo: !!typo, leitidee: true });
  try { usage.count("claude_analyze"); } catch (_) {}

  // ── Handpfad: die von Hand geprueften Rollen schlagen die Analyse. Von der DNA bleibt nur
  //    die Stil-Kategorie stehen (die braucht das Regelwerk, um die stilabhaengigen Regeln zu
  //    waehlen); Rollen, Texte und fehlende Rollen kommen aus der Zuordnung. Der Prompt ist
  //    derselbe, den das Prompting Tool zum Kopieren ausgibt — plus das Regelwerk, falls der
  //    A/B-Schalter an ist. Bewusst OHNE Leitidee: der Originalflyer zeigt seine Komposition
  //    bereits selbst, der Handprompt bleibt damit die unveraenderte Qualitaets-Referenz. ──
  if (Array.isArray(handZones) && handZones.length) {
    const mainPrompt = promptBuilder.buildPlaceholderPrompt(handZones, {
      infoRef: infoRef || null,
      regelLines: ruleLinesFor(ruleset, dna, {
        fehlendeRollen: promptBuilder.missingRuleRoles(handZones),
        vorrang: "original",
      }),
    });
    return { dna, mainPrompt };
  }

  const mainPrompt = promptBuilder.buildMoodboardPrompt(dna, {
    refType: "single", looseInspiration: !!loose, typo: !!typo, leitidee: true,
    regelLines: ruleLinesFor(ruleset, dna),
  });
  return { dna, mainPrompt };
}

// Clean-Flow-Varianten: EIN Sonnet-Aufruf aus dem BILD -> ein vibe_anchor (pro Lauf) + N
// Design-Familie-Vorgaben, jede zu einem kurzen Clean-Flow-Varianten-Bildprompt gebaut. Der Anker
// steht in JEDER Variante. Kein Regelwerk, keine Analyse-DNA, keine Anordnungsvorgabe.
// -> [{ label, prompt }] wie variantPrompts, damit die Kachel-Schleife sie unveraendert nutzt.
async function cleanVariants({ imageBase64, mediaType, count, model }) {
  if (!vision.isConfigured()) throw new Error("ANTHROPIC_API_KEY not configured");
  const { vibe_anchor, variants } = await vision.cleanVariantSpecs({ imageBase64, mediaType, count, model });
  try { usage.count("claude_variantspecs"); } catch (_) {}
  return (variants || []).map((s) => ({
    label: s.label || [s.color_world, s.imagery_style].filter(Boolean).join(" · ").slice(0, 70),
    prompt: cleanFlow.buildCleanVariantPrompt({ vibe_anchor, color_world: s.color_world, imagery_style: s.imagery_style }),
  }));
}

// Varianten-Prompts (Sonnet) -> [{ label, prompt }]. Identisch zu /admin/auto-variants.
// Die Varianten-VORGABEN (color_world/imagery_style/layout) kommen aus der Stil-DNA und liegen
// ALLE innerhalb des Ankers (generateVariationSpecs). handZones/infoRef (Handpfad): jede Variante
// wird ueber denselben Handprompt-Bauer gebaut wie der Hauptflyer — Rollen-Zuordnung, Regelwerk,
// Typo-Sorgfalt und Motiv-Schutz bleiben damit in jeder Variante WOERTLICH gleich; nur die drei
// Achsen wechseln.
async function variantPrompts({ dna, count, model, loose, typo, ruleset, handZones, infoRef }) {
  if (!vision.isConfigured()) throw new Error("ANTHROPIC_API_KEY not configured");
  const specs = await vision.generateVariationSpecs({ dna, count, model });
  try { usage.count("claude_variantspecs"); } catch (_) {}

  // Handpfad: Regelzeilen aus der geprueften Zuordnung, einmal waehlen, fuer alle Varianten gleich.
  if (Array.isArray(handZones) && handZones.length) {
    const regelLines = ruleLinesFor(ruleset, dna, {
      fehlendeRollen: promptBuilder.missingRuleRoles(handZones),
      vorrang: "original",
    });
    return specs.map((s) => ({
      label: s.label || [s.color_world, s.imagery_style, s.layout].filter(Boolean).join(" · ").slice(0, 70),
      prompt: promptBuilder.buildPlaceholderPrompt(handZones, {
        infoRef: infoRef || null, regelLines,
        variant: { color_world: s.color_world, imagery_style: s.imagery_style, layout: s.layout },
      }),
    }));
  }

  // Einmal waehlen, fuer alle Varianten gleich (dieselbe Referenz, dieselbe Kategorie).
  const regelLines = ruleLinesFor(ruleset, dna);
  return specs.map((s) => ({
    label: s.label || [s.color_world, s.imagery_style, s.layout].filter(Boolean).join(" · ").slice(0, 70),
    prompt: promptBuilder.buildMoodboardPrompt(dna, {
      refType: "single", looseInspiration: !!loose, typo: !!typo, leitidee: true, regelLines,
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

module.exports = { parseDataUrl, deescalate, downloadToDataUrl, outpaintTo916, loadRuleset, analyze, variantPrompts, cleanVariants, generateFinalImage };
