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

// Modus 1: edit()-Prompt, der (1) vorhandene Texte durch die zugewiesenen
// Platzhalter ersetzt UND (2) fehlende Pflicht-Platzhalter STILKOHÄRENT ergänzt
// (nicht weglässt). Zonen mit Rolle "ENTFERNEN"/unbekannt/leer werden hier
// ignoriert — die laufen separat über das LaMa-Removal.
function buildPlaceholderPrompt(zones) {
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

  return [
    "Edit this event flyer into a reusable template. Keep the design, layout, fonts, colours, " +
      "textures and all graphic elements the same. Two tasks:",
    "",
    "1) Replace existing text with these generic placeholders (match the original letterforms):",
    ...(replace.length ? replace : ["- (none)"]),
    "",
    "2) Add these MISSING placeholders so the template carries the full set:",
    ...(missing.length ? missing : ["- (none — all already present)"]),
    "",
    "Style for the ADDED placeholders (critical — they must look native, never pasted on):",
    "- Derive font family, casing, size, colour and weight from the flyer's existing texts.",
    "- Respect hierarchy: HEADLINE dominant, SUBLINE secondary, DJ NAME 1-3 / LOCATION / " +
      "UHRZEIT / CLUBNAME / WEBSITE as a smaller, subordinate info layer.",
    "- Place them in calm, empty areas without covering central motifs; keep clean spacing.",
    "- They must look as if they were part of the design from the start.",
    "",
    "Do not move or distort existing graphics. The result is a clean template that carries " +
      "ALL placeholder texts in one coherent style.",
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
