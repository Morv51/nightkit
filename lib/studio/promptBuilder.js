"use strict";

// Schlanker, rollenbasierter Prompt-Builder fürs Template Studio (Vorbild:
// lib/prompt.js, aber eigenständig — verändert dort nichts).

// Überall feste Platzhalter:
const DATE_PLACEHOLDER = "19.06.2026";
const WEBSITE_PLACEHOLDER = "www.website.com";
const TIME_PLACEHOLDER = "UHRZEIT"; // wie in den bestehenden Templates

const v = (x) => (typeof x === "string" ? x.trim() : "");

// ── Auto-Flow 2: pro Textrolle die aus der Referenz gelesenen typografischen Attribute
//    wörtlich in den Prompt (opt-in via opts.typo + dna.text_elements). Die Attribute
//    werden auf die PLATZHALTERWÖRTER angewendet — die Platzhalter bleiben der Textinhalt
//    (der Befüll-Mechanismus braucht sie), werden aber gestaltet gesetzt. Der Beispieltext
//    (sample) aus der Analyse wird NICHT gerendert. Ohne Flag: Standardpfad unverändert. ──
const ROLE_LABEL_TYPO = {
  headline: "HEADLINE (Tier 1, the hero — most dominant)",
  subline: "SUBLINE", datum: "DATE", uhrzeit: "TIME", dj_namen: "DJ NAMES",
  location: "LOCATION", clubname: "CLUB NAME", website: "WEBSITE",
};

// Eine Zeile je Textelement: das PLATZHALTERWORT (nicht ein Beispieltext) + die aus der
// Referenz gelesenen Attribute. placeholders: role → bereits zitierter Platzhalter-String.
function typoElementLines(elements, placeholders) {
  const out = [];
  for (const el of Array.isArray(elements) ? elements : []) {
    if (!el || typeof el !== "object") continue;
    const role = String(el.role || "").toLowerCase();
    const label = ROLE_LABEL_TYPO[role] || (role ? role.toUpperCase() : "TEXT");
    const ph = placeholders[role];
    if (!ph) continue;
    // Reihenfolge bewusst: zuerst Buchstabenform + Schriftklasse (dominiert), dann Neigung,
    // dann Groesse/Ausrichtung, EFFEKT und Farbe GANZ ZULETZT — sonst uebernimmt der Effekt
    // und die Buchstabenform faellt auf die Standardgrotesk zurueck.
    const parts = [];
    const form = [v(el.type_class), v(el.weight) && v(el.weight) + " weight", v(el.tracking) && v(el.tracking) + " letter-spacing"].filter(Boolean);
    if (form.length) parts.push("in the letterforms of a " + form.join(", ") + " (keep this exact letterform character, do NOT default to a plain grotesque)");
    if (v(el.slant)) parts.push(v(el.slant));
    const size = parseInt(el.size_pct, 10);
    if (Number.isFinite(size) && size > 0) parts.push("about " + size + "% of the headline size");
    if (v(el.align)) parts.push(v(el.align) + "-aligned");
    // Farbe und Effekt ZULETZT (Form dominiert). Die Farbe kommt je Element aus der Referenz —
    // nicht die haeufigste Textfarbe des Flyers.
    if (v(el.colour)) parts.push("and its colour is EXACTLY " + v(el.colour) + " as in the reference (do NOT " +
      "substitute the flyer's most common text colour)");
    if (v(el.effect) && v(el.effect).toLowerCase() !== "none") parts.push("and ONLY LAST a " + v(el.effect) + " effect applied on top, without overriding the letterforms");
    out.push('- ' + label + ': set the placeholder text ' + ph + (parts.length ? " — " + parts.join(", ") + "." : "."));
    // Lineup als GRUPPE (aus dem Analyse-Feld group_treatment), nicht drei gleichartige Zeilen.
    if (role === "dj_namen" && v(el.group_treatment)) {
      out.push("- LINEUP AS A GROUP: set the DJ NAME slots as ONE designed group the way the reference groups them — " +
        v(el.group_treatment) + " — never as three identical stacked lines.");
    }
  }
  return out;
}

// Varianz-Direktive der Nebentexte — kommt aus der Referenz (dna.typographic_variance),
// nicht aus einer Voreinstellung.
function typoVarianceLine(variance) {
  const vl = String(variance || "").toLowerCase();
  if (vl === "low") return "SECONDARY-TEXT VARIANCE (read from the reference = LOW): keep the secondary texts " +
    "(everything except the headline) UNIFORM — consistent size, weight and slant across them, so they read as one calm system.";
  if (vl === "high") return "SECONDARY-TEXT VARIANCE (read from the reference = HIGH): give the secondary texts " +
    "VISIBLY VARIED treatments from each other in size, weight and slant, exactly as specified per element above — deliberately different, not uniform.";
  return "SECONDARY-TEXT VARIANCE (read from the reference = MEDIUM): the secondary texts share a common base but " +
    "carry gentle, deliberate differences in size, weight or slant, as specified per element above.";
}

// ── Leitidee-Stufe (Auto-Flow 1-3): die aus der Referenz gelesene Komposition/Charakter wird
//    dem Bildprompt VORANGESTELLT und ist allen technischen Bloecken UEBERGEORDNET. Der
//    Fuellgrad geht als harte Zielzahl ein (nicht "viel Weissraum"). Alle Werte aus der DNA. ──
function guidingIdeaLines(d) {
  const out = [];
  const idea = v(d.leitidee);
  const fg = parseInt(d.fuellgrad, 10);
  const blick = v(d.blickfang);
  const rang = v(d.rangfolge);
  const laut = v(d.lautstaerke);
  out.push("GUIDING IDEA — TOP-LEVEL BRIEF (this governs the WHOLE flyer; every technical block further below " +
    "SERVES it, and if any of them contradicts this guiding idea, THE GUIDING IDEA WINS)" + (idea ? ": " + idea : "."));
  if (Number.isFinite(fg) && fg > 0) {
    out.push("FILL LEVEL — hit a HARD TARGET of about " + fg + "% of the canvas covered by content; the other " +
      "~" + Math.max(0, 100 - fg) + "% stays deliberately EMPTY space. Do NOT exceed this coverage: image " +
      "generators reflexively over-fill, so obey THIS NUMBER, never a vague 'some whitespace'.");
  }
  if (blick) out.push("FIRST FOCAL POINT: " + blick + ". This single element is seen FIRST; nothing else may " +
    "outshine or compete with it — even if a technical block below would enlarge or busy-up something else.");
  if (rang) out.push("VISUAL RANK ORDER (most important first): " + rang + ". Size, weight and placement must " +
    "follow this exact order of importance.");
  if (laut) out.push("OVERALL LOUDNESS: " + laut + ". Match this exact restraint/loudness level — a restrained " +
    "brief stays restrained (calm, sparse, few accents), a loud brief stays loud and dense.");
  out.push("PRIORITY RULE: if a technical block (typographic attributes, lineup grouping, layer depth, material " +
    "realism, font rules or composition) pulls AGAINST this guiding idea, follow the GUIDING IDEA. Example: if " +
    "the guiding idea calls for lots of air and one clear focal point, no other element may overpower that focal " +
    "point, even if a technical block suggests making it bigger or busier.");
  return out;
}

