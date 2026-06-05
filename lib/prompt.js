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
  const djs = clean(ev.dj)
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean);

  const lines = [
    "Edit this event flyer. Keep the visual design, colours, graphics, fonts, ",
    "decorations and layout EXACTLY as they are — only replace the placeholder ",
    "TEXT with the information below, and change nothing else.\n\n",
    'Leave the "CLUB LOGO" placeholder (top) COMPLETELY EMPTY — remove the words ',
    '"CLUB LOGO" and put no text or graphics there.\n',
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

  lines.push(
    djs.length
      ? `Replace the DJ / artist list with these names, each on its own line, no commas: ${djs
          .map((d) => `"${d}"`)
          .join(", ")}\n`
      : "Remove the DJ / artist placeholder text completely and leave that area empty.\n"
  );

  lines.push(
    website
      ? `Replace the website placeholder with: "${website}"\n`
      : "Remove the website placeholder text completely and leave that area empty.\n"
  );

  lines.push(
    "\nAny placeholder whose replacement is to be removed must be erased cleanly, leaving the background intact. ",
    "Render every letter exactly as written; do not invent extra text."
  );

  return lines.join("");
}

module.exports = { buildPrompt };
