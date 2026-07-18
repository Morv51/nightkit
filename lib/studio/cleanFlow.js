"use strict";

// Clean-Flow: ein KURZER, freier Bildprompt fuer gpt-image (editImage, Original als Eingabe).
// Bewusst eigenstaendig — erbt NICHTS von den Auto-Flows, dem Handpfad, dem Regelwerk oder der
// Textzonen-Erkennung. Das Modell ordnet die Platzhalter selbst frei zu; genau das ist gewollt.
//
// GRUNDPRINZIP (nicht verhandelbar): der Prompt bleibt so KURZ wie moeglich. gpt-image verliert
// bei zu langen Prompts die Faehigkeit, allen Anweisungen zu folgen, und die Komposition leidet
// (genau das Problem des langen Regelwerk-Prompts). Wird hier je etwas ergaenzt, immer pruefen,
// ob dafuer etwas gekuerzt werden kann. Im Zweifel weglassen. Der Nachbau-Prompt ist die
// Referenzlaenge und sollte nicht deutlich ueberschritten werden.
//
// Aufbau in ABSAETZEN, damit Nachbau UND Variante dieselben Teile teilen. Nur Absatz 2 (KEEP)
// unterscheidet sich: der Nachbau haelt Farbe/Komposition fest, die Variante tauscht genau diesen
// einen Satz gegen die Varianten-Formulierung und haengt die drei Sonnet-Vorgaben an. Sonst
// nichts. So bleibt der Varianten-Prompt so kurz wie der Nachbau und widerspruchsfrei.

const v = (x) => (typeof x === "string" ? x.trim() : "");

const P_INTRO =
  "Rebuild this flyer as a reusable event-flyer template. This is a fillable template, every text stays a placeholder.";

// KEEP, Nachbau: NUR der modus-spezifische Kern (exakt gleiches Design/Farbe/Komposition).
// Motiv-Schutz und Komposition stehen jetzt im gemeinsamen P_COMPOSITION (siehe unten).
const P_KEEP_NACHBAU =
  "Keep the exact same design, style, fonts, colours and composition as the original.";

// GEMEINSAM (Nachbau UND Variante): Motiv-Schutz + verteilte, verwobene Komposition. Traegt die
// zwei entscheidenden Anti-Spalten-Saetze aus dem urspruenglich getesteten guten Prompt
// ("interlock as one artwork, not elements placed in a grid" / "grouped ... never stamped on
// top") und schluckt dabei den schwaecheren alten Kompositions-Satz ("form ONE composition"),
// damit der Prompt nicht laenger wird als noetig.
const P_COMPOSITION =
  "Keep the main subject and all graphic elements whole and never covered by text. Compose at designer level: the graphics and the subject interlock as one artwork, not elements placed in a grid. Place the text into the free zones so it feels composed with the artwork, grouped thoughtfully, never stamped on top.";

const P_PLACEHOLDERS =
  "Replace the texts with these placeholders, each rendered exactly as written, kept as placeholders (not real values): HEADLINE, SUBLINE, 19.06.2026, UHRZEIT, LOCATION, DJ NAME 1, DJ NAME 2, DJ NAME 3, CLUBNAME, www.website.com";

const P_TYPO =
  "Set the TEXT with real typographic craft: a strong dominant headline, deliberate size hierarchy between the groups, clean letter-spacing and alignment, generous spacing — like a professional designer set the type, never a flat even list.";

const P_FORMAT =
  "Format exactly 9:16 vertical. If the original has a different ratio, extend the design naturally to fill 9:16, matching the background with no visible seams. Remove all club logos and emblems, blending the area cleanly into the background; render CLUBNAME as plain text only.";

const P_LITERAL =
  "Render every placeholder word literally as written. Never turn UHRZEIT into a clock time, LOCATION into a venue, or the DJ slots into real names.";

// Nachbau-Prompt. P_COMPOSITION (gemeinsam) sitzt nach dem KEEP-Kern.
const CLEAN_PROMPT = [P_INTRO, P_KEEP_NACHBAU, P_COMPOSITION, P_PLACEHOLDERS, P_TYPO, P_FORMAT, P_LITERAL].join("\n\n");

// Absatz 2, Variante: RADIKAL vereinfacht. Fester Text, NICHTS wird beschrieben ("whatever they
// are"), damit nichts benannt und damit nichts erfunden oder vergessen wird. Das Bildmodell sieht
// das Original ueber editImage. Einzige variable Zeile: die Farbwelt. "the main subject" statt
// "person", damit es auch bei Flyern ohne Person funktioniert.
const VARIANT_KEEP =
  "This is a VARIATION in a matching design family. Keep the original's style, mood, energy, fonts, " +
  "typographic treatment and its structural design elements, whatever they are. Change the colour world as " +
  "specified below and replace the main subject with a different one in the same spirit. Recompose in a fresh, " +
  "balanced, art-directed way, do not copy the original placement one to one.";

function keepVariant(spec) {
  const cw = v((spec || {}).color_world);
  return cw ? VARIANT_KEEP + "\n- Colour world: " + cw : VARIANT_KEEP;
}

// Varianten-Bildprompt: Nachbau-Geruest, nur der KEEP-Kern ersetzt. spec: { color_world }.
function buildCleanVariantPrompt(spec) {
  return [P_INTRO, keepVariant(spec), P_COMPOSITION, P_PLACEHOLDERS, P_TYPO, P_FORMAT, P_LITERAL].join("\n\n");
}

module.exports = { CLEAN_PROMPT, buildCleanVariantPrompt };
