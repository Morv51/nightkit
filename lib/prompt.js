"use strict";

// One generic, lean prompt for every template, gebaut aus EINER zentralen Liste
// (slotsFor): je Platzhalter das WORT, das auf dem Flyer steht, und sein Wert.
// Aus derselben Liste entstehen BEIDE Richtungen — die Ersetzungszeilen fuer
// gefuellte Felder und die Entfernen-Zeilen fuer leere. Zwei getrennte Listen
// waren die Ursache der Website-Falle: die Ersetzung sprach von "Website", die
// Leer-Regel von "WEBSITE", auf dem Bild stand aber "www.website.com" — kein
// Treffer, der Platzhalter blieb stehen. Ebenso UHRZEIT: die Rolle hiess "Time",
// das Wort auf dem Bild ist deutsch, die Bindung fehlte ganz.
// Darum spricht der Prompt jetzt das Vokabular der Templates (TOKEN).
// Die CLUB-LOGO-Flaeche steht IMMER in der Entfernen-Liste (ein Logo wird, falls
// vorhanden, spaeter clientseitig einkomponiert und geht nie an Ideogram).
// magic_prompt is OFF (lib/ideogram.js) for exact replacement.
//
// Kept deliberately short: a long prompt overloads the model and hurts font
// fidelity. Casing for the always-caps slots is decided per template upstream
// (lib/templates.uppercaseFor) and reinforced by one closing style rule.

function clean(s) {
  return typeof s === "string" ? s.trim() : "";
}

// The template placeholder is a compact date with a 2-digit year (19.06.26).
// The form sends DD.MM.YYYY (e.g. 15.08.2026); trim only the year so the value
// matches the placeholder's shape exactly. A 4-digit year plus a prepended
// weekday made the model stack the date over several lines ("SA / 15.08. /
// 2026") and turned it into a second focal point. No weekday is added here:
// there is no weekday placeholder in the templates. Anything not in the
// DD.MM.YYYY shape is passed through unchanged rather than reformatted on a
// guess.
function shortYear(d) {
  const m = /^(\d{2}\.\d{2}\.)\d{2}(\d{2})$/.exec(d);
  return m ? m[1] + m[2] : d;
}

