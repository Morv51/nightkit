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

// Datum kompakt "19.06.26" (die vierstellige Jahreszahl kippte oft in eine ueberdimensionierte,
// mehrzeilig gestapelte Fassung; die kurze Form bleibt eher einzeilig). Gilt fuer ALLE Modi.
const P_PLACEHOLDERS =
  "Replace the texts with these placeholders, each rendered exactly as written, kept as placeholders (not real values): HEADLINE, SUBLINE, 19.06.26, UHRZEIT, LOCATION, DJ NAME 1, DJ NAME 2, DJ NAME 3, CLUBNAME, www.website.com";

// Typografie + grafische Traeger: EIN Absatz, in zwei Teile zerlegt, damit der VARIANTEN-Zusatz
// (Punkt 2, Datum/Location expressiver) exakt nach dem Headline-Satz sitzt. Traeger NUR an
// EINZEILIGE, immer vorhandene Felder — der DJ-Block hat variable Zeilenzahl, ein fuer drei Zeilen
// gezeichnetes Tape bekaeme bei nur zwei DJs eine leere Zeile. "drawn from the artwork's own world"
// haelt die Elemente stilkonform. Headline gerade (kein schraeger Titel).
const P_TYPO_A =
  "Set the TEXT with real typographic craft: a strong dominant headline, deliberate size hierarchy between the " +
  "groups, clean letter-spacing and alignment, generous spacing — like a professional designer set the type, " +
  "never a flat even list. Keep the headline straight and horizontal, never tilted or rotated.";
const P_TYPO_DEVICES =
  "Where it helps, let a SINGLE-LINE text field sit on a small graphic device drawn from the artwork's own " +
  "world, e.g. a strip of tape, a tag or a rule. Never put the DJ line-up or any other multi-line group on such " +
  "a device. Use this sparingly, for one or two fields at most.";
// Nachbau + gemeinsame Basis (zeichengleich zur bisherigen P_TYPO).
const P_TYPO = P_TYPO_A + " " + P_TYPO_DEVICES;
// Punkt 2 — NUR Variante: Datum/Location duerfen expressiver (grosse Ziffern, vertikaler Satz),
// die Headline bleibt gerade. Im Nachbau widerspraeche das dem "exact same composition", darum
// steht es NICHT im gemeinsamen Teil, sondern nur im Varianten-Typo, direkt nach dem Headline-Satz.
const P_TYPO_DATE_LOC =
  "The date and location may be treated more expressively than the rest, including oversized numerals or a " +
  "vertical setting, as long as the headline itself stays straight and horizontal.";
const P_TYPO_VARIANT = [P_TYPO_A, P_TYPO_DATE_LOC, P_TYPO_DEVICES].join(" ");

// Format (9:16) + Logo-Entfernung getrennt: Artwork (Foto ohne Vorlage) hat keine Logos zu
// entfernen, nutzt darum nur den 9:16-Teil. Nachbau/Variante nutzen beide (= bisherige P_FORMAT).
const P_FORMAT_9x16 =
  "Format exactly 9:16 vertical. If the original has a different ratio, extend the design naturally to fill 9:16, matching the background with no visible seams.";
const P_FORMAT_LOGO =
  "Remove all club logos and emblems, blending the area cleanly into the background; render CLUBNAME as plain text only.";
const P_FORMAT = P_FORMAT_9x16 + " " + P_FORMAT_LOGO;

const P_LITERAL =
  "Render every placeholder word literally as written. Never turn UHRZEIT into a clock time, LOCATION into a " +
  "venue, or the DJ slots into real names; keep the date exactly as 19.06.26. The placeholders are the ONLY " +
  "text on the flyer. Do not add any other words, labels or captions, not even on graphic devices.";

// Nachbau-Prompt. P_COMPOSITION (gemeinsam) sitzt nach dem KEEP-Kern.
const CLEAN_PROMPT = [P_INTRO, P_KEEP_NACHBAU, P_COMPOSITION, P_PLACEHOLDERS, P_TYPO, P_FORMAT, P_LITERAL].join("\n\n");

