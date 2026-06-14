"use strict";

// One generic prompt for every template. Templates carry their own placeholder
// texts (CLUB LOGO, HEADLINE, Subline, DATUM, UHRZEIT, DJ names, CLUB NAME,
// LOCATION, website). The prompt maps every form field onto its placeholder and
// applies ONE rule to all of them: value provided → replace exactly; value
// empty → remove the placeholder and fill with clean background. The CLUB LOGO
// area is always cleared (a logo, if any, is composited client-side later).
// magic_prompt is OFF (lib/ideogram.js) for exact replacement.

function clean(s) {
  return typeof s === "string" ? s.trim() : "";
}

// Full German weekday → 2-letter uppercase abbreviation, so the date reads as
// one clean line like "SA 21.06.2026" instead of being spelled out or split
// into stacked single digits.
const WEEKDAY_ABBR = {
  Montag: "MO", Dienstag: "DI", Mittwoch: "MI", Donnerstag: "DO",
  Freitag: "FR", Samstag: "SA", Sonntag: "SO",
};

function abbrevWeekday(w) {
  return WEEKDAY_ABBR[w] || w;
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
  // One clean date line, e.g. "SA 21.06.2026" (weekday abbreviation + date).
  const dateValue = [abbrevWeekday(weekday), dateRaw].filter(Boolean).join(" ");
  // Names exactly as typed (no uppercasing; an existing DJ/DJane prefix is kept
  // and none is added — see the lineup rule below).
  const djs = clean(ev.dj).split(",").map((d) => d.trim()).filter(Boolean);

  // Per-field line: replace the placeholder with the value, or remove it
  // cleanly when empty. The empty-field behaviour that used to apply only to
  // the website now applies to EVERY field.
  const map = (label, hint, value) =>
    value
      ? `Replace the ${label} placeholder (${hint}) with: "${value}"`
      : `Remove the ${label} placeholder (${hint}) completely and fill the area with clean matching background`;

  const lines = [
    "Edit this event flyer template. Keep the visual design, colours, graphics, " +
      "fonts, decorations and layout EXACTLY as they are. Replace ALL placeholder " +
      "text in the template with the following values. For each field: if a value " +
      "is provided, replace the placeholder exactly with that value; if a value is " +
      "empty or not provided, remove the placeholder text completely and fill the " +
      "area with clean matching background.",
    "",
    // CLUB LOGO is always cleared — a logo, if uploaded, is composited later.
    "Remove the CLUB LOGO placeholder (top logo area, e.g. 'CLUB LOGO') completely and put no text or graphics there.",
    map("HEADLINE", "largest text, e.g. 'HEADLINE'", headline),
    map("SUBLINE", "script / italic line, e.g. 'Subline'", subline),
    map("DATE", "date area, e.g. 'DATUM', 'DATE', day/month/year block", dateValue),
    map("TIME", "e.g. 'UHRZEIT', 'TIME', 'Uhrzeit'", time),
    djs.length
      ? "Replace the DJ / LINEUP placeholders (artist name areas) with these names, " +
        `one name per slot, in this order: ${djs.map((d) => `"${d}"`).join(", ")}`
      : "Remove the DJ / LINEUP placeholders (artist name areas) completely and fill the area with clean matching background",
    map("CLUB NAME", "e.g. 'CLUB NAME', 'Club Name'", club),
    map("LOCATION", "e.g. 'LOCATION', 'Location'", location),
    map("WEBSITE", "e.g. 'WWW.WEBSITE.COM', 'www.website.de'", website),
    "",
    "CRITICAL RULES:",
    "Replace every single placeholder with exactly the provided value, character for character.",
    "If a field is empty, remove that placeholder entirely and fill with clean matching background.",
    "Never leave any placeholder word visible in the final image (for example HEADLINE, SUBLINE, DATUM, UHRZEIT, CLUB LOGO, CLUB NAME, LOCATION, WWW.WEBSITE.COM).",
    "Never invent, translate or hallucinate values for empty fields.",
    "For the DATE: display it as a single clean line (two lines maximum), exactly as " +
      "provided (e.g. \"SA 21.06.2026\"). Do not split it into many separate fragments " +
      "or stacked single digits.",
    "For the TIME: replace any occurrence of 'UHRZEIT' (or a similar time placeholder) with the exact time value; if no time is provided, remove it.",
    "For the CLUB NAME: replace any occurrence of 'CLUB NAME' with the exact club name value; if none is provided, remove it.",
    "For the LOCATION: replace any occurrence of 'LOCATION' with the exact location value; if none is provided, remove it.",
    "For the LINEUP: use each artist name exactly as written, keep an existing 'DJ' or " +
      "'DJane' prefix, never add a prefix that was not provided, never invent extra " +
      "names, and completely remove any unused name slots.",
  ];

  return lines.join("\n");
}

module.exports = { buildPrompt };
