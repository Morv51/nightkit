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

// Modus 1 (V1-Vollbild-edit-Prompt) — Strategie: Design-IDENTITÄT + Fonts strikt
// erhalten, aber Komposition DARF umarrangiert/skaliert werden, um Platz für alle
// Pflicht-Felder zu schaffen, OHNE Gesichter zu überdecken (Gesichter haben
// Vorrang vor exakter Foto-Position). Vorhandene Texte werden ersetzt, fehlende
// als gruppierter Info-Block ergänzt. STRIKTE Verbote: jedes Element exakt einmal
// (keine Text-/Personen-Duplikate), kein erfundener/halluzinierter Text, feine
// professionelle Typo (nicht fett). Zonen mit Rolle ENTFERNEN/leer ignoriert.
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
  if (gHead.length) addLines.push(`- Headline area: ${gHead.join(" and ")}`);
  if (gInfo.length) addLines.push(`- Core info (date / time / location): ${gInfo.join(", ")}`);
  if (gLineup.length) addLines.push(`- DJ line-up: ${gLineup.join(", ")}`);
  if (gFoot.length) addLines.push(`- Footer: ${gFoot.join(" and ")}`);

  return [
    "Rebuild this event flyer into a reusable template. Keep the SAME design language, the SAME " +
      "fonts and the SAME overall look as the original. You may ONLY rearrange and resize elements " +
      "to fit all the text fields cleanly. Never place text over faces. Do not invent a new design, " +
      "and do not change the fonts.",
    "",
    "1) Replace the existing texts with their placeholders:",
    ...(replace.length ? replace : ["- (none)"]),
    "",
    ...(addLines.length ? [
      "2) Add the MISSING placeholders, gathered into one tidy, well-organised info area (group them, do not scatter):",
      ...addLines,
    ] : [
      "2) All placeholders already exist — only the replacements above are needed.",
    ]),
    "",
    "EACH ELEMENT EXACTLY ONCE — no duplicates (STRICT):",
    "- Every placeholder appears EXACTLY ONCE: one HEADLINE, one SUBLINE, one DATE, one TIME, one " +
      "LOCATION, DJ NAME 1 / 2 / 3 once each, one CLUBNAME, one WEBSITE.",
    "- Never repeat or duplicate any text. Do NOT show the SUBLINE twice, do NOT show the DATE twice, " +
      "never place the same text in two places.",
    "- Do NOT duplicate people or faces. Keep the people from the original photo in their original " +
      "number and arrangement — never copy, mirror or paste a person a second time.",
    "",
    "NO INVENTED TEXT (STRICT):",
    "- Any original text that is replaced or marked for removal must be cleanly gone. In its place put " +
      "NO made-up text, NO fake or gibberish letters and NO filler — especially under the headline.",
    "- The ONLY text on the flyer is the placeholders listed above. Nothing else.",
    "",
    "KEEP — design identity (non-negotiable):",
    "- The same design idea and visual language as the original. Do NOT create a new concept.",
    "- Reuse the fonts as exactly as possible: the headline font AND the secondary font, with the same " +
      "character, casing, weight and letterforms as the original. Added fields use the flyer's EXISTING " +
      "secondary / body font — never a new font, and never the headline font for body info.",
    "- Keep the colour world, textures, graphic elements and the photo / main motif of the original.",
    "- The people and faces in the photo stay intact, undistorted, fully visible, and are NEVER covered by text.",
    "",
    "YOU MAY (only this, to make room for every field):",
    "- Reposition and resize the photo, the text blocks and the graphic elements to open a clean, " +
      "separate zone for the event info.",
    "- The photo may be scaled smaller or moved, as long as the faces stay whole and clearly recognisable.",
    "- This is NOT a redesign — only rearranging so all fields fit without overlapping.",
    "",
    "TYPOGRAPHY of the added info (TIME, LOCATION, DJ names, CLUBNAME, WEBSITE):",
    "- Set it finely and deliberately, like a professional graphic designer: light or regular weight " +
      "(NOT bold), clear hierarchy, generous clean spacing and precise alignment — restrained and " +
      "elegant, never clunky or uniform.",
    "- Use the flyer's existing secondary / body-text font, never the big display / headline font.",
    "",
    "LAYOUT (zones, top to bottom):",
    "- HEADLINE / SUBLINE at the top, dominant, in the original headline style.",
    "- DATE, TIME, LOCATION as a core-info block, medium size, in the secondary font.",
    "- DJ NAME 1-3 as a stacked line-up, medium-small.",
    "- CLUBNAME and WEBSITE small in the footer.",
    "- All info text sits in clear, free zones — NOT over the photo or the faces.",
    "",
    "PRIORITY on conflict: keeping the faces intact and uncovered matters MORE than the photo's exact " +
      "original position. Rather move or shrink the photo than place any text over a face.",
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
