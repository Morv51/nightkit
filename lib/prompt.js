"use strict";

// One generic prompt for every template. The templates carry their own
// placeholder texts (CLUB LOGO, HEADLINE, Subline, date, DJ list, website),
// so the prompt only describes the user's content and tells Ideogram to swap
// the matching placeholders. The CLUB LOGO area is ALWAYS cleared — if the
// user uploaded a logo it is composited there afterwards, otherwise it stays
// empty. magic_prompt is OFF (set in lib/ideogram.js) for exact replacement.

function clean(s) {
  return typeof s === "string" ? s.trim() : "";
}

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

// Breaks "30.06.2026" into parts so the prompt can let Ideogram format the
// date in the template's own style (abbreviated weekday, numeric or short-name
// month, etc.) rather than imposing one fixed format.
function parseDate(s) {
  const m = clean(s).match(/^(\d{1,2})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{2,4})$/);
  if (!m) return null;
  const monthIdx = parseInt(m[2], 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return null;
  return {
    day: String(parseInt(m[1], 10)),
    monthNum: m[2].padStart(2, "0"),
    monthName: MONTHS_DE[monthIdx],
    year: m[3].length === 2 ? "20" + m[3] : m[3],
    year2: m[3].slice(-2),
  };
}

function buildPrompt(rawEvent) {
  const ev = rawEvent || {};
  const headline = clean(ev.name).toUpperCase();
  const subline  = clean(ev.prefix);
  const weekday  = clean(ev.day);
  const dateRaw  = clean(ev.date);
  const time     = clean(ev.time);
  const website  = clean(ev.contact).toUpperCase();
  const club     = clean(ev.club);
  const location = clean(ev.location);
  // Names stay exactly as typed (no uppercasing) — the prompt instructs
  // Ideogram to use them verbatim, incl. keeping or omitting a "DJ" prefix.
  const djs = clean(ev.dj)
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const lines = [
    "Edit this event flyer. Keep the visual design, colours, graphics, fonts, ",
    "decorations and layout EXACTLY as they are — only replace the placeholder ",
    "TEXT with the information below, and change nothing else.\n\n",
    // Das Logo geht nie an Ideogram (es wird clientseitig einkomponiert),
    // deshalb gilt die Entfernen-Regel hier immer, nicht konditional.
    "Completely remove any logo placeholder text such as 'CLUB LOGO' and fill ",
    "that area with clean matching background. Never leave the words 'CLUB LOGO' ",
    "or any logo placeholder visible. Put no text or graphics in that area.\n",
  ];

  if (headline) lines.push(`Replace the main HEADLINE with: "${headline}"\n`);

  // Optional zones: if the user left the field empty, REMOVE the placeholder
  // explicitly — leaving the instruction out makes Ideogram keep the original
  // placeholder word (e.g. "Subline") on the flyer.
  lines.push(
    subline
      ? `Replace the subline / script text with: "${subline}"\n`
      : "Remove the subline / script placeholder text completely and leave that area empty.\n"
  );

  // Date: give Ideogram the parts and tell it to reuse the template's OWN date
  // format (abbreviated weekday like "SA", numeric/short-name month, stacking,
  // font) instead of imposing one written-out format.
  const dq = parseDate(dateRaw);
  if (weekday || dateRaw) {
    const values = dq
      ? `weekday "${weekday}", day ${dq.day}, month ${dq.monthNum} ("${dq.monthName}"), year ${dq.year}`
      : `"${[weekday, dateRaw].filter(Boolean).join(" ")}"`;
    let instr =
      `For the DATE: keep the template's existing date format, layout, line stacking, ` +
      `abbreviation style, size, colour and font EXACTLY — only substitute this event's values ` +
      `(${values}). Mirror the template 1:1: if it abbreviates the weekday (e.g. "SA"), abbreviate ` +
      `it the same way (e.g. "DI"); if it shows the month as a two-digit number, use the number; ` +
      `if as a short name (e.g. "AUG"), use the short name (e.g. "JUN"); if the lines are stacked, ` +
      `stack them the same way. Do not spell anything out more than the template does.`;
    if (time) {
      instr += ` Door time "EINLASS ${time} UHR": add it only if the template already has room near the date, in the same style; otherwise omit it.`;
    }
    lines.push(instr + "\n");
  }

  // Templates tragen vorgedruckte Lineup-Platzhalter ("DJ", "ALEX", "John
  // Doe" …) — die Anweisung muss deren Reste explizit verbieten, sonst
  // entstehen Mischformen wie "ALEX Marveles" oder verwaiste "DJ"-Prefixe.
  lines.push(
    djs.length
      ? "Replace the entire lineup/artist section of the template with exactly the " +
        `following names, in this order: ${djs.map((d) => `"${d}"`).join(", ")}. ` +
        "Use each name EXACTLY as written. Do not add, keep or invent any prefix, " +
        "title or additional name. If a name does not contain 'DJ' or 'DJane', it must " +
        "appear without any such prefix. Remove any placeholder prefixes, first names, " +
        "or secondary names that exist in the template (for example placeholder words " +
        "like 'DJ', 'ALEX', 'MARVELES', 'John Doe') unless they exactly match a name " +
        "the user provided. If the user provided fewer names than there are slots in " +
        "the template, completely remove the unused slots and leave that area as clean " +
        "background. Never display any artist name that the user did not provide.\n"
      : "Remove the DJ / artist placeholder text completely and leave that area empty.\n"
  );

  lines.push(
    website
      ? `Replace the website placeholder with: "${website}"\n`
      : "Remove the website placeholder text completely and leave that area empty.\n"
  );

  lines.push(
    (club
      ? `Replace the template placeholder 'CLUB NAME' with exactly: "${club}". `
      : "The CLUB NAME value is missing: remove the 'CLUB NAME' placeholder text " +
        "entirely and fill with clean background. ") +
    (location
      ? `Replace the template placeholder 'LOCATION' with exactly: "${location}". `
      : "The LOCATION value is missing: remove the 'LOCATION' placeholder text " +
        "entirely and fill with clean background. ") +
    "Never leave the literal words 'LOCATION' or 'CLUB NAME' visible.\n"
  );

  lines.push(
    "\nAny placeholder label text from the template that is not replaced by user " +
      "input must be removed and filled with clean matching background. The final " +
      "image must never show leftover placeholder words like HEADLINE, SUBLINE, " +
      "CLUB LOGO, LOCATION, CLUB NAME, UHRZEIT. " +
      "Render every letter exactly as written; never invent replacement text."
  );

  return lines.join("");
}

module.exports = { buildPrompt };