// ── Darstellungsart des Motivs: kommt als KONKRETER Wert aus der Analyse (motiv_darstellung),
//    damit das Bildmodell sie nicht selbst (falsch) interpretiert — ein hart kontrastiertes
//    SW-Foto ist Fotografie, keine Bleistiftzeichnung; umgekehrt genauso. ──
const MOTIV_LABEL = {
  fotografie: "PHOTOGRAPHY — a real photograph",
  illustration: "ILLUSTRATION — illustrated artwork",
  zeichnung: "DRAWING — hand-drawn artwork",
  vektor: "VECTOR — flat vector artwork",
  gemischt: "MIXED MEDIA — a genuine combination (e.g. photo plus drawn elements), exactly as the reference mixes them",
};
function motifRenderingLine(motiv) {
  const label = MOTIV_LABEL[String(motiv == null ? "" : motiv).toLowerCase().trim()];
  if (!label) return "";
  return "MOTIF RENDERING — READ FROM THE REFERENCE, DO NOT RE-JUDGE: the reference's motif is " + label + ". " +
    "Render the motif in EXACTLY this medium and NEVER switch it — a photo stays a photo, a drawing stays a " +
    "drawing, a vector stays a vector. Do NOT reinterpret a high-contrast, black-and-white or cut-out motif as " +
    "an illustration or a pencil drawing, and do NOT turn a drawn or illustrated reference into a photograph.";
}