// Bauteil 6: Uhrzeit-WERT auf HH:MM normalisieren und als "HH:MMh" rendern. Nur Darstellung des
// Werts — der Platzhalter-Mechanismus bleibt unberuehrt, ein leeres Feld wird weiter restlos
// entfernt. Nur eine EINDEUTIG erkennbare Einzeluhrzeit wird umgeschrieben; Bereiche oder Zusaetze
// ("20:00-04:00", "ab 22 Uhr") bleiben unveraendert stehen, damit nichts verstuemmelt wird.
function timeValue(raw) {
  const s = clean(raw);
  if (!s) return "";
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?\s*(?:uhr|h)?$/i.exec(s);
  if (!m) return s;
  const hh = parseInt(m[1], 10);
  const mm = m[2] != null ? parseInt(m[2], 10) : 0;
  if (hh > 23 || mm > 59) return s;
  const p2 = (n) => (n < 10 ? "0" + n : "" + n);
  return p2(hh) + ":" + p2(mm) + "h";
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
// Die Platzhalterwoerter EXAKT in der Schreibweise der Templates. Der Prompt muss
// das Vokabular sprechen, das auf den Bildern steht — CLUBNAME ohne Leerzeichen,
// die Website kleingeschrieben als URL, UHRZEIT deutsch.
const TOKEN = {
  headline: "HEADLINE",
  subline:  "SUBLINE",
  date:     "19.06.26",
  time:     "UHRZEIT",
  club:     "CLUBNAME",
  location: "LOCATION",
  website:  "www.website.com",
  logo:     "CLUB LOGO",
  dj:       (n) => "DJ NAME " + n,
};

// DIE zentrale Liste: { token, value, hint? }. Alles Weitere wird daraus abgeleitet,
// damit Ersetzung und Entfernung nie auseinanderlaufen koennen.
function slotsFor({ headline, subline, dateValue, time, djs, club, location, website }) {
  const slots = [
    { token: TOKEN.headline, value: headline,
      hint: "match the exact letterforms and font style of the placeholder, especially for script or decorative fonts" },
    { token: TOKEN.subline,  value: subline },
    { token: TOKEN.date,     value: dateValue },
    { token: TOKEN.time,     value: time },
  ];
  djs.forEach((name, i) => slots.push({ token: TOKEN.dj(i + 1), value: name }));
  // Der erste unbenutzte DJ-Slot deckt alle weiteren mit ab (Templates haben 3-5).
  slots.push({ token: TOKEN.dj(djs.length + 1), value: "", note: "and any further DJ slots" });
  slots.push(
    { token: TOKEN.club,     value: club },
    { token: TOKEN.location, value: location,
      hint: "keep the placeholder's spaced-out uppercase style and any decorative lines around it" },
    { token: TOKEN.website,  value: website },
    // Nie befuellt: das Logo wird spaeter clientseitig einkomponiert.
    { token: TOKEN.logo,     value: "" },
  );
  return slots;
}

// ── BETA-PFAD "Beispieltext-Templates" ────────────────────────────────────────────────────
// Ein solches Template zeigt im Bild fertigen Beispieltext statt Platzhalterwoerter. Die
// Zuordnungstabelle (lib/admin/sampleMap.js) sagt, welcher sichtbare Text zu welchem
// Eingabefeld gehoert. Ersetzt wird dann Beispieltext -> Kundeneingabe.
// ADDITIV: ohne Tabelle laeuft alles exakt wie bisher, zeichengleich.

// Schreibweise je Feld nach dem BEISPIELWERT (nicht per normalizeCasing): der Beispieltext
// zeigt selbst, welche Schreibweise das Design nutzt. Durchgehend versal -> Eingabe versal;
// klein oder gemischt -> Eingabe unveraendert. Werte ohne Buchstaben (Datum, Uhrzeit) sind
// von der Entscheidung ausgenommen.
function matchCase(sample, value) {
  const s = String(sample || "");
  if (!/[a-zäöüß]/i.test(s)) return value;
  return s === s.toUpperCase() ? String(value).toUpperCase() : value;
}

// Gleiche Rueckgabeform wie slotsFor: { token, value, hint? }. Dadurch erben fill/drop und
// die Leerfeld-Regel automatisch — es gibt nur EINE Entfern-Logik im Prompt-Bau.
// token ist hier der im Bild sichtbare Beispieltext statt des Platzhalterworts.
function slotsFromSampleMap(sm, vals) {
  const HINT = {
    headline: "match the exact letterforms and font style of the existing text, especially for script or decorative fonts",
    location: "keep the existing spaced-out style and any decorative lines around it",
  };
  const slots = [];
  for (const key of Object.keys(sm)) {
    const sample = sm[key];
    if (!sample) continue;                      // Feld kommt im Template-Bild nicht vor
    const raw = vals[key] || "";
    const slot = { token: sample, value: raw ? matchCase(sample, raw) : "" };
    if (HINT[key]) slot.hint = HINT[key];
    slots.push(slot);
  }
  return slots;
}

// sampleMap (optional): die Zuordnungstabelle des Templates. Fehlt sie, laeuft der
// unveraenderte Platzhalter-Pfad.
function buildPrompt(rawEvent, sampleMap) {
  const ev = rawEvent || {};
  // Every value is used with the casing it arrives in. The uppercase policy for
  // the always-caps slots (HEADLINE + WEBSITE) is applied per template upstream
  // in the generation flow (see lib/templates.uppercaseFor); script templates
  // keep mixed case so the cursive/decorative font is preserved.
  const headline = clean(ev.name);
  const subline  = clean(ev.prefix);
  const dateRaw  = clean(ev.date);
  const time     = timeValue(ev.time); // HH:MM -> "HH:MMh" (Bauteil 6), sonst unveraendert
  const website  = clean(ev.contact);
  const club     = clean(ev.club);
  const location = clean(ev.location);
  // Date in the placeholder's own shape, e.g. "15.08.26" (2-digit year, no
  // weekday). ev.day is still sent by the form but deliberately unused here.
  const dateValue = shortYear(dateRaw);
  // Artist names exactly as typed (prefixes kept as given, none added).
  const djs = clean(ev.dj).split(",").map((d) => d.trim()).filter(Boolean);

  // Nur im Beispieltext-Pfad benutzt: dort fuehrt das Template den Wochentag als eigenes
  // sichtbares Feld. Im Platzhalter-Pfad bleibt ev.day wie bisher unbenutzt.
  const weekday = clean(ev.day);
  const sm = (sampleMap && typeof sampleMap === "object" && Object.keys(sampleMap).length) ? sampleMap : null;

  const slots = sm
    ? slotsFromSampleMap(sm, { headline, subline, weekday, date: dateValue, time,
        dj1: djs[0] || "", dj2: djs[1] || "", dj3: djs[2] || "", club, location, website })
    : slotsFor({ headline, subline, dateValue, time, djs, club, location, website });
  const fill = slots.filter((s) => s.value);
  const drop = slots.filter((s) => !s.value);

  const lines = [
    "Edit this event flyer. Keep ALL visual elements exactly the same: the background, " +
      "photos, textures, colors, graphic elements, decorations and layout. Only the text changes.",
    "",
    sm
      ? "Replace each of these existing texts with its new value. The words on the left are the " +
        "text exactly as it currently appears on the flyer:"
      : "Replace each of these placeholders with its new value. The word on the left is the " +
        "placeholder exactly as it appears on the flyer:",
  ];
  for (const s of fill) lines.push(`- ${s.token} → "${s.value}"` + (s.hint ? ` (${s.hint})` : ""));

  if (drop.length) {
    lines.push(
      "",
      sm
        ? "These texts have NO value for this event. Remove them completely:"
        : "These placeholders have NO value for this event. Remove them completely:",
    );
    for (const s of drop) lines.push(`- ${s.token}` + (s.note ? ` ${s.note}` : ""));
    lines.push(
      "Delete their text and blend the area seamlessly into the surrounding background: no " +
        "leftover text, no empty gap, no box, no faint outline, no ghost trace.",
    );
  }

  lines.push(
    "",
    // Die zwei Platzhalter-Saetze sprechen vom Platzhalter-Vokabular und haben im
    // Beispieltext-Pfad keinen Gegenstand; dort steht die gleichwertige Rest-Regel.
    ...(sm
      ? ["No part of the old text may stay visible next to its replacement: once a text " +
         "is replaced, only the new value appears in its place."]
      : ["If a slot on this template is labelled slightly differently (for example CLUB NAME with " +
         "a space, or WWW.WEBSITE.DE), it is the same slot and the same rule applies.",
         "No placeholder word may stay visible as a label next to its own value: once a placeholder " +
         "is replaced, only the new value appears in its place."]),
    "",
    "Keep the exact same font styles, sizes, colors, casing and positions as the " +
      "original. Only the words change. The result must look 99% identical to the " +
      "original template.",
    sm
      ? "Each replacement keeps the size, position and line count of the text it " +
        "replaces. Do not add lines, labels or words that were not in the template."
      : "Each replacement keeps the size, position and line count of the placeholder it " +
        "replaces. Do not add lines, labels or words that were not in the template.",
    "Use each artist name exactly as given, do not add any prefix or label that is " +
      "not part of the name.",
    "Spelling is critical: render every replaced text exactly and completely as given " +
      "— especially the main title — every single letter present, correct spelling, no " +
      "missing, dropped or swapped letters (spell each word in full, e.g. TATTOOS, never TATTO)."
  );

  return lines.join("\n");
}

// Ersetzungsplan fuer die Vorschau (Bauteil 4): was wird wodurch ersetzt, was entfernt.
// Reine Ableitung aus denselben slots wie der Prompt — die Vorschau kann also nicht von
// dem abweichen, was der Lauf spaeter baut. Kostet nichts, kein Modellaufruf.
function samplePlan(rawEvent, sampleMap) {
  const ev = rawEvent || {};
  const sm = (sampleMap && typeof sampleMap === "object" && Object.keys(sampleMap).length) ? sampleMap : null;
  if (!sm) return null;
  const djs = clean(ev.dj).split(",").map((d) => d.trim()).filter(Boolean);
  const vals = {
    headline: clean(ev.name), subline: clean(ev.prefix), weekday: clean(ev.day),
    date: shortYear(clean(ev.date)), time: timeValue(ev.time),
    dj1: djs[0] || "", dj2: djs[1] || "", dj3: djs[2] || "",
    club: clean(ev.club), location: clean(ev.location), website: clean(ev.contact),
  };
  const ersetzt = [], entfernt = [];
  for (const key of Object.keys(sm)) {
    const sample = sm[key];
    if (!sample) continue;
    const raw = vals[key] || "";
    if (raw) ersetzt.push({ feld: key, von: sample, zu: matchCase(sample, raw) });
    else entfernt.push({ feld: key, von: sample });
  }
  return { ersetzt, entfernt };
}

module.exports = { buildPrompt, samplePlan };
