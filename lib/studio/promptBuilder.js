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
      "to fit all the text fields cleanly. Never place text over the main visual subjects of the flyer " +
      "(e.g. people/faces, products, vehicles, logos, key graphic elements) — keep the central motif " +
      "fully visible and uncovered. Do not invent a new design, and do not change the fonts.",
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
    "- The ONLY text on the flyer is the placeholders listed above. Nothing else.",
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
