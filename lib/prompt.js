"use strict";

// One generic, lean role-based prompt for every template. Each provided field
// is listed as a role ("Main title", "Subline", "Lineup" …); empty fields are
// omitted and cleared by a single closing rule. The CLUB LOGO area is always
// cleared (a logo, if any, is composited client-side later — it never goes to
// Ideogram). magic_prompt is OFF (lib/ideogram.js) for exact replacement.
//
// Kept deliberately short: a long prompt overloads the model and hurts font
// fidelity. Casing fidelity for the always-caps slots is reinforced by feeding
// HEADLINE and WEBSITE in uppercase server-side, plus one closing style rule.

function clean(s) {
  return typeof s === "string" ? s.trim() : "";
}

// Full German weekday → 2-letter uppercase abbreviation, so the date reads as
// one clean line like "SA 21.06.2026" instead of being spelled out or split
// into stacked single digits (this also prevents a doubled date).
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
  // HEADLINE and WEBSITE are uppercased (their slots are always caps); the
  // others keep the casing the user typed.
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
  // Artist names exactly as typed (prefixes kept as given, none added).
  const djs = clean(ev.dj).split(",").map((d) => d.trim()).filter(Boolean);

  const lines = [
    "Edit this event flyer. Keep ALL visual elements exactly the same: the background, " +
      "photos, textures, colors, graphic elements, decorations and layout. Only replace " +
      "the text with these new values:",
    "",
  ];

  // Role lines — only for fields that actually have a value.
  if (headline)   lines.push(`- Main title (largest text): "${headline}"`);
  if (subline)    lines.push(`- Subline (script/secondary text): "${subline}"`);
  if (djs.length) lines.push(`- Lineup (artist names, one per slot): ${djs.join(", ")}`);
  if (dateValue)  lines.push(`- Date: "${dateValue}"`);
  if (time)       lines.push(`- Time: "${time}"`);
  if (club)       lines.push(`- Club name: "${club}"`);
  if (location)   lines.push(`- Location: "${location}"`);
  if (website)    lines.push(`- Website: "${website}"`);

  lines.push(
    "",
    "Keep the exact same font styles, sizes, colors, casing and positions as the " +
      "original. Only the words change. The result must look 99% identical to the " +
      "original template.",
    "",
    "For any field with no value, remove its placeholder text and leave clean " +
      "background. Never show placeholder words like HEADLINE, CLUB LOGO, CLUB NAME, " +
      "LOCATION, UHRZEIT, WEBSITE.",
    "Use each artist name exactly as given, do not add any prefix or label that is " +
      "not part of the name."
  );

  return lines.join("\n");
}

module.exports = { buildPrompt };
