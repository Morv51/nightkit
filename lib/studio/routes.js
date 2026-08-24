"use strict";

// Template Studio — Admin-only Routen (additiv gemountet aus server.js via
// register(router)). Bestehende Routen/Funktionen werden nicht verändert; alles
// hier ist neu und liegt unter /admin/*. Bestehende Module werden nur lesend
// aufgerufen (ideogram.edit/download, replicate.removeObject, http-Helfer).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { readJson, sendJson, sendError } = require("../http");
const ideogram = require("../ideogram");        // read-only: edit(), download()
const replicate = require("../replicate");      // read-only: removeObject() (LaMa)
const fal = require("../fal");                   // read-only: outpaint() (FLUX.2 Pro)
const templates = require("../templates");      // read-only: TEMPLATES_DIR, loadBuffer
const keywords = require("../keywords");         // Schlagwort-Speicher (templates/keywords.json)
const jobs = require("../jobs");                 // read-only: gleiches Job-Muster wie /api/generate
const admin = require("./adminAuth");
const vision = require("./vision");
const promptBuilder = require("./promptBuilder");
const ideogramV3 = require("./ideogramV3");
const openaiImage = require("./openaiImage");      // Auto-Flow-Engine: GPT Image
const usage = require("../admin/usage");            // Nutzungs-Zähler (nachrangig, nie blockierend)
const autoflowStore = require("./autoflowStore");   // dauerhafte R2-Ablage der Auto-Flow-Ergebnisse
const autoflowRunner = require("./autoflowRunner");  // serverseitiger Auto-Flow-Orchestrator
const autoflowGen = require("./autoflowGen");        // read-only: cleanVariants (Sonnet-Vorgaben)
const cleanFlow = require("./cleanFlow");            // read-only: fester Clean-Flow-Prompt
const adminRoutes = require("../admin/routes");      // read-only: uploadTemplate() (bestehender Uploader-Weg)
const templateSource = require("../templateSource"); // Redesign: Template-Bytes aus dem Bestand
const families = require("../admin/families");       // Redesign v2: benannte Familien-Presets
const promptCore = require("../../prompts/core");    // Redesign v2: der eingefrorene Prompt-Kern
const { REDESIGN_PROMPT_MODE } = require("../../prompts/config"); // Redesign v2: 'core' | 'legacy'
const openaiText = require("./openaiText");          // Analyse-Prompt: Vision -> Text (OpenAI /v1/responses)
const analysisPrompt = require("./analysisPrompt");   // Analyse-Prompt: Vorlage lesen + Call fahren
const swapTemplate = require("../admin/swapTemplate"); // Redesign: gemeinsame Tausch-Funktion

const IDEOGRAM_KEY = process.env.IDEOGRAM_API_KEY || "";
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || "";
const FAL_KEY = process.env.FAL_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const PAGE = path.join(__dirname, "..", "..", "public", "admin", "template-studio.html");
const IMG_LIMIT = 50 * 1024 * 1024; // großzügig für (mehrere) Base64-Bilder
const toolsOn = () => process.env.ADMIN_TOOLS === "1"; // Auto-Flow-Ablage nur im Admin-Betrieb

// data:image/...;base64,... → { buffer, base64, mediaType }; null wenn ungültig.
function parseDataUrl(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buffer = Buffer.from(m[2], "base64");
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) return null; // Ideogram-Limit 10MB
  return { buffer, base64: m[2], mediaType: m[1] };
}

// Externe Bild-URL → data-URL (Download via bestehenden ideogram.download-Helfer).
async function downloadToDataUrl(url) {
  const dl = await ideogram.download(url);
  return `data:${dl.contentType};base64,${dl.buffer.toString("base64")}`;
}

// Fehlalarm-Reduktion des Inhaltsfilters bei LEGITIMEN, nicht-sexuellen Inhalten:
// bekannte Auslöser-Wörter im finalen Prompt durch neutrale Mode-/Editorial-
// Begriffe ersetzen (KEINE Regelumgehung — nur weniger Fehlalarme). Wortgrenzen,
// Groß/Klein egal. Die Stil-Analyse (vision.js) beschreibt bereits neutral; das
// hier ist der Sicherheitsnetz-Schritt direkt vor dem OpenAI-Aufruf.
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

// Best-effort: ein 1024x1536-Bild (≈2:3) auf EXAKT 9:16 (1024x1820) erweitern via
// FAL-Outpaint (+142 px oben/unten, verlustfrei, kein Crop). Schlägt das fehl oder
// fehlt der FAL-Key, kommt das 2:3-Bild unverändert zurück — NIE eine harte Fehler-
// quelle für die Generierung.
async function outpaintTo916(dataUrl) {
  if (!FAL_KEY) return dataUrl;
  try {
    const { url } = await fal.outpaint({
      imageDataUrl: dataUrl, top: 142, bottom: 142, left: 0, right: 0, outputFormat: "png",
    });
    try { usage.count("fal_outpaint"); } catch (_) {} // Nutzungs-Zähler, nachrangig
    const out = await downloadToDataUrl(url);
    console.log("[studio-generate] FAL 9:16-Outpaint ok");
    return out;
  } catch (e) {
    console.error("[studio-generate] FAL 9:16-Outpaint übersprungen:", e.message);
    return dataUrl;
  }
}

// 401-Guard für alle kostenpflichtigen Endpoints. true = Token ok.
function ok(req, res) {
  if (admin.requireAdmin(req)) return true;
  sendError(res, 401, "Admin-Token fehlt oder ist ungültig");
  return false;
}

async function body(req, res) {
  try { return await readJson(req, { limit: IMG_LIMIT }); }
  catch (e) { sendError(res, e.status || 400, e.message); return null; }
}

