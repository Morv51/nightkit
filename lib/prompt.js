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

  // Uppercase + compact, to match the look of typical date placeholders
  // (e.g. "24 AUG 24") so Ideogram keeps the template's date font.
  const dateBits = [weekday, dateRaw].filter(Boolean).join(" · ");
  const dateStr = [dateBits, time ? `Einlass ${time} Uhr` : ""]
    .filter(Boolean)
    .join(" · ")
    .toUpperCase();
  if (dateStr) {
    lines.push(
      `Replace the date placeholder with: "${dateStr}". Render it in the SAME font, weight, style, size and colour as the original date text already in this template — match the flyer's typography exactly and do NOT use a plain or generic font.\n`
    );
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
