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

const ROLE_LIST = Object.keys(ROLE_PLACEHOLDERS);

// Modus 1: aus den Zonen (Originaltext + gewählte Rolle) einen schlanken
// edit()-Prompt bauen, der die echten Texte durch unsere Platzhalter ersetzt
// und Design/Typo erhält. Zonen mit Rolle OTHER/leer werden ignoriert.
function buildPlaceholderPrompt(zones) {
  const lines = (zones || [])
    .filter((z) => z && ROLE_PLACEHOLDERS[z.role] && v(z.text))
    .map((z) => `- Replace the text "${v(z.text)}" with "${ROLE_PLACEHOLDERS[z.role]}"`);

  return [
    "Edit this event flyer. Keep the design, layout, fonts, colours, textures and all " +
      "graphic elements EXACTLY the same. Only replace the existing text with these generic " +
      "placeholders, matching the original letterforms and font style:",
    "",
    ...(lines.length ? lines : ["- (no text zones selected)"]),
    "",
    "Do not add, remove or move any graphic element. Change only the words. The result must " +
      "look identical to the original, just with the placeholder texts.",
  ].join("\n");
}

module.exports = {
  buildMoodboardPrompt,
  buildPlaceholderPrompt,
  ROLE_PLACEHOLDERS,
  ROLE_LIST,
  DATE_PLACEHOLDER,
  WEBSITE_PLACEHOLDER,
  TIME_PLACEHOLDER,
};