// Modus 2: baut den Generierungs-Prompt für einen NEUEN Club-Event-Flyer aus der
// Stil-DNA. Die Referenz liefert NUR den Look — KEINE Inhalte/Objekte/Texte. Der
// Prompt passt sich der Referenzart an (opts.refType: "moodboard" | "single" |
// "multiple") und kann einzelne Aspekte variieren (opts.variant: {color_world,
// imagery_style, mood}), während der Rest des Stils fix bleibt. Editierbar im UI.
function buildMoodboardPrompt(dna, opts = {}) {
  const d = dna || {};
  const time = v(opts.time) || TIME_PLACEHOLDER;
  const refType = ["moodboard", "single", "multiple"].includes(opts.refType) ? opts.refType : "moodboard";
  const vr = opts.variant || {};
  // Variante = mindestens ein Aspekt überschrieben → Referenz-Flyer-Hinweis aufnehmen.
  const isVariant = !!(v(vr.color_world) || v(vr.imagery_style) || v(vr.mood) || v(vr.layout));
  // Auto-Flow 2: Referenz NUR als lose Stil-Inspiration. Standard = aus → Prompt
  // ist byte-identisch zu Auto-Flow 1. An = eine überschreibende Direktive vorn.
  const loose = !!opts.looseInspiration;
  // Auto-Flow 2 (beide Pfade): pro Textrolle typografische Attribute + Beispieltexte
  // wörtlich in den Prompt, Varianz aus der Referenz. NUR aktiv, wenn die erweiterte
  // Analyse gelaufen ist (opts.typo + dna.text_elements). Sonst exakt der Standardpfad.
  const typo = !!opts.typo && Array.isArray(d.text_elements) && d.text_elements.length > 0;
  // Leitidee-Stufe (Auto-Flow 1-3): nur wenn die erweiterte Analyse Kompositions-Felder lieferte.
  const leit = !!opts.leitidee && (v(d.leitidee) || d.fuellgrad != null || v(d.blickfang) || v(d.rangfolge) || v(d.lautstaerke));
  // Rolle → zu setzendes PLATZHALTERWORT (dieselben Platzhalter wie im Standardpfad).
  // Die Typo-Attribute werden hierauf angewendet; gerendert wird das Platzhalterwort.
  const typoPlaceholders = {
    headline: '"HEADLINE"', subline: '"SUBLINE"',
    datum: '"' + DATE_PLACEHOLDER + '"', uhrzeit: '"' + time + '"',
    dj_namen: '"DJ NAME 1", "DJ NAME 2" and "DJ NAME 3"',
    location: '"LOCATION"', clubname: '"CLUBNAME"', website: '"' + WEBSITE_PLACEHOLDER + '"',
  };

  // Varianten-Overrides: einzelne Aspekte ersetzen, Rest aus der DNA übernehmen.
  const eff = {
    look_mood: v(vr.mood) || v(d.look_mood),
    color_world: v(vr.color_world) || v(d.color_world),
    imagery_style: v(vr.imagery_style) || v(d.imagery_style),
    typography_character: v(d.typography_character),
    composition: v(vr.layout) || v(d.composition),
    visual_hierarchy: v(d.visual_hierarchy),
    texture_grain_light: v(d.texture_grain_light),
    editorial_club_look: v(d.editorial_club_look),
  };
  const style = [
    eff.look_mood, eff.color_world, eff.imagery_style, eff.typography_character,
    eff.composition, eff.visual_hierarchy, eff.texture_grain_light, eff.editorial_club_look,
  ].filter(Boolean).join(" · ") || "modern editorial club aesthetic";

  // Referenzart-spezifische Zeile: enger bei Einzel-Inspiration, abstrakter sonst.
  const refLine = refType === "single"
    ? "The reference image is the PRIMARY, AUTHORITATIVE style guide: match its look, colour world, " +
      "typographic character, texture and composition AS CLOSELY AS POSSIBLE. Only the placeholder texts are " +
      "new — everything stylistic should closely follow the reference. Do NOT copy its specific text, names, " +
      "dates or logos (those are replaced by the placeholders); copy the STYLE, not the content."
    : refType === "multiple"
    ? "Use the SHARED visual language across the provided reference images. Take ONLY their common look " +
      "(colors, typography character, texture, mood, illustration style), never any single image's content or layout."
    : "The moodboard is a COLLAGE of many references — take ONLY its shared visual language (colors, " +
      "typography character, texture, mood, illustration style), NEVER its collage structure. Do NOT copy " +
      "any objects, content or layout from the moodboard.";

  const lines = [
    // Leitidee ZUERST (uebergeordnet ueber alle technischen Bloecke), nur Auto-Flow 1-3.
    ...(leit ? guidingIdeaLines(d) : []),
    ...(loose ? [
      // PFAD A (Auto-Flow 2 „Nah") — Referenzbild geht mit, aber konkrete Elemente NICHT übernehmen.
      "LOOSE INSPIRATION MODE (important — this OVERRIDES the style-matching instructions further below): " +
        "Use the reference image ONLY as loose stylistic inspiration for the GENERAL direction — overall " +
        "mood, genre, rough colour feel (as a principle, not exact) and general typographic character. Do " +
        "NOT reproduce its background type, its decorative graphic elements, its splatters / textures, its " +
        "specific colour combination, its motif or its composition. Create an ORIGINAL, INDEPENDENT flyer " +
        "design that is clearly DISTINCT from the reference — the same broad vibe, but a different execution " +
        "and a different layout, recognisable as its own work and NOT a rebuild of the reference. Wherever " +
        "an instruction below says to match the reference 'as closely as possible', to use its 'exact' " +
        "colour world / background, or to keep its composition, treat that as SOFTENED: keep only the broad " +
        "stylistic vibe and deliberately DIVERGE in composition, layout, colour balance and motif.",
    ] : []),
    "Create a CLUB EVENT FLYER (a flyer to promote a nightclub / party event). Vertical 9:16 format, " +
      "single cohesive poster.",
    "It is ONE single, cohesive club event flyer with ONE unified composition.",
    ...(isVariant ? [
      // VARIANTEN-PROMPT: bezieht sich auf den REFERENZ-FLYER, nicht aufs Moodboard.
      // Keine Collage-Abstraktions-Sätze hier — die gehören nur in die Erst-Erstellung.
      "A reference flyer from this style family is provided alongside this prompt (and may also appear " +
        "earlier in this chat). Use it as the PRIMARY visual reference. Keep its exact style: same mood, " +
        "typography treatment, illustration / rendering style, texture, colour intensity and overall " +
        "composition logic. This is a VARIATION of that flyer.",
      "Change ONLY: the color combination, the illustration motif, and the arrangement — as specified " +
        "below. Keep everything else consistent with the reference flyer so they look like one coherent series.",
    ] : [
      // ERST-ERSTELLUNG: bei „single" (z. B. Auto-Flow) vom REFERENZBILD sprechen,
      // sonst vom Moodboard/Inspirationsbild.
      refType === "single"
        ? "A reference image is provided alongside this prompt — use it as the primary visual guide for the style."
        : "A visual reference (moodboard / inspiration image) is provided alongside this prompt — use it as the " +
          "primary visual guide for the style.",
      refLine,
    ]),
    "STYLE GUIDELINE: " + style + ".",
    // Hintergrund + Palette VOLLSTÄNDIG aus dem analysierten Anker (color_world) —
    // keine feste Hell/Dunkel- oder Farbanzahl-Vorgabe mehr.
    v(eff.color_world)
      ? "COLOR & BACKGROUND: use the exact colour world from the analysis — " + v(eff.color_world) + ". Keep " +
        "the SAME background and the SAME colour count as the reference (dark stays dark, light stays light; " +
        "few colours stay few, many colours stay many). Do NOT lighten, darken, simplify or expand the " +
        "palette beyond what the analysis describes."
      : "COLOR & BACKGROUND: use the reference's exact background treatment and colour palette from the " +
        "analysis. Do NOT lighten, darken, simplify or add colours (dark stays dark, light stays light; few " +
        "colours stay few, many colours stay many).",
    // MEDIUM-TREUE: der Stil der Vorlage entscheidet (fotografisch bleibt fotografisch,
    // illustrativ bleibt illustrativ). Nur Bildqualitäts-/Kamera-Sprache, KEINE Körper-/
    // Haut-freizügigen Begriffe (die Wort-Entschärfung deescalate() bleibt vorrangig; das
    // Wort "skin" wird dort ersetzt, daher hier bewusst "complexion"/"facial texture").
    // Darstellungsart aus der Analyse (falls vorhanden) — steht VOR der Medium-Regel und
    // macht deren Urteil konkret, statt es dem Bildmodell zu ueberlassen.
    ...(motifRenderingLine(d.motiv_darstellung) ? [motifRenderingLine(d.motiv_darstellung)] : []),
    "MEDIUM FIDELITY — the reference decides the realism: judge from the reference (its image if provided, " +
      "and the STYLE GUIDELINE description above) whether the central depiction — the main subject / person " +
      "and any real-world motifs — is PHOTOGRAPHIC (a real photo) or ILLUSTRATED / drawn / vector / painted. " +
      "Then MATCH that same medium faithfully; never turn a photographic reference into an illustration, nor " +
      "an illustrated reference into a photo.",
    "IF THE REFERENCE IS PHOTOGRAPHIC — render the central person and any real-world subjects with true " +
      "PHOTOREALISM, in professional photographic terms that target IMAGE QUALITY only: professional " +
      "photography, photorealistic, a real DSLR camera capture, a lifelike complexion with natural pores and " +
      "fine facial / surface texture, natural or professional studio lighting, realistic soft shadows and " +
      "natural highlights and reflections, and natural depth of field and focus. Faces and hands must look " +
      "realistic, clean and anatomically correct. Explicitly AVOID on the person and real motifs: digital " +
      "illustration, a painted or hand-drawn look, 3D render, CGI, smooth plastic surfaces, heavy airbrushing, " +
      "and the typical over-smooth AI-generated look. Keep REAL photographic colour tonality with natural " +
      "complexion tones (a full-colour photograph, not a flattened or stylised recolour), and where the " +
      "reference background is a real scene keep it a full photographic background — never reduced to a bare " +
      "line drawing.",
    "IF THE REFERENCE IS ILLUSTRATED / GRAPHIC — keep that illustrated, drawn, vector or painted rendering " +
      "exactly as the reference has it; do NOT force a photo or add photorealism where the source is not " +
      "photographic.",
    "PHOTO-VS-GRAPHIC SEPARATION — regardless of the above, the graphic DESIGN layer (typography, shapes, " +
      "icons, patterns, decorative devices, colour fields and graphic backgrounds) always stays clean and " +
      "GRAPHIC / vector as designed. Only the person and real-world motifs follow the photographic-or-" +
      "illustrated decision. This is the normal, professional flyer mix of a real photograph combined with " +
      "crisp graphic design.",
    "MATERIAL REALISM (ALWAYS, regardless of the reference — remove the over-rendered CGI look): use MATTE " +
      "materials instead of plastic shine; NO glossy specular highlights on clothing, faces or complexion; and " +
      "NO symmetrical sparkle or star-glint shapes. This never overrides the photographic-or-illustrated " +
      "decision above — it only strips the over-rendered, glossy plastic CGI look.",
    "HEADLINE DOMINANCE: the HEADLINE is the HERO element and must be the most visually dominant text on " +
      "the flyer — large, bold, commanding the strongest visual weight, a clear focal point (NOT a small " +
      "label). It may be oversized and may overlap or interact with the main graphic, and it should anchor " +
      "the composition. The main motif / imagery SUPPORTS the headline; it must not overshadow it.",
    "TEXT SAFE AREA — NEVER CUT OFF: all text, and ESPECIALLY the headline, must fit ENTIRELY within the " +
      "canvas with safe margins on every side. Never let any letters be cropped, cut off at the edges or run " +
      "outside the frame (never show a partial fragment like 'DLIN' instead of the full word). Size the " +
      "headline so the COMPLETE word fits fully inside the image with padding on all sides; if in doubt, make " +
      "the headline slightly smaller so the whole word stays visible. Prioritise full readability of the " +
      "ENTIRE word over maximum size, and keep every word whole and unbroken — no letters lost at the border.",
    "HEADLINE LINE BREAKS — KEEP EACH WORD WHOLE: never hyphenate or split any word of the headline across " +
      "lines or within itself; every single word must stay intact on one line as one unbroken unit (never " +
      "render a word as fragments like 'HEA-DLI-NE' spread over several lines). Set the headline on ONE " +
      "single line whenever possible. Only in exceptional cases may the headline break onto a second line " +
      "between TWO WHOLE WORDS — and only if the reference / template clearly dictates that break, or the " +
      "headline would otherwise not fit inside its intended area. Even then, break ONLY between complete " +
      "words, never inside a word, and use at most two lines; more than two lines for the headline must be avoided.",
    "MAIN SUBJECT VISIBILITY: the headline should NOT cover or obscure the main subject / focal element of " +
      "the flyer — keep the main subject clearly visible. Headline and main subject should be arranged to " +
      "COMPLEMENT each other, not overlap in a way that hides the subject.",
    "DELIBERATE COMPOSITION: compose like a professional designer — clear focal hierarchy, intentional " +
      "spacing, balanced placement of the headline and the main visual element. Avoid simply stacking a " +
      "giant headline in the dead centre on top of everything.",
    "COMPOSITION: vary it like a professional designer would — do NOT default to a single left-aligned " +
      "column of stacked text every time. Use confident, intentional layout: the headline can sit top, " +
      "centre or bottom and dominate; secondary info can be grouped, offset and aligned differently (left, " +
      "right or mixed) in asymmetric but balanced arrangements; let the text interact with the imagery. It " +
      "should feel deliberately art-directed, with a clear focal hierarchy and dynamic use of space — still " +
      "ONE cohesive flyer with a clear hierarchy, never chaos and never a uniform template grid.",
    "DESIGN QUALITY TARGET: a polished flyer as produced by a professional event agency with a skilled " +
      "graphic designer — strong focal hierarchy, confident typography, intentional spacing, art-directed " +
      "composition. Avoid generic, templated, evenly-stacked layouts.",
    "LAYER DEPTH — SUBJECT IN FRONT OF THE HEADLINE: build real graphic-designer layering. The MAIN SUBJECT " +
      "(person, vehicle or object) partly OVERLAPS the headline and sits IN FRONT of it, so the title runs " +
      "BEHIND the figure — it disappears behind the subject and reappears on the other side, as if the title " +
      "sits on its own layer behind. No text floats freely beside the motif; headline and subject are " +
      "interlocked on separate flat layers. This is FLAT layering, NOT 3D and NOT perspective — the type stays " +
      "perfectly straight, upright and flat (never tilt, skew, rotate, curve, warp or distort any text). The " +
      "figure covers only a NARROW part of the title, so every word of the headline stays complete and readable " +
      "as a whole — no whole letter is hidden.",
    "HEADLINE TYPOGRAPHY: the headline's lettering must closely match the headline style of the reference — " +
      "the same character of lettering (weight, shape, personality, effect, treatment) as captured in the " +
      "typography analysis. Do NOT default to a generic font; mirror the reference's headline style as " +
      "closely as possible while still rendering the new placeholder word in full.",
    "FONT EXCLUSIONS (ALWAYS, regardless of the reference): NEVER use comic or cartoon lettering, NEVER a " +
      "childish / playful comic font, and NEVER a handwritten-marker or felt-tip look. Even when the style is " +
      "described as playful, energetic, hand-made, funky or graffiti, render it with proper display / " +
      "editorial typography, never comic-book, doodle or marker fonts. This applies to EVERY text element.",
    "TEXT COLOUR & CONTRAST FROM THE REFERENCE: take each text's colour and, where a text sits on a coloured " +
      "area or panel, the CONTRAST between that text and its area, STRAIGHT FROM THE REFERENCE — never invent " +
      "a new one. If the reference sets WHITE type on a coloured field, keep white type on that coloured field; " +
      "do NOT default to black (or to the flyer's most common text colour) just because that is more usual. " +
      "Each text element keeps its OWN colour from the reference, not a single uniform text colour.",
    "SECONDARY TEXT AS DESIGN: all secondary information (date, time, location, DJ names, club name, " +
      "website) must be DESIGNED and integrated into the layout — NOT plain default text pasted on top like " +
      "a quick social-media overlay. Set it like a professional designer: typography that fits the flyer's " +
      "overall style, with intentional sizing, spacing, alignment and rhythm; it may use the design's accent " +
      "colours, dividers or styling cues derived from the reference so it feels part of the composition, never " +
      "a generic overlay. Keep it clearly legible and subordinate to the headline.",
    ...(typo ? [] : ["TYPOGRAPHIC HIERARCHY — FOUR DISTINCT TIERS, EACH DELIBERATELY DESIGNED: EVERY text element must be " +
      "consciously designed like on a real graphic-designer's flyer — but in clearly graded tiers that look " +
      "VISIBLY different from one another, never all the same. " +
      "TIER 1, the HEADLINE: clearly dominant — the largest size and the strongest graphic treatment (e.g. " +
      "effects, gradients, a striking lettering character). It is the visual anchor. " +
      "TIER 2, the SUBLINE: picks up the headline's style but clearly TONED DOWN — smaller and calmer, without " +
      "the headline's full effects. " +
      "TIER 3, the SECONDARY TEXTS (DJ names, date, time, location, club name): designed, but with OTHER means " +
      "than the headline — NOT through size or heavy effects, but through a fitting type character, colour " +
      "accents, deliberate emphasis (all-caps, italics, letter-spacing), arrangement, divider lines or small " +
      "graphic elements. They must NOT copy the headline's effects (no big gradients, no heavy shadows, no " +
      "dominant size). " +
      "TIER 4, the SMALL ELEMENTS (website, any extra lines): the calmest, but still deliberately set — e.g. a " +
      "colour accent or a fitting type weight. Never neutral system text. " +
      "CORE RULE: each tier must look visibly distinct from the others — if the headline and the secondary " +
      "texts looked the same, that is WRONG. The hierarchy must be obvious at a glance: what is important, what " +
      "is detail. The secondary texts belong to the SAME visual family as the headline (coordinated colour " +
      "world and style) but are clearly subordinate to it. No text element may look like neutral system type " +
      "(Arial / Helvetica with no design). " +
      "LIMITS so it does not tip over: legibility ALWAYS comes first — no text may become unreadable through " +
      "styling; no typographic noise — ONE coherent type system, not five different fonts; the hierarchy must " +
      "not collapse — secondary texts must never compete with or outshine the headline; and NO 3D effects, no " +
      "perspective, no slanted or distorted lettering (the type stays straight and flat)."]),
    // Auto-Flow 2 (typo): pro Textelement die aus der Referenz gelesene Gestaltung, konkret
    // ausformuliert — ersetzt die feste Vier-Ebenen-Regel durch referenz-getriebene Vorgaben.
    ...(typo ? [
      "TYPOGRAPHIC TREATMENT PER PLACEHOLDER — this IS the design hierarchy, read from the reference. The flyer " +
        "STILL shows the placeholder words themselves (see the exact placeholder list further below), but each " +
        "placeholder is SET with its OWN deliberate treatment as specified here — its form language, slant and " +
        "size hierarchy taken from the reference. Do NOT flatten everything to one uniform style and NEVER render " +
        "neutral system type (no plain Arial / Helvetica). Legibility ALWAYS comes first; keep ONE coherent type " +
        "system (not five random fonts); the hierarchy must not collapse (secondary texts never outshine the " +
        "headline); type stays straight and flat — no 3D, no perspective, no slanted or distorted lettering:",
      ...typoElementLines(d.text_elements, typoPlaceholders),
      typoVarianceLine(d.typographic_variance),
      "IMPORTANT — the placeholder words (HEADLINE, SUBLINE, DJ NAME 1-3, LOCATION, CLUBNAME, the date, the time, " +
        "the website) are pure TEXT CONTENT to be displayed as designed flyer text. Their generic wording must " +
        "NOT influence the design in any way: do NOT treat them as form fields, input boxes, labels, captions or " +
        "UI, and draw NO field frames, underlines, brackets or placeholder chrome around them. Set and style each " +
        "one exactly like real, deliberately designed flyer text, using the typographic treatment specified above.",
    ] : []),
  ];

  // Varianten-Hervorhebung: nur die geänderten Aspekte explizit betonen; der
  // Stil-Anker (Stimmung, Typografie, Textur, Zeichenstil) bleibt fix.
  const ov = [];
  if (v(vr.color_world)) ov.push("color world = " + v(vr.color_world));
  if (v(vr.imagery_style)) ov.push("illustration subject = " + v(vr.imagery_style));
  if (v(vr.mood)) ov.push("mood = " + v(vr.mood));
  if (v(vr.layout)) ov.push("layout / arrangement = " + v(vr.layout));
  if (ov.length) {
    lines.push("");
    lines.push("VARIATION — keep the STYLE ANCHOR identical (same mood, typography character, texture, " +
      "illustration / rendering style and overall composition logic); change ONLY this: " + ov.join("; ") +
      ". Still ONE big subject + text around it with deliberate, balanced use of space — no grid, no collage.");
  }

  lines.push(
    "",
    "Do NOT create multiple tiles, stickers, panels, boxes or separate blocks. Do NOT arrange the flyer " +
      "as a grid or collage. It is ONE poster with one clear, unified layout.",
    "",
    "The flyer MUST contain ONLY these placeholder texts, clearly legible, well-set typography, correct " +
      "hierarchy. Render the placeholder texts as REAL, correctly spelled words EXACTLY as given — no " +
      "gibberish, no fake or invented letters:",
    `HEADLINE, SUBLINE, ${DATE_PLACEHOLDER}, ${time}, LOCATION, DJ NAME 1, DJ NAME 2, DJ NAME 3, CLUBNAME, ${WEBSITE_PLACEHOLDER}.`,
    "ONLY THESE TEXTS: render ONLY the placeholder texts listed above and NO other text. Do NOT invent, add " +
      "or duplicate any additional words, labels, headings or text fields (for example no 'EVENT NAME', no " +
      "extra captions, no made-up titles or taglines). There must be NO text on the flyer beyond the listed " +
      "placeholders.",
    "HEADLINE TEXT IS LITERAL: for EVERY flyer, whatever its theme, the headline text must be EXACTLY the " +
      "placeholder word \"HEADLINE\" and nothing else. GENERAL RULE (this is the principle and it applies to " +
      "ALL cases): never invent, substitute, add, prepend or append ANY thematic title, event name, party " +
      "name, festival name, slogan, year or extra word for the headline — no matter which one, including " +
      "titles not mentioned here. The following are ONLY non-exhaustive examples of what is forbidden, NOT a " +
      "complete list: e.g. 'HOLI FESTIVAL', 'EVENT HEADLINE', 'SUMMER PARTY', 'NEON NIGHT', 'EVENT', " +
      "'FESTIVAL'. Any other made-up or thematic title is equally forbidden — output only the single literal " +
      "word HEADLINE. The same applies to EVERY field: render ONLY the literal placeholder words exactly as " +
      "listed above, with no other, added, translated or altered words anywhere on the flyer.",
    "EACH placeholder appears EXACTLY ONCE on the whole flyer, in exactly one place: one HEADLINE, one " +
      "SUBLINE, one DATE, one TIME, one LOCATION, DJ NAME 1 / 2 / 3 once each, one CLUBNAME, one WEBSITE. " +
      "Never repeat or duplicate any placeholder. Do NOT place LOCATION or CLUBNAME (or any other field) a " +
      "second time, e.g. inside a badge, stamp, circle, sticker or separate element. If the design uses a " +
      "decorative badge or circular element, do NOT fill it with placeholder texts that already appear " +
      "elsewhere — leave such decorative elements without duplicated event info. The placement and " +
      "composition stay FREE and creative — do NOT fix where any field sits; only ensure no single " +
      "placeholder is shown twice.",
    "NO LABEL ICONS: Do NOT place any icons, pictograms or symbols in front of or next to the text fields " +
      "(no location pin, no headphone icon, no globe, no clock, no calendar icon, etc.). The event info " +
      "(LOCATION, DJ names, CLUBNAME, date, time, website) is shown as clean typography only, without " +
      "decorative icons or symbol bullets in front of the labels. This forbids ONLY functional label icons — " +
      "stylistic decorative graphics that belong to the look (hand-drawn elements, tattoo scribbles, glitch " +
      "artefacts, crosses, splatters, etc.) remain fully allowed.",
    "FLEXIBLE INFO LAYOUT: Arrange the secondary event info (LOCATION, DJ names, CLUBNAME, WEBSITE) in a " +
      "FLEXIBLE layout that still looks balanced if some fields have fewer entries (e.g. only one DJ instead " +
      "of three). Do NOT lock this info into a rigid fixed grid of equal cells/boxes that only looks right " +
      "when every slot is filled. Prefer a natural, list-like or free typographic arrangement that tolerates " +
      "a varying number of DJ names without leaving awkward empty cells or breaking the balance. The DJ names " +
      "especially should read as a simple stacked or inline lineup that works for 1, 2 or 3 names.",
    "TEXT-LENGTH ROBUSTNESS (applies to EVERY text element): the design must NOT depend on a specific text " +
      "length or a fixed number of lines. The lineup must look right with ONE, TWO or THREE names alike — do " +
      "NOT build any frame, filled panel, shape or proportion that assumes exactly three lines; use an area " +
      "that simply becomes SHORTER with fewer lines, leaving no empty gap. The same holds for all fields: a " +
      "two-word headline and a six-word headline must BOTH work, and every element stays balanced whether its " +
      "text is short or long. No element may rely on a fixed word or line count to look correct.",
    "NO LOGOS FROM THE REFERENCE: do NOT copy or reproduce any logos, brand marks, watermarks, emblems or " +
      "signature graphics from the reference image — the reference is ONLY a style guide, not a source of " +
      "marks. The new flyer must contain NO logos or brand marks; the only brand text is the plain CLUBNAME " +
      "placeholder. Ignore and omit any logo-like graphic present in the reference.",
    "",
    "Single flyer filling the frame, high resolution, print-quality. An original design inspired by the " +
      "style, NOT a reproduction of the reference.",
    "NEGATIVE: NOT a collage, NOT a moodboard, NOT multiple separate designs, NOT a grid of boxes/tiles/" +
      "stickers, no logos, no watermarks, no extra text beyond the placeholders. ONE single flyer."
  );
  return lines.join("\n");
}

