"use strict";

// Schlanker, rollenbasierter Prompt-Builder fürs Template Studio (Vorbild:
// lib/prompt.js, aber eigenständig — verändert dort nichts).

// Überall feste Platzhalter:
const DATE_PLACEHOLDER = "19.06.2026";
const WEBSITE_PLACEHOLDER = "www.website.com";
const TIME_PLACEHOLDER = "UHRZEIT"; // wie in den bestehenden Templates

const v = (x) => (typeof x === "string" ? x.trim() : "");

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
      "and the typical over-smooth AI-generated look.",
    "IF THE REFERENCE IS ILLUSTRATED / GRAPHIC — keep that illustrated, drawn, vector or painted rendering " +
      "exactly as the reference has it; do NOT force a photo or add photorealism where the source is not " +
      "photographic.",
    "PHOTO-VS-GRAPHIC SEPARATION — regardless of the above, the graphic DESIGN layer (typography, shapes, " +
      "icons, patterns, decorative devices, colour fields and graphic backgrounds) always stays clean and " +
      "GRAPHIC / vector as designed. Only the person and real-world motifs follow the photographic-or-" +
      "illustrated decision. This is the normal, professional flyer mix of a real photograph combined with " +
      "crisp graphic design.",
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
    "GRAPHIC LAYER DEPTH — SUBTLE OVERLAP, STILL FLAT: build the composition with gentle layered depth, the " +
      "way a human designer stacks layers in Photoshop — let elements overlap slightly so the flyer feels " +
      "layered rather than flatly assembled (for example the main person standing slightly in front of the " +
      "headline, a motif overlapping a text edge, one element nudged in front of another). This is ONLY a " +
      "light overlap of flat layers within the 2D composition. It is NOT 3D, NOT perspective, and the " +
      "typography stays perfectly straight, upright and flat — never tilt, skew, rotate, curve, warp or " +
      "distort any text. Keep the overlap subtle, believable and restrained, never dramatic. ALL text " +
      "(headline, subline, DJ names, date, time, clubname, location, website) must always stay fully legible " +
      "and complete — an overlap must NEVER make any letter unreadable or hide any part of the text; when in " +
      "doubt, use less overlap.",
    "HEADLINE TYPOGRAPHY: the headline's lettering must closely match the headline style of the reference — " +
      "the same character of lettering (weight, shape, personality, effect, treatment) as captured in the " +
      "typography analysis. Do NOT default to a generic font; mirror the reference's headline style as " +
      "closely as possible while still rendering the new placeholder word in full.",
    "SECONDARY TEXT AS DESIGN: all secondary information (date, time, location, DJ names, club name, " +
      "website) must be DESIGNED and integrated into the layout — NOT plain default text pasted on top like " +
      "a quick social-media overlay. Set it like a professional designer: typography that fits the flyer's " +
      "overall style, with intentional sizing, spacing, alignment and rhythm; it may use the design's accent " +
      "colours, dividers or styling cues derived from the reference so it feels part of the composition, never " +
      "a generic overlay. Keep it clearly legible and subordinate to the headline.",
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