function register(router) {
  // ── Seite (öffentlich; enthält nur die Gate-UI, keine Secrets/Kosten) ──
  router.get("/admin/template-studio", async (req, res) => {
    try {
      const html = await fs.promises.readFile(PAGE, "utf8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.writeHead(200);
      res.end(html);
    } catch {
      sendError(res, 404, "Template Studio nicht gefunden");
    }
    return true;
  });

  // ── Code-Gate: prüft den Code serverseitig gegen ADMIN_CODES (Env), gibt
  //    bei Erfolg das signierte Token zurück. Codes nur aus Env, kein Default. ──
  router.post("/admin/auth", async (req, res) => {
    const b = await body(req, res);
    if (!b) return true;
    const label = admin.matchCode(b.code);
    if (!label) return sendError(res, 401, "Falscher Code");
    console.log(`[studio-auth] login ok: ${label}`);
    sendJson(res, 200, { token: admin.issueToken() });
    return true;
  });

  // ── Vision-Analyse: Modus 1 (Flyer → Zonen) ODER Modus 2 (Referenz(en) →
  //    Stil-DNA, 1 oder mehrere Bilder, Referenzart wählbar). ──
  router.post("/admin/analyze", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    if (!vision.isConfigured()) return sendError(res, 500, "ANTHROPIC_API_KEY not configured");

    try {
      // Modus 1 (unverändert): genau ein Flyer-Bild → Textzonen.
      if (b.mode === "flyer") {
        const pic = parseDataUrl(b.image);
        if (!pic) return sendError(res, 400, "Bild fehlt oder ist ungültig (PNG/JPEG/WebP, ≤10MB)");
        const zones = await vision.analyzeFlyer({ imageBase64: pic.base64, mediaType: pic.mediaType, model: b.model });
        try { usage.count("claude_analyze"); } catch (_) {} // Nutzungs-Zähler, nachrangig
        const prompt = promptBuilder.buildPlaceholderPrompt(zones);
        return sendJson(res, 200, { zones, prompt });
      }
      // Modus 2 (Default): eine ODER mehrere Referenzen.
      const imgs = Array.isArray(b.images) && b.images.length ? b.images : (b.image ? [b.image] : []);
      const parsed = imgs.map(parseDataUrl).filter(Boolean);
      if (!parsed.length) return sendError(res, 400, "Mindestens ein gültiges Bild nötig (PNG/JPEG/WebP, ≤10MB je Bild)");
      const images = parsed.map((p) => ({ base64: p.base64, mediaType: p.mediaType }));
      const refType = ["moodboard", "single", "multiple"].includes(b.refType) ? b.refType : "moodboard";
      const dna = await vision.analyzeReference({ images, refType, model: b.model });
      try { usage.count("claude_analyze"); } catch (_) {} // Nutzungs-Zähler, nachrangig
      // Modus B (copyright-schonend) NUR bei ausdruecklichem Flag; sonst exakt wie bisher.
      const prompt = b.promptMode === "independent"
        ? promptBuilder.buildIndependentPrompt(dna)
        : promptBuilder.buildMoodboardPrompt(dna, { refType, looseInspiration: !!b.loose });
      return sendJson(res, 200, { dna, prompt, refType });
    } catch (e) {
      console.error("studio analyze error:", e.message);
      return sendError(res, 502, "Analyse fehlgeschlagen: " + e.message);
    }
  });

  // ── Prompt aus vorhandener DNA neu bauen (frei, kein externer Call). Nimmt
  //    Referenzart + optionale Varianten-Overrides (Farbwelt/Motive/Stimmung). ──
  router.post("/admin/build-prompt", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    // Modus B nur fuer den HAUPT-Prompt (kein variant); Varianten bleiben unveraendert.
    const prompt = (b.promptMode === "independent" && !b.variant)
      ? promptBuilder.buildIndependentPrompt(b.dna || {}, { time: b.time })
      : promptBuilder.buildMoodboardPrompt(b.dna || {}, {
          refType: b.refType, variant: b.variant, time: b.time,
        });
    return sendJson(res, 200, { prompt });
  });

  // ── Auto-Varianten: N fertige Varianten-Prompts aus dem AKTUELLEN Stil-Anker.
  //    Vision erzeugt die Farb-/Motiv-/Aufbau-Vorgaben FRISCH aus dem Anker (alle
  //    innerhalb dessen Stilwelt — kein stil-fremdes Hartkodieren mehr), dann wird
  //    je Vorgabe der Varianten-Prompt gebaut. ──
  router.post("/admin/auto-variants", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    if (!b.dna || typeof b.dna !== "object") return sendError(res, 400, "Stil-Anker fehlt — erst eine Referenz analysieren");
    if (!vision.isConfigured()) return sendError(res, 500, "ANTHROPIC_API_KEY not configured");
    try {
      const specs = await vision.generateVariationSpecs({ dna: b.dna, count: b.count, model: b.model });
      try { usage.count("claude_variantspecs"); } catch (_) {} // Nutzungs-Zähler, nachrangig
      if (!specs.length) return sendError(res, 502, "Keine Varianten erzeugt — bitte erneut versuchen");
      const variants = specs.map((s) => ({
        label: s.label || [s.color_world, s.imagery_style, s.layout].filter(Boolean).join(" · ").slice(0, 70),
        prompt: promptBuilder.buildMoodboardPrompt(b.dna, {
          refType: b.refType,
          looseInspiration: !!b.loose,
          variant: { color_world: s.color_world, imagery_style: s.imagery_style, layout: s.layout },
        }),
      }));
      return sendJson(res, 200, { variants });
    } catch (e) {
      console.error("studio auto-variants error:", e.message);
      return sendError(res, 502, "Varianten fehlgeschlagen: " + e.message);
    }
  });

  // ── Varianten-Prompts (Prompting Tool, 3. Werkzeug): EIN Referenzbild -> 10 fertige
  //    Text-Prompts via Sonnet (EIN Aufruf). Nur Text, keine Bilderzeugung. Reuse: derselbe
  //    Sonnet-Aufbau (vision.visionCall-Muster) UND dieselbe Wort-Entschärfung deescalate(),
  //    damit die ausgegebenen Prompts generierungsfreundlich sind. ──
  router.post("/admin/variant-prompts", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    if (!vision.isConfigured()) return sendError(res, 500, "ANTHROPIC_API_KEY not configured");
    const pic = parseDataUrl(b.image);
    if (!pic) return sendError(res, 400, "Bild fehlt oder ist ungültig (PNG/JPEG/WebP, ≤10MB)");
    try {
      const raw = await vision.variantPrompts({ imageBase64: pic.base64, mediaType: pic.mediaType, model: "sonnet", count: 10 });
      try { usage.count("claude_variantprompts"); } catch (_) {} // Nutzungs-Zähler, nachrangig
      const prompts = raw.map((p) => deescalate(p)); // gleiche Entschärfung wie in den Flows
      if (!prompts.length) return sendError(res, 502, "Keine Prompts erhalten — bitte erneut auslösen");
      return sendJson(res, 200, { prompts, incomplete: prompts.length < 10 });
    } catch (e) {
      console.error("studio variant-prompts error:", e.message);
      return sendError(res, 502, "Prompt-Erzeugung fehlgeschlagen: " + e.message);
    }
  });

  // ── Verschlagwortung (Teil 2/4): Auto-Tags via Sonnet + manuelle Pflege ────────
  const mediaTypeFor = (f) => {
    const e = String(f).toLowerCase();
    return e.endsWith(".png") ? "image/png" : e.endsWith(".webp") ? "image/webp" : "image/jpeg";
  };

  // Einen Flyer per Sonnet verschlagworten + speichern. Bereits verschlagwortete
  // werden übersprungen (außer force=true) → günstiges Nachlaufen für neue Flyer.
  router.post("/admin/tag-one", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    if (!vision.isConfigured()) return sendError(res, 500, "ANTHROPIC_API_KEY not configured");
    const file = typeof b.file === "string" ? b.file : "";
    if (!templates.has(file)) return sendError(res, 400, "Unbekannter Flyer");
    if (!b.force && keywords.has(file)) return sendJson(res, 200, { file, keywords: keywords.get(file), skipped: true });
    try {
      const buf = await require("../templateSource").getTemplateFile(file); // R2/Repo über die Schicht
      // Haiku: nachweislich gültiges Modell (wie lib/caption.js produktiv) + für kurze
      // Schlagworte völlig ausreichend, schnell und günstig bei ~206 Flyern.
      const tags = await vision.tagFlyer({ imageBase64: buf.toString("base64"), mediaType: mediaTypeFor(file), model: "haiku" });
      try { usage.count("claude_tag"); } catch (_) {} // Nutzungs-Zähler, nachrangig
      const saved = keywords.setKeywords(file, tags);
      return sendJson(res, 200, { file, keywords: saved });
    } catch (e) {
      console.error("tag-one error:", file, e.message);
      return sendError(res, 502, "Verschlagwortung fehlgeschlagen: " + e.message);
    }
  });

  // Schlagworte eines Flyers manuell setzen (Hand-Nachbesserung, Teil 4).
  router.post("/admin/keywords", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    const file = typeof b.file === "string" ? b.file : "";
    if (!templates.has(file)) return sendError(res, 400, "Unbekannter Flyer");
    const saved = keywords.setKeywords(file, Array.isArray(b.keywords) ? b.keywords : []);
    return sendJson(res, 200, { file, keywords: saved });
  });

  // Gesamten Schlagwort-Speicher exportieren (Download → ins Repo committen = dauerhaft).
  router.get("/admin/keywords/export", (req, res) => {
    if (!ok(req, res)) return true;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="keywords.json"');
    res.setHeader("Cache-Control", "no-store");
    res.writeHead(200);
    res.end(keywords.rawJson());
    return true;
  });

  // ── Build-Prompt aus Zonen neu bauen (frei; bei Rollen-/Font-Referenz-Wechsel) ──
  router.post("/admin/build-placeholder-prompt", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    const prompt = promptBuilder.buildPlaceholderPrompt(b.zones || [], { infoRef: b.infoRef || null });
    return sendJson(res, 200, { prompt });
  });

  // ── Schritt 1a (Modus 1): Format-Normalisierung auf 9:16 via FAL Outpaint ──
  // Erweitert den Flyer VERLUSTFREI (kein Crop/Scale) auf 9:16. Die Expansions-
  // Pixel je Seite kommen vom Frontend (kennt die Bildmaße). Outpaint OHNE
  // Prompt führt Hintergrund/Stil fort und fügt keine neuen Objekte/Texte ein.
  router.post("/admin/normalize", async (req, res) => {
    if (!ok(req, res)) return true;
    if (!FAL_KEY) return sendError(res, 500, "FAL_KEY not configured");
    const b = await body(req, res);
    if (!b) return true;
    if (!parseDataUrl(b.image)) return sendError(res, 400, "Bild fehlt oder ist ungültig");
    const clamp = (n) => { const v = Math.round(Number(n) || 0); return v > 0 && v <= 8000 ? v : 0; };
    const exp = { top: clamp(b.top), bottom: clamp(b.bottom), left: clamp(b.left), right: clamp(b.right) };
    if (exp.top + exp.bottom + exp.left + exp.right === 0) return sendError(res, 400, "Keine Erweiterung angefordert");
    try {
      const { url } = await fal.outpaint({
        imageDataUrl: b.image,
        top: exp.top, bottom: exp.bottom, left: exp.left, right: exp.right,
        outputFormat: "png",
      });
      try { usage.count("fal_outpaint"); } catch (_) {} // Nutzungs-Zähler, nachrangig
      const dl = await ideogram.download(url);
      return sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}` });
    } catch (e) {
      console.error("studio normalize error:", e.message);
      return sendError(res, 502, "9:16-Erweiterung fehlgeschlagen: " + e.message);
    }
  });

  // ── Generieren (Modus 2): REINE Text-zu-Bild-Generierung. KEIN Edit, KEINE
  //    Maske, das Moodboard wird NICHT durchgereicht — nur sein per Vision
  //    extrahierter Stil steckt im Prompt. Engine wählbar: GPT Image 2 (OpenAI,
  //    Default) oder Ideogram, beide als reine Generierung. ──
  router.post("/admin/generate", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    if (!b.prompt) return sendError(res, 400, "Prompt fehlt");
    const engine = b.engine === "ideogram" ? "ideogram" : "openai";

    try {
      if (engine === "openai") {
        if (!OPENAI_KEY) return sendError(res, 500, "GPT Image nicht konfiguriert — OPENAI_API_KEY in Render setzen");
        const out = await openaiImage.generateImage({ apiKey: OPENAI_KEY, prompt: b.prompt });
        try { usage.count("openai_gptimage"); } catch (_) {} // Nutzungs-Zähler, nachrangig
        let dataUrl = out.b64 ? `data:image/png;base64,${out.b64}` : await downloadToDataUrl(out.url);
        // 1024x1536 (≈2:3) → exakt 9:16 via FAL-Outpaint (best-effort, nicht blockierend).
        if (openaiImage.GEN_SIZE === "1024x1536") dataUrl = await outpaintTo916(dataUrl);
        console.log("[studio-generate] openai ok");
        return sendJson(res, 200, { image: dataUrl, engine });
      }
      // engine === "ideogram": reine Generierung OHNE Style-Reference
      if (!IDEOGRAM_KEY) return sendError(res, 500, "IDEOGRAM_API_KEY not configured");
      const { url } = await ideogramV3.generate({ apiKey: IDEOGRAM_KEY, prompt: b.prompt });
      try { usage.count("ideogram_generate"); } catch (_) {} // Nutzungs-Zähler, nachrangig
      const dl = await ideogram.download(url);
      return sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}`, engine });
    } catch (e) {
      // Genaue Engine-Fehlermeldung loggen (für Diagnose), Klartext ans UI.
      console.error(`studio generate error [${engine}]:`, e.message, e.response || "");
      return sendError(res, 502, "Generierung fehlgeschlagen: " + e.message);
    }
  });

  // ── Platzhalter einsetzen / Korrigieren (bestehendes edit()) — Modus 1/beide ──
  router.post("/admin/edit", async (req, res) => {
    if (!ok(req, res)) return true;
    if (!IDEOGRAM_KEY) return sendError(res, 500, "IDEOGRAM_API_KEY not configured");
    const b = await body(req, res);
    if (!b) return true;
    if (!b.prompt) return sendError(res, 400, "Prompt fehlt");
    const pic = parseDataUrl(b.image);
    if (!pic) return sendError(res, 400, "Bild fehlt oder ist ungültig");
    try {
      // Bestehender edit()-Flow, unverändert: Bild als Basis, magic_prompt OFF (Default).
      const { url } = await ideogram.edit({ apiKey: IDEOGRAM_KEY, prompt: b.prompt, imageBuffer: pic.buffer });
      try { usage.count("ideogram_edit"); } catch (_) {} // Nutzungs-Zähler, nachrangig
      const dl = await ideogram.download(url);
      return sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}` });
    } catch (e) {
      console.error("studio edit error:", e.message, e.response || "");
      return sendError(res, 502, "Bearbeitung fehlgeschlagen: " + e.message);
    }
  });

  // ── 2. Bild-Engine: GPT Image (OpenAI), getrennter Pfad zum Vergleich. Bild
  //    als Basis (Image-to-Image), gleicher Prompt. Key aus Env, kein Crash
  //    wenn er fehlt. magic_prompt existiert hier nicht (OpenAI-spezifisch). ──
  router.post("/admin/edit-openai", async (req, res) => {
    if (!ok(req, res)) return true;
    if (!OPENAI_KEY) return sendError(res, 500, "GPT Image nicht konfiguriert — OPENAI_API_KEY in Render setzen");
    const b = await body(req, res);
    if (!b) return true;
    if (!b.prompt) return sendError(res, 400, "Prompt fehlt");
    const pic = parseDataUrl(b.image);
    if (!pic) return sendError(res, 400, "Bild fehlt oder ist ungültig");
    try {
      const { b64 } = await openaiImage.editImage({
        apiKey: OPENAI_KEY, prompt: b.prompt, imageBuffer: pic.buffer, imageType: pic.mediaType,
      });
      try { usage.count("openai_gptimage"); } catch (_) {} // Nutzungs-Zähler, nachrangig
      return sendJson(res, 200, { image: `data:image/png;base64,${b64}` });
    } catch (e) {
      console.error("studio openai edit error:", e.message, e.response || "");
      return sendError(res, 502, "GPT Image fehlgeschlagen: " + e.message);
    }
  });

  // ── Auto-Flow (Beta): Ein-Flyer-Generierung via die OFFIZIELLE OpenAI-Bild-API
  //    (GPT Image) — EINZIGE Engine. Referenzbild als Vorlage (Buffer, keine URL)
  //    + unser (wort-entschärfter) Prompt → neuer Flyer. moderation="low" =
  //    tolerantere Filterstufe (Fehlalarm-Reduktion bei legitimen Inhalten).
  //    KEIN Ideogram/Segmind, KEINE ChatGPT-Weboberfläche.
  //
  //    ASYNCHRON (Job-Muster wie /api/generate): sofort 202 + jobId, Generierung im
  //    HINTERGRUND (editImage hat 180 s Timeout), Frontend pollt /admin/auto-
  //    generate/<jobId> → KEIN Inbound-Request bleibt lange offen, kein Render-
  //    Gateway-502. Inhaltliche Ablehnung kommt als Klartext-Fehler im Job zurück. ──
  router.post("/admin/auto-generate", async (req, res) => {
    if (!ok(req, res)) return true;
    if (!OPENAI_KEY) return sendError(res, 500, "GPT Image nicht konfiguriert — OPENAI_API_KEY in Render setzen");
    const b = await body(req, res);
    if (!b) return true;
    if (!b.prompt) return sendError(res, 400, "Prompt fehlt");
    // Auto-Flow 2 Pfad B ("Weit"): KEIN Referenzbild — reine Text-zu-Bild-Generierung.
    const textOnly = !!b.textOnly;
    const pic = textOnly ? null : parseDataUrl(b.image);
    if (!textOnly && !pic) return sendError(res, 400, "Referenzbild fehlt oder ist ungültig (PNG/JPEG/WebP, ≤10MB)");

    // GENAU der Wortlaut, der an die API geht (nach Entschärfung) — in der 202-
    // Antwort mitgeben, damit das Frontend exakt diesen Prompt anzeigen/kopieren
    // kann (auch wenn die Generierung danach blockiert wird).
    const sentPrompt = deescalate(b.prompt);
    const jobId = jobs.create();
    sendJson(res, 202, { jobId, prompt: sentPrompt });

    const t0 = Date.now();
    (async () => {
      let image;
      if (textOnly) {
        // Pfad B: reine Text-zu-Bild-Generierung (KEIN Eingabebild), danach 9:16-
        // Outpaint (best-effort; ohne FAL_KEY bleibt es beim ~2:3-Hochformat).
        const out = await openaiImage.generateImage({ apiKey: OPENAI_KEY, prompt: sentPrompt, moderation: "low", timeoutMs: 180000 });
        try { usage.count("openai_gptimage"); } catch (_) {} // Nutzungs-Zähler, nachrangig
        image = out.b64 ? `data:image/png;base64,${out.b64}` : await downloadToDataUrl(out.url);
        if (openaiImage.GEN_SIZE === "1024x1536") { try { image = await outpaintTo916(image); } catch { /* 2:3 behalten */ } }
      } else {
        // Pfad A (und Auto-Flow 1): Referenzbild als Vorlage (Edit / Image-to-Image).
        const { b64 } = await openaiImage.editImage({
          apiKey: OPENAI_KEY,
          prompt: sentPrompt,             // exakt der oben zurückgegebene Prompt
          imageBuffer: pic.buffer,
          imageType: pic.mediaType,
          inputFidelity: "",              // CREATE: neu im Stil der Referenz, nicht bewahren
          moderation: "low",              // tolerantere Filterstufe
        });
        try { usage.count("openai_gptimage"); } catch (_) {} // Nutzungs-Zähler, nachrangig
        image = `data:image/png;base64,${b64}`;
      }
      const ms = Date.now() - t0;
      console.log(`[studio-autoflow] ${textOnly ? "text->image" : "GPT Image"} ok in ${ms} ms (job ${jobId})`);
      jobs.set(jobId, { status: "done", image, ms, engine: "openai" });
    })().catch((e) => {
      console.error("studio auto-generate (openai) error:", e.message, e.response || "");
      jobs.set(jobId, { status: "error", error: "Generierung (GPT Image) fehlgeschlagen: " + e.message });
    });
    return true;
  });

  // ── Status-Polling für den Auto-Flow (admin-geschützt). Gibt den Job zurück;
  //    nach einem terminalen Status (done/error) wird er entfernt. ──
  router.get(/^\/admin\/auto-generate\/([a-f0-9]+)$/, (req, res, params) => {
    if (!ok(req, res)) return true;
    const jobId = params && params[0];
    const job = jobs.get(jobId);
    if (!job) return sendError(res, 404, "Auftrag nicht gefunden (evtl. abgelaufen) — bitte erneut starten");
    sendJson(res, 200, job);
    if (job.status !== "pending") jobs.remove(jobId);
    return true;
  });

  // ── Auto-Flow-Ergebnisse dauerhaft in R2 (nur ADMIN_TOOLS=1). REIN ADDITIV: der Lauf
  //    selbst bleibt unveraendert; das Frontend speichert JEDES fertige Bild sofort ueber
  //    save-image. runs/delete versorgen die Ansicht "Letzte Laeufe". ──
  router.post("/admin/autoflow/save-image", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    if (!b.runId || !b.index) return sendError(res, 400, "runId und index noetig");
    const pic = parseDataUrl(b.image);
    if (!pic) return sendError(res, 400, "Bild fehlt oder ist ungueltig");
    try {
      const r = await autoflowStore.saveImage({
        runId: b.runId, index: b.index, createdAt: b.createdAt,
        flow: b.flow, mode: b.mode, sourceName: b.sourceName, imageBuffer: pic.buffer,
      });
      sendJson(res, 200, r);
    } catch (e) { sendError(res, 502, "Speichern fehlgeschlagen: " + (e && e.message ? e.message : e)); }
    return true;
  });

  // ── Gespeicherte Laeufe auflisten (neueste zuerst), inkl. Aufbewahrung (aeltere raus). ──
  router.post("/admin/autoflow/runs", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    try { sendJson(res, 200, await autoflowStore.listRuns()); }
    catch (e) { sendError(res, 502, "Laeufe konnten nicht geladen werden: " + (e && e.message ? e.message : e)); }
    return true;
  });

  // ── Den TATSAECHLICH GESENDETEN Bildprompt eines Laufs ausliefern (Haupt + Varianten je
  //    Datei). Bewusst ein EIGENER Endpunkt auf Abruf statt in /runs: die Laufliste wird alle
  //    4 s gepollt, und die Prompts sind je einige tausend Zeichen — die gehoeren nicht in
  //    jeden Poll. Reine Anzeige aus der run.json, veraendert nichts. ──
  router.post("/admin/autoflow/prompt", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    if (!b.runId) return sendError(res, 400, "runId noetig");
    try {
      const state = await autoflowStore.getState(b.runId);
      if (!state) return sendError(res, 404, "Lauf nicht gefunden");
      const files = (Array.isArray(state.files) ? state.files : []).map((f) => ({
        fnum: f.fnum,
        name: f.name || "",
        hand: !!(f.handZones && f.handZones.length),
        mainPrompt: f.mainPrompt || "",
        analyzeError: f.analyzeError || null,
        variantPrompts: (Array.isArray(f.variantPrompts) ? f.variantPrompts : [])
          .map((v, i) => ({ num: i + 1, label: (v && v.label) || "", prompt: (v && v.prompt) || "" })),
      }));
      sendJson(res, 200, { ok: true, runId: b.runId, regelwerk: !!state.regelwerk, hand: !!state.hand, files });
    } catch (e) { sendError(res, 502, "Prompt nicht ladbar: " + (e && e.message ? e.message : e)); }
    return true;
  });

  // ── Einen einzelnen Lauf loeschen. ──
  router.post("/admin/autoflow/delete", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    if (!b.runId) return sendError(res, 400, "runId noetig");
    try { sendJson(res, 200, await autoflowStore.deleteRun(b.runId)); }
    catch (e) { sendError(res, 502, "Loeschen fehlgeschlagen: " + (e && e.message ? e.message : e)); }
    return true;
  });

  // ── Serverseitiger Auto-Flow-Lauf: Start (gibt sofort eine Lauf-ID), Abbrechen, Fortsetzen.
  //    Der Lauf laeuft danach im Server weiter, auch wenn der Browser schliesst. Inhalt
  //    identisch (autoflowGen spiegelt Analyse/Generierung/Outpaint). Nur ADMIN_TOOLS=1. ──
  router.post("/admin/autoflow/start", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    if (!Array.isArray(b.files) || !b.files.length) return sendError(res, 400, "Keine Dateien");
    try {
      const r = await autoflowRunner.startRun({
        flow: b.flow, mode: b.mode, loose: b.loose, textOnly: b.textOnly,
        variants: b.variants, model: b.model, refType: b.refType, files: b.files,
        regelwerk: !!b.regelwerk, // A/B-Schalter: Regelwerk in den Bildprompt?
        cleanFlow: !!b.cleanFlow, // Clean-Flow: fester, kurzer Prompt statt Analyse/Regelwerk
        cleanSubject: b.subject !== false, // Clean-Flow-Varianten: Mit(true)/Ohne(false) Hauptmotiv
        cleanArtwork: !!b.artwork, // Clean-Flow-Artwork: Foto -> Flyer
        cleanRedesign: !!b.redesign, // Clean-Flow-Redesign: Bestands-Template, nur Textsetzung neu
        cleanFamilyText: b.familyText, // Redesign v2: die Auftrags-Familie (Bauteil 3), leer erlaubt
      });
      sendJson(res, 200, r);
    } catch (e) { sendError(res, 502, "Start fehlgeschlagen: " + (e && e.message ? e.message : e)); }
    return true;
  });

  // ── Clean-Flow Prompt-VORSCHAU: laeuft den Weg bis zum fertigen Bildprompt und stoppt dort.
  //    Nachbau -> der feste Prompt (kein Sonnet). Varianten -> EIN Sonnet-Aufruf fuer die Vorgaben,
  //    dann die N Prompts gebaut. KEIN editImage, KEINE Bildkosten, KEINE R2-Ablage, KEIN Lauf.
  //    Zweck: Prompt-Aenderungen pruefen, ohne pro Iteration Bilder zu bezahlen. ──
  router.post("/admin/clean/preview", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const variants = Math.max(0, Math.min(10, parseInt(b.variants, 10) || 0));
    try {
      if (variants <= 0) {
        return sendJson(res, 200, { ok: true, prompts: [{ label: "Nachbau", prompt: cleanFlow.CLEAN_PROMPT }] });
      }
      const pic = autoflowGen.parseDataUrl(b.dataUrl);
      if (!pic) return sendError(res, 400, "Ungueltiges Bild");
      const base = {
        imageBase64: pic.buffer.toString("base64"), mediaType: pic.mediaType,
        count: variants, model: b.model || "sonnet",
      };
      // Artwork: eigener Regie-Aufruf. Die Vorschau gibt zusaetzlich den ROHTEXT zurueck, damit
      // sichtbar wird, ob Sonnet ins Beschreiben rutscht. Nur hier, nicht im Lauf.
      if (b.artwork) {
        const out = await autoflowGen.cleanArtworks(base);
        if (!out.prompts.length) return sendError(res, 502, "Keine Regie erhalten");
        return sendJson(res, 200, { ok: true, prompts: out.prompts, raw: out.raw || "" });
      }
      const prompts = await autoflowGen.cleanVariants({ ...base, subject: b.subject !== false });
      if (!prompts.length) return sendError(res, 502, "Keine Varianten-Vorgaben erhalten");
      sendJson(res, 200, { ok: true, prompts });
    } catch (e) { sendError(res, 502, "Vorschau fehlgeschlagen: " + (e && e.message ? e.message : e)); }
    return true;
  });

  // ── REDESIGN: Vorschau, Tausch, Verwerfen. Eigene Routen, damit der Clean-Flow-Weg
  //    (/admin/clean/preview) unberuehrt bleibt. ──

  // Nur Prompts: der komplett gebaute Bildprompt je Kandidat, VOR bezahlten Laeufen.
  //   core   — reine Assemblierung aus Kern + Karten + Familie, KEIN Sonnet-Aufruf, KOSTENLOS.
  //            rank = Position in der Auswahl -> deckt sich exakt mit dem spaeteren Lauf.
  //            Ohne family_text zeigt die Vorschau den Kern mit klar markiertem Platzhalter-Absatz.
  //   legacy — der bisherige Weg: EIN Sonnet-Regie-Aufruf je Vorlage (kostet), Rohtext dabei.
  const FAM_PLACEHOLDER = "⟨ FAMILIE: fuer diesen Auftrag nicht gesetzt — im echten Lauf entfaellt dieser Absatz ersatzlos ⟩";
  router.post("/admin/redesign/preview", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const files = Array.isArray(b.files) ? b.files.slice(0, 12) : [];
    if (!files.length) return sendError(res, 400, "Keine Vorlagen gewaehlt");
    const items = [];

    if (REDESIGN_PROMPT_MODE === "core") {
      const famReal = String(b.familyText || "").trim();
      const famUsed = famReal || FAM_PLACEHOLDER; // Anzeige-Platzhalter, wenn keine Familie gesetzt
      const placeholders = promptCore.placeholderList(promptCore.FULL_REDESIGN_FIELDS);
      files.forEach((f, i) => {
        const rel = typeof f === "string" ? f : String((f && f.template) || "");
        const name = (f && f.name) || rel;
        if (!rel) return;
        const built = autoflowGen.redesignCorePrompt({ familyText: famUsed, rank: i });
        items.push({
          template: rel, name, raw: "", direction: "",
          prompt: built.prompt, label: built.layoutKey + " · " + built.mediumKey,
          layoutKey: built.layoutKey, mediumKey: built.mediumKey,
          placeholders, familyUsed: !!famReal, error: "",
        });
      });
      sendJson(res, 200, { ok: true, mode: "core", family: famReal, items });
      return true;
    }

    // legacy: Sonnet-Regie mit Richtungs-Rotation (Offset aus dem Vorschau-Moment).
    const dirs = autoflowGen.REDESIGN_DIRECTIONS || [];
    const dirOff = dirs.length ? Date.now() % dirs.length : 0;
    let dirIdx = 0;
    for (const f of files) {
      const rel = typeof f === "string" ? f : String((f && f.template) || "");
      const name = (f && f.name) || rel;
      if (!rel) continue;
      const direction = dirs.length ? dirs[(dirOff + dirIdx++) % dirs.length] : "";
      try {
        const buf = await templateSource.getTemplateFile(rel);
        const out = await autoflowGen.cleanRedesign({
          imageBase64: buf.toString("base64"),
          mediaType: /\.png$/i.test(rel) ? "image/png" : /\.webp$/i.test(rel) ? "image/webp" : "image/jpeg",
          model: b.model || "sonnet",
          direction,
        });
        const p = out.prompts[0];
        items.push({ template: rel, name, raw: out.raw || "", direction,
          prompt: p ? p.prompt : "", label: p ? p.label : "", error: p ? "" : "Keine Regie erhalten" });
      } catch (e) {
        items.push({ template: rel, name, prompt: "", label: "", raw: "", direction, error: (e && e.message) ? e.message : String(e) });
      }
    }
    sendJson(res, 200, { ok: true, mode: "legacy", items });
    return true;
  });

  // Redesign v2, Bauteil 3: Familie aus der aktuellen Auswahl wuerfeln (2-3 Bilder -> {accent,
  // tone} -> fester Familien-Absatz). EIN Sonnet-Aufruf, Kosten claude_familyspecs.
  router.post("/admin/redesign/family-roll", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const files = (Array.isArray(b.files) ? b.files : []).slice(0, 3);
    if (!files.length) return sendError(res, 400, "Keine Vorlagen gewaehlt");
    try {
      const images = [];
      for (const f of files) {
        const rel = typeof f === "string" ? f : String((f && f.template) || "");
        if (!rel) continue;
        const buf = await templateSource.getTemplateFile(rel);
        images.push({ base64: buf.toString("base64"), mediaType: /\.png$/i.test(rel) ? "image/png" : /\.webp$/i.test(rel) ? "image/webp" : "image/jpeg" });
      }
      const out = await autoflowGen.redesignFamilyRoll({ images, model: b.model || "sonnet", voice: b.voice });
      sendJson(res, 200, { ok: true, accent: out.accent, tone: out.tone, voice: out.voice, family_text: out.family_text });
    } catch (e) { sendError(res, 502, "Familie wuerfeln fehlgeschlagen: " + (e && e.message ? e.message : e)); }
    return true;
  });

  // Gespeicherte Familien: auflisten / speichern / loeschen (benannte Presets, keine Kategorie).
  router.get("/admin/redesign/families", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    try { sendJson(res, 200, { ok: true, families: await families.list() }); }
    catch (e) { sendError(res, 502, "Familien laden fehlgeschlagen: " + (e && e.message ? e.message : e)); }
    return true;
  });
  router.post("/admin/redesign/family-save", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    try {
      const saved = await families.save(b.name, { family_text: b.family_text, accent: b.accent, tone: b.tone, voice: b.voice });
      sendJson(res, 200, { ok: true, family: saved });
    } catch (e) { sendError(res, 400, "Speichern fehlgeschlagen: " + (e && e.message ? e.message : e)); }
    return true;
  });
  router.post("/admin/redesign/family-delete", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    try { await families.remove(b.name); sendJson(res, 200, { ok: true }); }
    catch (e) { sendError(res, 502, "Loeschen fehlgeschlagen: " + (e && e.message ? e.message : e)); }
    return true;
  });

  // Original ersetzen: Kandidat aus dem Lauf an die Stelle seiner Vorlage (gemeinsame
  // Tausch-Funktion inkl. Kategoriebild). Doppel-Tausch wird ueber den Marker verhindert.
  router.post("/admin/redesign/swap", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const { runId, index } = b;
    if (!runId || !index) return sendError(res, 400, "runId und index noetig");
    try {
      const done = await autoflowStore.getMarker(runId, "swapped", index);
      if (done && done.newRel) return sendJson(res, 200, { ok: true, already: true, newRel: done.newRel });
      // Quell-Pfad aus dem Lauf-Zustand ueber die fnum des Kachel-Index ("<fnum>-v<k>").
      const state = await autoflowStore.getState(runId);
      const fnum = parseInt(String(index).split("-")[0], 10);
      const src = state && Array.isArray(state.files) ? state.files.find((f) => f.fnum === fnum) : null;
      const orig = src && src.srcTemplate;
      if (!orig) return sendError(res, 400, "Kein Quell-Template zu diesem Kandidaten gespeichert");
      const buf = await autoflowStore.getResultImage(runId, index);
      const out = await swapTemplate.swapTemplate({ origFile: orig, imageBuffer: buf });
      try {
        await autoflowStore.setMarker(runId, "swapped", index, {
          orig, newRel: out.newRel, coverMoved: out.coverMoved, at: new Date().toISOString(),
        });
      } catch (_) { /* Tausch ist erfolgt; der Marker ist nur Komfort, nie blockierend */ }
      sendJson(res, 200, { ok: true, already: false, ...out, orig });
    } catch (e) {
      sendError(res, e.status || 502, e.status ? e.message : "Tausch fehlgeschlagen: " + (e && e.message ? e.message : e));
    }
    return true;
  });

  // Kandidat verwerfen: reine Markierung, im Bestand aendert sich NICHTS.
  router.post("/admin/redesign/discard", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const { runId, index } = b;
    if (!runId || !index) return sendError(res, 400, "runId und index noetig");
    try {
      await autoflowStore.setMarker(runId, "discarded", index, { at: new Date().toISOString() });
      sendJson(res, 200, { ok: true });
    } catch (e) { sendError(res, 502, "Verwerfen fehlgeschlagen: " + (e && e.message ? e.message : e)); }
    return true;
  });

  router.post("/admin/autoflow/cancel", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    if (!b.runId) return sendError(res, 400, "runId noetig");
    try { sendJson(res, 200, await autoflowRunner.cancelRun(b.runId)); }
    catch (e) { sendError(res, 502, "Abbrechen fehlgeschlagen: " + (e && e.message ? e.message : e)); }
    return true;
  });

  router.post("/admin/autoflow/resume", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    if (!b.runId) return sendError(res, 400, "runId noetig");
    try { sendJson(res, 200, await autoflowRunner.resumeRun(b.runId)); }
    catch (e) { sendError(res, 502, "Fortsetzen fehlgeschlagen: " + (e && e.message ? e.message : e)); }
    return true;
  });

  // ── Ein fertiges Auto-Flow-Ergebnis DIREKT in den Live-Template-Bestand uebernehmen
  //    (nur ADMIN_TOOLS=1, schreibend -> Admin-Code geprueft). REIN ADDITIV: der Lauf und
  //    die Lauf-Ansicht bleiben unveraendert. Das gespeicherte PNG wird serverseitig aus
  //    R2 gelesen (kein Download/Upload ueber das Geraet) und ueber den EXISTIERENDEN
  //    Uploader-Kern (adminRoutes.uploadTemplate) als normales Template angelegt: JPEG +
  //    WebP-Thumbnail, Discovery-Registry, Anzeigename, automatische Verschlagwortung, in
  //    der gewaehlten (auch neu angelegten) Kategorie. Ein Uebernahme-Marker verhindert
  //    Doppel-Uebernahme geraeteuebergreifend und erzeugt das Haekchen in der Ansicht. ──
  router.post("/admin/autoflow/adopt", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const runId = b.runId, index = b.index;
    if (!runId || !index) return sendError(res, 400, "runId und index noetig");
    try {
      // Doppel-Uebernahme verhindern (serverseitig, geraeteuebergreifend).
      const existing = await autoflowStore.getAdoption(runId, index);
      if (existing && existing.file) {
        return sendJson(res, 200, { ok: true, alreadyAdopted: true, file: existing.file, name: existing.name, category: existing.category });
      }
      // Ergebnisbild aus R2 lesen und ueber den bestehenden Uploader-Weg anlegen.
      const buf = await autoflowStore.getResultImage(runId, index);
      const out = await adminRoutes.uploadTemplate({
        category: b.category, imageBuffer: buf, autoTag: b.autoTag !== false, name: b.name,
      });
      // Uebernahme-Marker schreiben (Haekchen + Doppelschutz).
      try {
        await autoflowStore.setAdoption(runId, index, {
          file: out.file, name: out.name, category: out.category, at: new Date().toISOString(),
        });
      } catch (_) { /* Template ist angelegt; der Marker ist nur Komfort, nie blockierend */ }
      sendJson(res, 200, { ...out, alreadyAdopted: false });
    } catch (e) {
      sendError(res, e.status || 502, e.status ? e.message : "Uebernahme fehlgeschlagen: " + (e && e.message ? e.message : e));
    }
    return true;
  });

  // ── Bereinigen (bestehendes LaMa-Removal via Replicate) — beide Modi ──
  router.post("/admin/remove", async (req, res) => {
    if (!ok(req, res)) return true;
    if (!REPLICATE_TOKEN) return sendError(res, 500, "REPLICATE_API_TOKEN not configured");
    const b = await body(req, res);
    if (!b) return true;
    if (!parseDataUrl(b.image)) return sendError(res, 400, "Bild fehlt oder ist ungültig");
    if (!parseDataUrl(b.mask)) return sendError(res, 400, "Maske fehlt oder ist ungültig");
    try {
      // Bestehender LaMa-Flow, unverändert (Maske WEISS = entfernen).
      const { url } = await replicate.removeObject({
        token: REPLICATE_TOKEN,
        imageDataUrl: b.image,
        maskDataUrl: b.mask,
      });
      try { usage.count("replicate_remove"); } catch (_) {} // Nutzungs-Zähler, nachrangig
      const dl = await ideogram.download(url);
      return sendJson(res, 200, { image: `data:${dl.contentType};base64,${dl.buffer.toString("base64")}` });
    } catch (e) {
      console.error("studio remove error:", e.message);
      return sendError(res, 502, "Bereinigen fehlgeschlagen: " + e.message);
    }
  });

  // ── Optionales Speichern in die Galerie (ADDITIV) ──
  // Schreibt das Bild nach /templates/, legt Sidecar-Metadaten an und hängt
  // einen Manifest-Eintrag (Kategorie "Studio") an — der bestehende Galerie-
  // Flow wird nur ergänzt, nicht verändert. ACHTUNG: Render-FS ist ephemer →
  // geht beim nächsten Deploy verloren (Caveat ans Frontend zurückgegeben).
  router.post("/admin/save", async (req, res) => {
    if (!ok(req, res)) return true;
    const b = await body(req, res);
    if (!b) return true;
    const pic = parseDataUrl(b.image);
    if (!pic) return sendError(res, 400, "Bild fehlt oder ist ungültig");

    const id = "studio-" + crypto.randomBytes(5).toString("hex");
    const ext = pic.mediaType === "image/jpeg" ? "jpeg" : pic.mediaType === "image/webp" ? "webp" : "png";
    const file = id + "." + ext;
    const name = (typeof b.name === "string" && b.name.trim()) || ("Studio " + id.slice(-4));
    const dir = templates.TEMPLATES_DIR;

    try {
      await fs.promises.writeFile(path.join(dir, file), pic.buffer);

      // Sidecar-Metadaten (verändert templates.json nicht).
      const metaDir = path.join(dir, "studio-meta");
      await fs.promises.mkdir(metaDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(metaDir, id + ".json"),
        JSON.stringify({
          file, name, mode: b.mode || null, prompt: b.prompt || null,
          dna: b.dna || null, zones: b.zones || null, styleAdherence: b.styleAdherence ?? null,
          createdAt: new Date().toISOString(),
        }, null, 2)
      );

      // Manifest additiv erweitern (bestehende Einträge bleiben unangetastet).
      // Kompaktes Zeilenformat wie das Original beibehalten → Diff = nur eine
      // neue Zeile pro Save, nicht die ganze Datei umformatiert.
      const manifestPath = path.join(dir, "templates.json");
      let arr = [];
      try { arr = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")); } catch {}
      if (Array.isArray(arr)) {
        arr.push({ file, name, category: "Studio" });
        // Exaktes Original-Format: { "k": v, "k2": v2 } mit Leerzeichen, ein
        // Eintrag pro Zeile → bestehende Zeilen bleiben byte-identisch.
        const fmtEntry = (e) =>
          "  { " + Object.entries(e).map(([k, val]) => JSON.stringify(k) + ": " + JSON.stringify(val)).join(", ") + " }";
        const text = "[\n" + arr.map(fmtEntry).join(",\n") + "\n]\n";
        await fs.promises.writeFile(manifestPath, text);
      }

      return sendJson(res, 200, {
        file, name,
        warning: "Gespeichert. Hinweis: Auf Render geht das beim nächsten Deploy verloren — für dauerhaft den Export nutzen und committen.",
      });
    } catch (e) {
      console.error("studio save error:", e.message);
      return sendError(res, 500, "Speichern fehlgeschlagen: " + e.message);
    }
  });

  // ── Analyse-Prompt-Generator (Admin-Werkzeug "Analyse-Prompt") ────────────
  //    Referenzflyer + Genre + Vibe -> EIN Modell-Call -> ein fertiger
  //    Bildgenerierungs-Prompt zum Kopieren. Erzeugt SELBST KEIN BILD und
  //    speichert NICHTS (kein R2, keine Datenbank) — das Bild geht durch den
  //    Call und wird verworfen.
  //
  //    Laeuft hinter dem JOB-MUSTER von /api/generate. Grund: server.timeout ist
  //    ein Inaktivitaets-Timeout von 120 s. Waehrend das Modell rechnet, fliesst
  //    auf dem Browser-Socket kein Byte — ein Reasoning-Call auf hoechster Stufe
  //    liegt absehbar darueber und wuerde mitten im BEZAHLTEN Lauf abgeschnitten.
  //    Darum: annehmen, sofort mit jobId antworten, im Hintergrund weiterrechnen.

  //    Lesezeichenfaehiger Direktpfad -> Reiter im Studio (Muster /admin/manage).
  router.get("/admin/analysis-prompt", async (req, res) => {
    res.setHeader("Location", "/admin/template-studio#aprompt");
    res.setHeader("Cache-Control", "no-cache");
    res.writeHead(302);
    res.end();
    return true;
  });

  //    Verfuegbarkeit: schaltet den Reiter frei und meldet die geltende Konfiguration.
  router.post("/admin/aprompt/ping", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    sendJson(res, 200, {
      ok: true,
      configured: !!OPENAI_KEY,
      model: openaiText.MODEL,
      effort: openaiText.EFFORT,
      verbosity: openaiText.VERBOSITY,
      maxOutput: openaiText.MAX_OUTPUT,
      classifyModel: openaiText.CLASSIFY_MODEL,
      classifyEffort: openaiText.CLASSIFY_EFFORT,
    });
    return true;
  });

  //    Start: annehmen, sofort jobId zurueck, Modell-Call im Hintergrund.
  router.post("/admin/aprompt/run", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    if (!OPENAI_KEY) return sendError(res, 500, "OpenAI nicht konfiguriert — OPENAI_API_KEY in Render setzen");
    const pic = parseDataUrl(b.image);
    if (!pic) return sendError(res, 400, "Referenzflyer fehlt oder ist kein PNG/JPEG/WebP unter 10 MB");
    const genre = String(b.genre || "").trim();
    const vibe = String(b.vibe || "").trim();
    if (!genre) return sendError(res, 400, "Genre fehlt");
    if (!vibe) return sendError(res, 400, "Vibe fehlt");

    const jobId = jobs.create(30 * 60 * 1000);
    sendJson(res, 202, { jobId });

    (async () => {
      try {
        const out = await analysisPrompt.run({
          apiKey: OPENAI_KEY, imageBase64: pic.base64, imageType: pic.mediaType, genre, vibe,
        });
        usage.count("openai_promptgen");
        jobs.set(jobId, { status: "done", text: out.text, model: out.model, effort: out.effort });
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error("aprompt error:", msg);
        jobs.set(jobId, { status: "error", error: msg, incomplete: !!(e && e.incomplete) });
      }
    })();
    return true;
  });

  //    Genre/Vibe-Vorschlag: kleiner Zweit-Call, nur Bild + prompts/genre_vibe.txt.
  //    KEIN Job-Muster — die Antwort sind zwei Zeilen von einem guenstigen Modell
  //    auf niedriger Stufe, das eigene Zeitlimit liegt deutlich unter den 120 s
  //    des Sockets. Startet die Hauptanalyse NICHT.
  router.post("/admin/aprompt/suggest", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    if (!OPENAI_KEY) return sendError(res, 500, "OpenAI nicht konfiguriert — OPENAI_API_KEY in Render setzen");
    const pic = parseDataUrl(b.image);
    if (!pic) return sendError(res, 400, "Referenzflyer fehlt oder ist kein PNG/JPEG/WebP unter 10 MB");
    try {
      const out = await analysisPrompt.suggest({ apiKey: OPENAI_KEY, imageBase64: pic.base64, imageType: pic.mediaType });
      usage.count("openai_promptgen_gv");
      sendJson(res, 200, { genre: out.genre, vibe: out.vibe, model: out.model });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.error("aprompt suggest error:", msg);
      sendError(res, 502, msg);
    }
    return true;
  });

  //    Produktionsprompt als Auto-Flow-Lauf starten: drei Varianten, dieselbe Vorgabe,
  //    KEIN Referenzbild. Bewusst eine EIGENE Route statt /admin/autoflow/start, damit
  //    dessen Datei-Pflicht und die bestehenden Panels unberuehrt bleiben. Alle Eckwerte
  //    setzt der Server, der Browser schickt nur den Prompt.
  //
  //    rawPrompt: true -> deescalate greift NICHT. Der Produktionsprompt geht so an das
  //    Modell, wie er erzeugt wurde. Fuer alle bestehenden Wege bleibt deescalate aktiv.
  //
  //    Ergebnisse landen wie bei jedem Lauf in R2 unter templates/_autoflow/<runId>/ und
  //    erscheinen im Reiter "Letzte Laeufe".
  router.post("/admin/aprompt/autoflow", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    if (!OPENAI_KEY) return sendError(res, 500, "OpenAI nicht konfiguriert — OPENAI_API_KEY in Render setzen");
    const prompt = String(b.prompt || "").trim();
    if (!prompt) return sendError(res, 400, "Kein Prompt");
    const anzahl = 3;
    try {
      const r = await autoflowRunner.startRun({
        flow: "p", mode: "Analyse-Prompt (3 Varianten, 9:16 nativ)",
        textOnly: true, sourceName: "Analyse-Prompt",
        tiles: Array.from({ length: anzahl }, () => ({ prompt })),
        imgModel: openaiImage.PROMPT_GEN_MODEL,
        imgSize: openaiImage.PROMPT_GEN_SIZE,
        rawPrompt: true,
      });
      sendJson(res, 202, { runId: r.runId, anzahl, model: openaiImage.PROMPT_GEN_MODEL, size: openaiImage.PROMPT_GEN_SIZE });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.error("aprompt autoflow error:", msg);
      sendError(res, 502, msg);
    }
    return true;
  });

  //    Abfrage. Terminalzustand wird EINMAL geliefert und dann verworfen (Muster /api/status).
  router.post("/admin/aprompt/status", async (req, res) => {
    if (!toolsOn()) return sendError(res, 404, "Nicht gefunden");
    if (!ok(req, res)) return true;
    const b = await body(req, res); if (!b) return true;
    const jobId = String(b.jobId || "");
    const job = jobs.get(jobId);
    if (!job) return sendError(res, 404, "Lauf nicht gefunden — abgelaufen oder bereits abgeholt");
    sendJson(res, 200, job);
    if (job.status !== "pending") jobs.remove(jobId);
    return true;
  });
}

function notReady(res) {
  sendError(res, 501, "Noch nicht implementiert");
  return true;
}

module.exports = { register };