// Rolle → einzusetzender Platzhaltertext. DATUM/WEBSITE sind fest vorgegeben.
const ROLE_PLACEHOLDERS = {
  HEADLINE: "HEADLINE",
  SUBLINE: "SUBLINE",
  DATUM: DATE_PLACEHOLDER,
  UHRZEIT: TIME_PLACEHOLDER,
  LOCATION: "LOCATION",
  "DJ NAME 1": "DJ NAME 1",
  "DJ NAME 2": "DJ NAME 2",
  "DJ NAME 3": "DJ NAME 3",
  CLUBNAME: "CLUBNAME",
  WEBSITE: WEBSITE_PLACEHOLDER,
};

// Pflicht-Platzhalter — ein Template MUSS sie alle enthalten (Soll-Liste).
const ROLE_LIST = Object.keys(ROLE_PLACEHOLDERS);
const MANDATORY_ROLES = ROLE_LIST;

// Fehlende Rollen einer Gruppe als Platzhalter-Liste ("DATUM, UHRZEIT").
function groupList(missingSet, roles) {
  return roles.filter((r) => missingSet.has(r)).map((r) => ROLE_PLACEHOLDERS[r]);
}

// Gewählte Font-Referenz-Zone für den Prompt beschreiben: Text + grobe Props.
function refDesc(ref) {
  if (!ref || typeof ref.text !== "string" || !ref.text.trim()) return "";
  const f = ref.font || {};
  const props = [f.style, f.casing, f.weight].filter(Boolean).join(", ");
  return `"${ref.text.trim()}"${props ? ` (${props})` : ""}`;
}

