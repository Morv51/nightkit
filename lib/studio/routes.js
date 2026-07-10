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

const IDEOGRAM_KEY = process.env.IDEOGRAM_API_KEY || "";
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || "";
const FAL_KEY = process.env.FAL_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const PAGE = path.join(__dirname, "..", "..", "public", "admin", "template-studio.html");
const IMG_LIMIT = 50 * 1024 * 1024; // großzügig für (mehrere) Base64-Bilder

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
}

function notReady(res) {
  sendError(res, 501, "Noch nicht implementiert");
  return true;
}

module.exports = { register };
