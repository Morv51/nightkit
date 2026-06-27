"use strict";

// Schlanker, rollenbasierter Prompt-Builder fürs Template Studio (Vorbild:
// lib/prompt.js, aber eigenständig — verändert dort nichts).

// Überall feste Platzhalter:
const DATE_PLACEHOLDER = "19.06.2026";
const WEBSITE_PLACEHOLDER = "www.website.com";
const TIME_PLACEHOLDER = "UHRZEIT"; // wie in den bestehenden Templates

const v = (x) => (typeof x === "string" ? x.trim() : "");

// Style-Slider (0..1) → Formulierung der Stiltreue. Ideogram V3 hat KEINEN
// nativen Strength-Parameter, daher wird die Bindung über den Prompt gesteuert.
function adherencePhrase(s) {
  const n = typeof s === "number" ? s : 0.5;
  if (n < 0.34) return "loosely reinterpreted from the reference, not a copy";
  if (n > 0.66) return "closely reinterpreted from the reference, not a direct copy";
  return "reinterpreted from the reference, not a copy";
}

// Modus 2: baut das vorgegebene Gerüst aus der Stil-DNA. Das Ergebnis ist
// mittig im UI editierbar — diese Funktion liefert nur den Default.
function buildMoodboardPrompt(dna, opts = {}) {
  const d = dna || {};
  const time = v(opts.time) || TIME_PLACEHOLDER;
  const style = [
    v(d.look_mood), v(d.color_world), v(d.imagery), v(d.composition),
    v(d.visual_hierarchy), v(d.texture_grain_light), v(d.editorial_club_look),
  ].filter(Boolean).join(" · ");
  const typography = v(d.typography) || "bold modern poster typography";

  return [
    "Vertical 9:16 club event poster, single flyer filling the entire frame, high resolution, print-quality.",
    `STYLE (${adherencePhrase(opts.styleAdherence)}): ${style}`,
    `TYPOGRAPHY: ${typography}, clean spacing, professional kerning, text integrated as native layout, not overlaid on a finished image.`,
    "TEXT (render exactly, distinct lines, correct hierarchy):",
    `HEADLINE / SUBLINE / ${DATE_PLACEHOLDER} / ${time} / LOCATION / DJ NAME 1 / DJ NAME 2 / DJ NAME 3 / CLUBNAME / ${WEBSITE_PLACEHOLDER}`,
    "NEGATIVE: no logos, no watermarks, no additional text, no extra graphics, not a copy of the reference.",
  ].join("\n");
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

// Beschreibt eine Font-Referenz-Zone für den Prompt: Text + grobe Eigenschaften.
function refDesc(ref) {
  if (!ref || !v(ref.text)) return "";
  const f = ref.font || {};
  const props = [f.style, f.casing, f.weight].filter(Boolean).join(", ");
  return `"${v(ref.text)}"${props ? ` (${props})` : ""}`;
}

// Modus 1: edit()-Prompt, der (1) vorhandene Texte durch die zugewiesenen
// Platzhalter ersetzt, (2) fehlende Pflicht-Platzhalter STILKOHÄRENT ergänzt und
// (3) eine feste visuelle Hierarchie + Font-Trennung + optionale Font-Referenzen
// vorgibt. Zonen mit Rolle "ENTFERNEN"/unbekannt/leer werden hier ignoriert.
// opts: { infoRef, headlineRef } — je eine erkannte Zone {text, font} als Stil-Anker.
function buildPlaceholderPrompt(zones, opts = {}) {
  const list = zones || [];
  const assigned = new Set();
  const replace = [];
  for (const z of list) {
    if (z && ROLE_PLACEHOLDERS[z.role] && v(z.text)) {
      replace.push(`- Replace the text "${v(z.text)}" with "${ROLE_PLACEHOLDERS[z.role]}"`);
      assigned.add(z.role);
    }
  }
  const missing = MANDATORY_ROLES
    .filter((r) => !assigned.has(r))
    .map((r) => `- Add a new "${ROLE_PLACEHOLDERS[r]}" text element (it is not in the original)`);

  const info = refDesc(opts.infoRef);
  const head = refDesc(opts.headlineRef);

  return [
    "Edit this event flyer into a reusable template. Keep the design, layout, colours, " +
      "textures and all graphic elements the same. Replace and add text as follows.",
    "",
    "1) Replace existing text with these placeholders (keep each one's original font and position):",
    ...(replace.length ? replace : ["- (none)"]),
    "",
    "2) Add these MISSING placeholders (they are not in the original yet):",
    ...(missing.length ? missing : ["- (none — all already present)"]),
    "",
    "VISUAL HIERARCHY — apply strictly to the placeholders, especially the added ones:",
    "- Level 1, dominant: HEADLINE",
    "- Level 2, secondary: SUBLINE",
    "- Level 3, core info (medium size): DATE, TIME, LOCATION",
    "- Level 4, line-up (medium-small): DJ NAME 1, DJ NAME 2, DJ NAME 3",
    "- Level 5, footer (small, understated, lower area of the flyer): CLUBNAME, WEBSITE",
    "Keep CLUBNAME and WEBSITE small as a discreet bottom footer line — never prominent.",
    "",
    "FONTS (critical):",
    "- The flyer's distinctive display/headline font is for HEADLINE and SUBLINE ONLY.",
    "- The info levels (DATE, TIME, LOCATION, DJ NAMES, CLUBNAME, WEBSITE) must NOT use that " +
      "headline font. Set them in a clean, legible secondary font that fits the flyer's style.",
    ...(info ? [`- Match the info-level fields to the style of the existing text ${info}: same ` +
      "font character, casing, kerning and setting — set them as cleanly as that reference, never pasted on."] : []),
    ...(head ? [`- Set HEADLINE and SUBLINE in the style of the existing text ${head}.`] : []),
    "",
    "Derive sizes and colours from the existing texts, place added elements in calm empty areas " +
      "with clean spacing and proper kerning, so they look like they were part of the design from " +
      "the start. Do not move or distort existing graphics.",
  ].join("\n");
}

module.exports = {
  buildMoodboardPrompt,
  buildPlaceholderPrompt,
  ROLE_PLACEHOLDERS,
  ROLE_LIST,
  MANDATORY_ROLES,
  DATE_PLACEHOLDER,
  WEBSITE_PLACEHOLDER,
  TIME_PLACEHOLDER,
};