// Modus 1 (V1-Vollbild-edit-Prompt) — Strategie: Design-IDENTITÄT + Fonts strikt
// erhalten, aber Komposition DARF umarrangiert/skaliert werden, um Platz für alle
// Pflicht-Felder zu schaffen, OHNE das Hauptmotiv zu überdecken (Hauptmotiv —
// Personen, Produkte, Fahrzeuge, Logos, zentrale Grafik — hat Vorrang vor der
// exakten Position). UNIVERSELL für jeden Flyer, nicht nur Gesichter. Vorhandene
// Texte werden ersetzt, fehlende als gruppierter Info-Block ergänzt. STRIKTE
// Verbote: jedes Element exakt einmal (keine Text-/Motiv-Duplikate), kein
// erfundener/halluzinierter Text, KEINE generischen Deko-Icons neben den Infos,
// feine professionelle Typo (nicht fett). Zonen mit Rolle ENTFERNEN/leer ignoriert.
function buildPlaceholderPrompt(zones, opts = {}) {
  const list = zones || [];
  const info = refDesc(opts.infoRef); // gewählte Font-Referenz (oder "")
  const assigned = new Set();
  const replace = [];
  const remove = [];
  const keep = [];
  for (const z of list) {
    if (z && ROLE_PLACEHOLDERS[z.role] && v(z.text)) {
      replace.push(`- Replace the text "${v(z.text)}" with "${ROLE_PLACEHOLDERS[z.role]}"`);
      assigned.add(z.role);
    } else if (z && z.role === "ENTFERNEN" && v(z.text)) {
      remove.push(`- Remove "${v(z.text)}"`);
    } else if (z && z.role === "BEHALTEN" && v(z.text)) {
      keep.push(`- Keep "${v(z.text)}"`);
    }
  }
  const missingSet = new Set(MANDATORY_ROLES.filter((r) => !assigned.has(r)));

  const gHead = groupList(missingSet, ["HEADLINE", "SUBLINE"]);
  const gInfo = groupList(missingSet, ["DATUM", "UHRZEIT", "LOCATION"]);
  const gLineup = groupList(missingSet, ["DJ NAME 1", "DJ NAME 2", "DJ NAME 3"]);
  const gFoot = groupList(missingSet, ["CLUBNAME", "WEBSITE"]);

  const addLines = [];
  if (gHead.length) addLines.push(`- Headline area: ${gHead.join(" and ")}`);
  if (gInfo.length) addLines.push(`- Core info (date / time / location): ${gInfo.join(", ")}`);
  if (gLineup.length) addLines.push(`- DJ line-up: ${gLineup.join(", ")}`);
  if (gFoot.length) addLines.push(`- Footer: ${gFoot.join(" and ")}`);

  return [
    "Rebuild this event flyer into a reusable template. Keep the SAME design language, the SAME " +
      "fonts and the SAME overall look as the original. You may ONLY rearrange and resize elements " +
      "to fit all the text fields cleanly. Never place text over the main visual subjects of the flyer " +
      "(e.g. people/faces, products, vehicles, logos, key graphic elements) — keep the central motif " +
      "fully visible and uncovered. Do not invent a new design, and do not change the fonts.",
    "",
    "FORMAT — the final flyer MUST be exactly 9:16 vertical (this always applies):",
    "- If the provided reference flyer has a different aspect ratio, do NOT crop, squash or distort it. " +
      "Keep the original design intact and EXTEND it naturally to fill a 9:16 canvas: continue the " +
      "background, colors, textures and design elements seamlessly into the added areas, so the result " +
      "looks like it was originally designed as a 9:16 flyer.",
    "- The added areas must match the existing style perfectly — same background, same mood, no visible " +
      "seams, NO new unrelated objects and NO extra text in the filled areas (only the placeholders " +
      "belong on the flyer). The main subject and all existing content stay fully intact and uncovered.",
    "- If the reference is already 9:16, keep its format as is.",
    "",
    "1) Replace these existing texts IN PLACE with their placeholders — keep each at its original " +
      "position and style. Once replaced, that field is complete; do NOT add it again anywhere else:",
    ...(replace.length ? replace : ["- (none)"]),
    "",
    ...(addLines.length ? [
      "2) Add the MISSING placeholders, gathered into one tidy, well-organised info area (group them, do not scatter):",
      ...addLines,
    ] : [
      "2) All placeholders already exist — only the replacements above are needed.",
    ]),
    "",
    ...(remove.length ? [
      "REMOVE these original texts completely and cleanly (STRICT):",
      "- Delete them entirely — they must NOT appear anywhere in the result. Where they used to be, " +
        "blend the area naturally into the surrounding design: no leftover text, no ghosting, no faint " +
        "traces, no gibberish. Put NO placeholder and NO new text in their place.",
      ...remove,
      "",
    ] : []),
    ...(keep.length ? [
      "KEEP these original texts EXACTLY as they are — do NOT replace, change, move, restyle or remove " +
        "them. They are intentional design elements and must stay identical to the original:",
      ...keep,
      "",
    ] : []),
    "EACH ELEMENT EXACTLY ONCE — no duplicates (STRICT):",
    "- Every placeholder appears EXACTLY ONCE, in exactly one place: one HEADLINE, one SUBLINE, one " +
      "DATE, one TIME, one LOCATION, DJ NAME 1 / 2 / 3 once each, one CLUBNAME, one WEBSITE.",
    "- A field replaced in step 1 stays ONLY at its original spot — never also in the info area. " +
      "Example: if the DATE is replaced in step 1, there is exactly ONE date on the whole flyer, at its " +
      "original position; never add a second date in the info block.",
    "- Never repeat or duplicate any text. Do NOT show the SUBLINE twice, do NOT show the DATE twice, " +
      "never place the same text in two places.",
    "- Do NOT duplicate the subjects of the artwork. Keep people, products or objects from the original " +
      "in their original number and arrangement — never copy, mirror or paste a subject a second time.",
    "",
    "NO INVENTED TEXT (STRICT):",
    "- Any original text that is replaced or marked for removal must be cleanly gone. In its place put " +
      "NO made-up text, NO fake or gibberish letters and NO filler — especially under the headline.",
    keep.length
      ? "- The ONLY text on the flyer is the placeholders listed above plus the KEPT texts listed above. Nothing else."
      : "- The ONLY text on the flyer is the placeholders listed above. Nothing else.",
    "",
    "KEEP — design identity (non-negotiable):",
    "- The same design idea and visual language as the original. Do NOT create a new concept.",
    "- Reuse the fonts as exactly as possible: the headline font AND the secondary font, with the same " +
      "character, casing, weight and letterforms as the original. Added fields use the flyer's EXISTING " +
      "secondary / body font — never a new font, and never the headline font for body info.",
    "- Keep the colour world, textures, graphic elements and the imagery / main motif of the original.",
    "- The main subjects of the artwork (people/faces, products, vehicles, logos, central graphics) stay " +
      "intact, undistorted, fully visible, and are NEVER covered by text.",
    "",
    "YOU MAY (only this, to make room for every field):",
    "- Reposition and resize the imagery, the text blocks and the graphic elements to open a clean, " +
      "separate zone for the event info.",
    "- The imagery may be scaled smaller or moved, as long as the main subject stays whole and clearly recognisable.",
    "- This is NOT a redesign — only rearranging so all fields fit without overlapping.",
    "",
    "TYPOGRAPHY of the added info (TIME, LOCATION, DJ names, CLUBNAME, WEBSITE):",
    info
      ? "- Set ALL added info fields in the SAME typographic style as the existing text " + info +
        ": the same font character, weight, casing, spacing and overall feel — as if the same designer set them."
      : "- Use the flyer's existing secondary / body-text font (the smaller non-headline text), never the big display / headline font.",
    "- Keep it fine and deliberate like a professional designer: light or regular weight (NOT bold), " +
      "clear hierarchy, generous clean spacing and precise alignment — restrained and elegant.",
    "- Do NOT render it as a generic bullet-point list. Make it a deliberately set, designed text block " +
      "that fits the flyer — not a default list.",
    "- Do NOT add decorative icons next to the info fields: no calendar by the date, no clock by the " +
      "time, no location pin by the venue, no headphones or microphone by the DJ names, and no similar " +
      "generic symbols. Present all event information as clean typography only, matching the original " +
      "flyer's style — UNLESS the original flyer itself already used such icons as part of its design, " +
      "in which case match the original.",
    "",
    "LAYOUT (zones, top to bottom):",
    "- HEADLINE / SUBLINE at the top, dominant, in the original headline style.",
    "- DATE, TIME, LOCATION as a core-info block, medium size, in the secondary font.",
    "- DJ NAME 1-3 as a stacked line-up, medium-small.",
    "- CLUBNAME and WEBSITE small in the footer.",
    "- All info text sits in clear, free zones — NOT over the main subject or central imagery.",
    "",
    "PRIORITY on conflict: keeping the main subject intact and uncovered matters MORE than its exact " +
      "original position. Rather move or resize the subject than place any text over it.",
  ].join("\n");
}

