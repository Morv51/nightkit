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

// Fehlende Rollen einer Gruppe als Platzhalter-Liste ("DATUM, UHRZEIT").
function groupList(missingSet, roles) {
  return roles.filter((r) => missingSet.has(r)).map((r) => ROLE_PLACEHOLDERS[r]);
}

// Modus 1 (V1-Vollbild-edit-Prompt): (1) vorhandene Texte 1:1 durch ihre
// Platzhalter ersetzen (Original-Font/Position behalten), (2) NUR die fehlenden
// Pflicht-Platzhalter als EINEN kohärenten, logisch gruppierten Info-Block
// ergänzen — untergeordnet, im Sekundär-Font, in ruhigen Bildzonen ohne
// Hauptmotiv/Gesichter zu überdecken. Zonen mit Rolle ENTFERNEN/leer ignoriert.
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
  const missingSet = new Set(MANDATORY_ROLES.filter((r) => !assigned.has(r)));

  const gHead = groupList(missingSet, ["HEADLINE", "SUBLINE"]);
  const gInfo = groupList(missingSet, ["DATUM", "UHRZEIT", "LOCATION"]);
  const gLineup = groupList(missingSet, ["DJ NAME 1", "DJ NAME 2", "DJ NAME 3"]);
  const gFoot = groupList(missingSet, ["CLUBNAME", "WEBSITE"]);

  const addLines = [];
  if (gHead.length) addLines.push(`- ${gHead.join(" and ")} as the dominant headline area (large, like the original).`);
  if (gInfo.length) addLines.push(`- Date, time and location as ONE compact core-info group, medium size: ${gInfo.join(", ")}.`);
  if (gLineup.length) addLines.push(`- The DJ line-up as a neat stacked list, one name per line, medium-small: ${gLineup.join(", ")}.`);
  if (gFoot.length) addLines.push(`- ${gFoot.join(" and ")} small and understated as a single footer line at the very bottom.`);

  return [
    "Edit this event flyer into a reusable template. Keep the design, layout, photos, colours, " +
      "textures and all graphic elements exactly the same.",
    "",
    "1) Replace existing text with these placeholders, keeping each one's ORIGINAL font, size, " +
      "colour, casing and position:",
    ...(replace.length ? replace : ["- (none)"]),
    "",
    ...(addLines.length ? [
      "2) Add the MISSING placeholders below as ONE coherent, well-organised info block — grouped " +
        "logically as described, NOT scattered around:",
      ...addLines,
      "",
      "RULES for the ADDED text (important — they must look designed-in, not pasted on):",
      "- HIERARCHY: HEADLINE and SUBLINE stay dominant like the original; all added info is clearly " +
        "SUBORDINATE and smaller. CLUBNAME and WEBSITE are the smallest, at the bottom — never prominent.",
      "- FONT: render all added info in the flyer's existing clean secondary / body-text font (the " +
        "smaller, non-headline text style already on the flyer). Do NOT use the big display/headline font for it.",
      "- PLACEMENT: put the added block in a calm, empty area. Do NOT cover or overlap the main subject, " +
        "people, faces or key graphics. Keep tidy spacing, alignment and kerning; match the existing colours.",
    ] : [
      "2) All placeholders are already present — only the replacements above are needed.",
    ]),
    "",
    "Do not move, distort or restyle the existing artwork. The result is a clean, balanced template.",
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
