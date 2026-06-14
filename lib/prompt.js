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

// Template-Design-Empfehlung (für bessere Generierungen — gilt beim Bauen
// neuer Templates, nicht für diesen Code):
//   • DJ-Slots generisch benennen: "DJ NAME 1", "DJ NAME 2" … statt fester
//     Beispielnamen mit angehefteten Tags wie "DJ JOHN DOE" / "ALEX".
//   • Lieber mehr Slots als nötig anlegen (4–5 statt 2–3) — leere werden vom
//     Modell entfernt.
//   • Platzhalter konsistent benennen: HEADLINE, SUBLINE, DJ NAME 1-5,
//     SA TT.MM.JJJJ, UHRZEIT, CLUB NAME, LOCATION, WWW.WEBSITE.DE.
//   • Keine dekorativen Textelemente direkt an einem Platzhalter, die das
//     Modell als Teil des Platzhalters missverstehen könnte.
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
    "Your task is ONLY to replace placeholder words with the provided values while " +
      "keeping the design, typography and layout pixel-faithful to the template. You " +
      "are not redesigning anything. Think of yourself as filling in the blanks of an " +
      "existing finished design, matching its exact style.",
    "",
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
    "This is critical: each replaced text must use the IDENTICAL font, weight, size, " +
      "colour, casing and letter-spacing as the original placeholder it replaces. Treat " +
      "each placeholder as a fixed style slot: keep the exact typographic style of that " +
      "slot and only swap the words inside it. Different placeholders have different " +
      "fonts, preserve each one individually. Never substitute a font, never change a " +
      "text colour, never restyle a text element. The typography of the finished flyer " +
      "must look identical to the empty template, only the words differ.",
    "Match the exact letter casing of each placeholder. If the placeholder text is in " +
      "ALL CAPS (like 'CLUB NAME' or 'LOCATION'), render the replacement value in ALL " +
      "CAPS as well (e.g. 'JOLLY JOKER', 'BRAUNSCHWEIG'). If the placeholder uses " +
      "letter-spacing or spaced-out characters, keep that same spaced style. The " +
      "replacement must visually match the placeholder's casing and spacing exactly, " +
      "only the words change.",
    "For the DATE: display it as a single clean line (two lines maximum), exactly as " +
      "provided (e.g. \"SA 21.06.2026\"). Do not split it into many separate fragments " +
      "or stacked single digits. Insert the event date EXACTLY ONCE. If the template " +
      "contains a separate large year element (like a standalone '2026') in addition to " +
      "a full date placeholder, do NOT fill both: place the complete date in the main " +
      "date placeholder only and remove or leave empty any separate standalone year " +
      "element. The date must never appear twice anywhere in the image.",
    "For the TIME: replace any occurrence of 'UHRZEIT' (or a similar time placeholder) with the exact time value; if no time is provided, remove it.",
    "For the CLUB NAME: replace any occurrence of 'CLUB NAME' with the exact club name value; if none is provided, remove it.",
    "For the LOCATION: replace any text that reads 'LOCATION', 'Location', 'Ort' or any " +
      "similar placeholder in the lower section of the template with the exact location " +
      "value. If location is empty, remove it entirely. The replacement must appear in " +
      "exactly the same visual style as the original placeholder text (same font, same " +
      "size, same colour, same position). Do not move, resize or restyle this text element.",
    "For the DJ/artist lineup: use each name EXACTLY as provided, nothing more and " +
      "nothing less. Do not add any role label, prefix or secondary name above or below " +
      "the artist name (such as 'DJ', 'ALEX', 'DJANE', 'MC', 'LIVE' or any other tag) " +
      "unless it is explicitly part of the provided name. Remove any such labels that " +
      "exist as part of the template design in the lineup slots. Each slot shows only " +
      "the artist name as provided, no additional text. Never invent extra names, and " +
      "completely remove any unused name slots.",
    "Preserve the complete visual design of the template: all background elements, " +
      "decorative elements, images, textures, colours, graphic elements and layout must " +
      "remain completely unchanged. Only replace the designated placeholder text areas. " +
      "Do not alter, move or remove any non-text design element.",
  ];

  return lines.join("\n");
}

module.exports = { buildPrompt };