// Hinweis: Die Auto-Varianten werden NICHT mehr aus hartkodierten Pools gebaut
// (das mischte stil-fremde Werte wie "childlike doodle"/"dusty rose" in jeden
// Anker). Stattdessen erzeugt `vision.generateVariationSpecs` die Farb-/Motiv-/
// Aufbau-Vorgaben frisch aus dem AKTUELLEN Stil-Anker; jede Variante baut dann
// hier über `buildMoodboardPrompt(dna, { variant })`.

// Modus B (Moodboard-zu-Prompt, „Eigenstaendig / copyright-schonend"): baut aus der
// Stil-DNA einen EIGENSTAENDIGEN Flyer-Prompt. Es werden NUR abstrakte, nicht schuetzbare
// Eigenschaften uebernommen (Stimmung, Farbwelt, Thema, Energie). Der konkrete Stil / die
// Handschrift (z. B. Line-Art-Optik), die Komposition und spezifische Motive werden bewusst
// NICHT uebernommen. Reiner Zusatz: buildMoodboardPrompt (Standard-Modus A + Auto-Flows)
// bleibt voellig unveraendert. Neutrale, generierungsfreundliche Sprache wie ueberall.
function buildIndependentPrompt(dna, opts = {}) {
  const d = dna || {};
  const time = v(opts.time) || TIME_PLACEHOLDER;
  const mood = v(d.look_mood);
  const color = v(d.color_world);
  const lines = [
    "Create a CLUB EVENT FLYER (a flyer to promote a nightclub / party event). Vertical 9:16 format, single " +
      "cohesive poster.",
    "It is ONE single, cohesive club event flyer with ONE unified composition.",
    "INDEPENDENT INTERPRETATION (copyright-conscious, this is the guiding principle): a reference image was used " +
      "ONLY to sense the general VIBE. Take from it EXCLUSIVELY abstract, non-protectable qualities: the overall " +
      "MOOD, the COLOUR WORLD / palette, the broad THEME and the ENERGY level. Do NOT reproduce its specific " +
      "artistic style or handwriting (for example a particular line-art, illustration or rendering look), its " +
      "composition or arrangement, its specific or unique motifs, or any recognisable design signature. Create an " +
      "ORIGINAL, INDEPENDENT flyer that merely SHARES the mood and colour world: inspired by the vibe, " +
      "independently designed, and clearly DISTINCT from the reference in style, motif and layout.",
    mood ? "MOOD to evoke (echo it as a feeling, do not copy any concrete element): " + mood + "." : "",
    color ? "COLOUR WORLD to echo (approximate feel, NOT an exact copy of the palette): " + color + ". Keep the " +
      "same general colour mood, but choose your OWN concrete combination." : "",
    "STYLE, MOTIF AND COMPOSITION ARE YOURS TO INVENT: use an original, professional club-flyer aesthetic and your " +
      "own art-directed layout and imagery. Do NOT derive the illustration style, the specific motif or the " +
      "composition from the reference — only the mood and colour world may resonate.",
    "HEADLINE DOMINANCE: the HEADLINE is the HERO element and must be the most visually dominant text on the flyer " +
      "— large, bold, a clear focal point. The imagery supports the headline; it must not overshadow it.",
    "DESIGN QUALITY: a polished flyer as produced by a professional event agency with a skilled graphic designer — " +
      "strong focal hierarchy, confident typography, intentional spacing, art-directed composition. Avoid generic, " +
      "templated, evenly-stacked layouts.",
    "TEXT SAFE AREA — NEVER CUT OFF: all text, and ESPECIALLY the headline, must fit ENTIRELY within the canvas " +
      "with safe margins on every side; never crop letters at the edges.",
    "",
    "The flyer MUST contain ONLY these placeholder texts, clearly legible, correctly spelled EXACTLY as given — no " +
      "gibberish, no invented letters:",
    `HEADLINE, SUBLINE, ${DATE_PLACEHOLDER}, ${time}, LOCATION, DJ NAME 1, DJ NAME 2, DJ NAME 3, CLUBNAME, ${WEBSITE_PLACEHOLDER}.`,
    "ONLY THESE TEXTS: render ONLY the placeholder texts listed above and NO other text. Do NOT invent event names, " +
      "titles, slogans or extra words. The HEADLINE text is literally the word \"HEADLINE\". Each placeholder " +
      "appears EXACTLY ONCE on the whole flyer.",
    "NO LOGOS: the flyer contains NO logos, brand marks or watermarks; the only brand text is the plain CLUBNAME " +
      "placeholder.",
    "",
    "Single flyer filling the frame, high resolution, print-quality. An ORIGINAL design inspired ONLY by the mood " +
      "and colour of the reference, NOT a reproduction of its style, motif or composition.",
    "NEGATIVE: NOT a collage, NOT a moodboard, NOT multiple designs, NOT a copy of the reference's style / motif / " +
      "layout, no logos, no watermarks, no extra text beyond the placeholders. ONE single flyer.",
  ];
  return lines.filter(Boolean).join("\n");
}

module.exports = {
  buildMoodboardPrompt,
  buildIndependentPrompt,
  buildPlaceholderPrompt,
  ROLE_PLACEHOLDERS,
  ROLE_LIST,
  MANDATORY_ROLES,
  DATE_PLACEHOLDER,
  WEBSITE_PLACEHOLDER,
  TIME_PLACEHOLDER,
};