// Absatz 2, Variante: fester Text, NICHTS wird beschrieben ("whatever they are"), damit nichts
// benannt und damit nichts erfunden oder vergessen wird. Das Bildmodell sieht das Original ueber
// editImage. Der EINZIGE austauschbare Satz ist der Motiv-Satz: der Nutzer waehlt im UI, ob der
// Flyer ein Hauptmotiv hat. Das ist eine bewusste Entscheidung, KEINE bedingte "if it has one"-
// Formulierung (die verlagerte die oft mehrdeutige Entscheidung ins Modell und liess es bei
// motivlosen Flyern eins erfinden, meist eine Person, was den Stil kippte).
const VARIANT_HEAD =
  "This is a VARIATION in a matching design family. Keep the original's style, mood, energy, fonts, " +
  "typographic treatment and its structural design elements, whatever they are. Change the colour world as " +
  "specified below.";
// Mit Hauptmotiv (Voreinstellung): das Motiv darf ausgetauscht werden.
const SUBJECT_WITH =
  "Replace the main subject with a different one in the same spirit.";
// Ohne Hauptmotiv: KEIN Motiv erfinden, Charakter/Textur/Struktur erhalten, die Farbwelt traegt.
const SUBJECT_WITHOUT =
  "This artwork has no single hero subject. Do NOT introduce one, no person, no face, no central figure. Keep " +
  "its own character, its textures, structure and graphic language, and let the new colour world carry the change.";
const VARIANT_TAIL =
  "Recompose in a fresh, balanced, art-directed way, do not copy the original placement one to one.";

// spec.subject !== false -> Mit Hauptmotiv (Default). spec.subject === false -> Ohne Hauptmotiv.
function keepVariant(spec) {
  const s = spec || {};
  const subjectLine = s.subject === false ? SUBJECT_WITHOUT : SUBJECT_WITH;
  const keep = [VARIANT_HEAD, subjectLine, VARIANT_TAIL].join(" ");
  const cw = v(s.color_world);
  return cw ? keep + "\n- Colour world: " + cw : keep;
}

// Varianten-Bildprompt: Nachbau-Geruest, KEEP-Kern ersetzt + Varianten-Typo (mit Punkt 2).
// spec: { color_world, subject }.
function buildCleanVariantPrompt(spec) {
  return [P_INTRO, keepVariant(spec), P_COMPOSITION, P_PLACEHOLDERS, P_TYPO_VARIANT, P_FORMAT, P_LITERAL].join("\n\n");
}

// ── ARTWORK-Modus: Eingabe ist ein reines FOTO (kein Flyer), daraus wird ein Flyer gebaut. ──
// WEGGELASSEN ggue. Nachbau/Variante: Stil-/Font-/Struktur-Erhalt, Recompose-Zeile, Logo-Entfernung
// (P_FORMAT_LOGO) — die laufen beim Foto ins Leere. BEIBEHALTEN: Platzhalter, Kompositions-Absatz,
// Typo-Absatz (Traeger + gerade Headline), 9:16, Literal-Sperre. Kein "Rebuild this flyer" (das
// Foto IST kein Flyer); stattdessen ein kurzer Template-Rahmen. Farbwelt ist hier PFLICHT.
const ARTWORK_INTRO =
  "This is a fillable event-flyer template, every text stays a placeholder.";
const ARTWORK_KEEP =
  "Use the attached photo as the artwork for a club event flyer. Act like a designer building a poster from a " +
  "supplied image: crop, scale and place the photo as the composition needs, add graphic elements where they " +
  "serve it. Do not just place text on the picture. Introduce the colour world below as accents against the photo.";
// Nur im Artwork-Pfad: DJ-Lineup als Set-Piece (durchnummeriert + duenne Trennlinien).
const P_TYPO_DJ_NUMBERED =
  "The DJ line-up may be numbered (01, 02, 03) and separated by thin rules, so it reads as a set piece rather than a list.";
const P_TYPO_ARTWORK = P_TYPO + " " + P_TYPO_DJ_NUMBERED;

// Artwork-Bildprompt. spec: { color_world } (PFLICHT). Ohne Farbwelt bleibt der Prompt bewusst
// ohne die "- Colour world:"-Zeile (der Aufrufer filtert Specs ohne Farbwelt ohnehin heraus).
function buildCleanArtworkPrompt(spec) {
  const cw = v((spec || {}).color_world);
  const keep = cw ? ARTWORK_KEEP + "\n- Colour world: " + cw : ARTWORK_KEEP;
  return [ARTWORK_INTRO, keep, P_COMPOSITION, P_PLACEHOLDERS, P_TYPO_ARTWORK, P_FORMAT_9x16, P_LITERAL].join("\n\n");
}

module.exports = { CLEAN_PROMPT, buildCleanVariantPrompt, buildCleanArtworkPrompt };
