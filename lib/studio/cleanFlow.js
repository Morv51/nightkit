"use strict";

// Clean-Flow: ein KURZER, freier Bildprompt fuer gpt-image (editImage, Original als Eingabe).
// Bewusst eigenstaendig — erbt NICHTS von den Auto-Flows, dem Handpfad, dem Regelwerk oder der
// Textzonen-Erkennung. Das Modell ordnet die Platzhalter selbst frei zu; genau das ist gewollt.
//
// GRUNDPRINZIP (nicht verhandelbar): der Prompt bleibt so KURZ wie moeglich. gpt-image verliert
// bei zu langen Prompts die Faehigkeit, allen Anweisungen zu folgen, und die Komposition leidet
// (genau das Problem des langen Regelwerk-Prompts). Wird hier je etwas ergaenzt, immer pruefen,
// ob dafuer etwas gekuerzt werden kann. Im Zweifel weglassen.
//
// LAENGE: Fuer NACHBAU und VARIANTE ist der Nachbau-Prompt die Referenzlaenge und sollte nicht
// deutlich ueberschritten werden. Fuer ARTWORK gilt das NICHT — dort ist der Prompt kein kurzer
// Brief mehr, sondern ein REGIE-GERUEST, in das die Sonnet-Regie eingesetzt wird. Die erprobte
// Laenge liegt dort bei 2000 bis 2800 Zeichen. Kuerze zaehlt auch da weiter, aber gemessen am
// REGELANTEIL, nicht an der Zeichenzahl: eine Regel, die im Ergebnis nichts bewirkt, fliegt raus
// (so ist "Dense in one area, close to empty in another" gegangen). Zeichen allein sind kein Mass.
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

// ── ARTWORK-Modus: Eingabe ist ein reines FOTO (kein Flyer), daraus wird ein Poster gebaut. ──
// Der Bildprompt ist hier ein GERUEST, in das die Sonnet-REGIE eingesetzt wird (vision.js,
// cleanArtworkSpecs: family/staging/headline_style/place_*/palette/style). ZWEI Gerueste, die
// Wahl trifft Sonnet ueber das Feld family: "surface" -> Geruest B (Foto ohne Motiv, die Headline
// IST das Motiv), alles andere -> Geruest A. Fehlendes/unbekanntes family faellt bewusst auf A.
//
// P_PLACEHOLDERS wird hier NICHT mehr angehaengt: die Gerueste nennen jeden Platzhalter in ihren
// Platzierungszeilen selbst. Ebenso ersetzt P_LITERAL_ARTWORK das gemeinsame P_LITERAL. Beide
// gemeinsamen Konstanten bleiben fuer Nachbau/Variante UNVERAENDERT.
//
// FEHLENDE REGIE-FELDER: ein fehlendes Feld darf die Regie verschlechtern, aber NIE
// Eventinformation vom Plakat nehmen. Darum faellt jeweils nur die Positionsangabe weg, und die
// drei Saetze, die ein Feld mit einer festen Regel teilten, sind aufgetrennt — die Regel
// ueberlebt ohne ihr Feld.
// Platzierungszeile: die Platzhalter-Namen stehen IMMER, die Position nur wenn geliefert, die
// feste Regel haengt sich passend an. So nimmt ein fehlendes Regie-Feld nie Eventinformation vom
// Plakat, es verschlechtert nur die Regie.
function place(names, pos, rule) {
  const p = v(pos), r = v(rule);
  let out = names;
  if (p) out += ": " + p;
  if (r) out += (p ? ", " : ": ") + r;
  return out;
}

// Nur fuer Artwork: ohne den Satz "The placeholders are the ONLY text on the flyer" — der
// widerspraeche der erlaubten Wortliste. P_LITERAL bleibt Nachbau/Variante vorbehalten.
const P_LITERAL_ARTWORK =
  "Render every placeholder word literally as written. Never turn UHRZEIT into a clock time, LOCATION into a " +
  "venue, or the DJ slots into real names; keep the date exactly as 19.06.26.";

const WORDLIST =
  "Besides the placeholders, the only words allowed are: PRESENTS, LIVE, NIGHT, SOUND, ADMIT ONE.";
const NOTHING_ELSE =
  "Nothing else: no times, no prices, no names, no venues, no edition numbers, no invented headlines.";

// ── GERUEST A: family = subject. Das Foto hat ein Motiv, das freigestellt und inszeniert wird. ──
function artworkSubject(r) {
  const staging = v(r.staging), hs = v(r.headline_style), style = v(r.style), palette = v(r.palette);
  return [
    "Build a club poster from the attached photo. Treat it as raw collage material, not as a background.",
    staging ? "Staging: " + staging : "",
    "The headline is by far the largest element and runs in one horizontal line. It stays complete and fully " +
      "readable: the subject may touch it but never covers more than the outer edge of its last letter.",
    // aufgetrennt: die Regel zur ruhigen Sans ueberlebt ein fehlendes headline_style
    [hs ? "Typography: the headline is " + hs + " and carries all the character." : "",
      "Everything else is set in a quiet neutral sans, light weight, uppercase, with wide letter-spacing, " +
      "always small. Never set the small groups in the display face."].filter(Boolean).join(" "),
    "Four size steps, each clearly smaller than the one before: headline, then the DJ names and CLUBNAME, then " +
      "LOCATION and the website, then the graphic layer.",
    "The four groups are never set alike. No group floats in open space: every one is anchored to an edge, a " +
      "bar or a rule.",
    ["Place each group as one unit:",
      place("HEADLINE with SUBLINE", r.place_headline),
      place("19.06.26 with UHRZEIT", r.place_date),
      place("DJ NAME 1, DJ NAME 2, DJ NAME 3", r.place_lineup,
        "all three at exactly the same size and weight, no numbers"),
      place("CLUBNAME", r.place_club, "one single line"),
      "LOCATION and www.website.com: directly under CLUBNAME, one step smaller"].join("\n"),
    "A carrier holds one single line only. Multi-line groups sit directly on the artwork. Every carrier stays " +
      "small and never becomes a second focal point.",
    "Build a secondary layer of print furniture: registration crosses, corner ticks, hairline rules, small " +
      "solid bars, arrows, asterisks, dot grids. It lives in the calm areas, never on top of busy photographic " +
      "detail. Every mark is crisp and sharp, never soft or blurred. It does not avoid the text: each group is " +
      "built into it, framed by rules, brackets or a bar. Always a clear step smaller than the smallest " +
      "placeholder.",
    "The poster has no frame, no border, no cut-out or perforated outline. Colour fields bleed to every edge " +
      "they touch.",
    WORDLIST + " Set them at the size of the graphic layer. " + NOTHING_ELSE,
    // aufgetrennt: die Korn-Regel ueberlebt ein fehlendes style
    [palette ? "Palette: " + palette : "",
      [style ? "Style: " + style + "." : "",
        "Grain and print texture sit on the photograph only. All graphic marks and type stay clean and sharp."
      ].filter(Boolean).join(" ")].filter(Boolean).join("\n"),
  ].filter(Boolean).join("\n\n");
}

// ── GERUEST B: family = surface. Kein Motiv im Foto -> die Headline IST das Motiv. Die Felder
// place_date/place_lineup/place_club werden hier bewusst NICHT verwendet: B setzt den Rest in
// zwei feste Cluster. ──
function artworkSurface(r) {
  const staging = v(r.staging), hs = v(r.headline_style), style = v(r.style), palette = v(r.palette);
  const ph = v(r.place_headline);
  return [
    "Build a club poster from the attached photo. Treat the photo as the surface of the poster, not as a " +
      "background to be covered.",
    // aufgetrennt: die Leuchtkraft-Regel ueberlebt ein fehlendes staging
    [staging ? "Staging: " + staging + "." : "",
      "The photo keeps its full luminosity and saturation."].filter(Boolean).join(" "),
    // "HEADLINE" steht hier woertlich, damit auch in B jeder Platzhalter einmal als Token vorkommt
    ["This photograph has no subject, so the headline is the subject of the poster. Draw the word HEADLINE as " +
      "a wordmark: a compact mass of two or three stacked lines with tight leading, the lines sized so their " +
      "outer edges form one clear silhouette.",
      ph ? ph + "." : "",
      "It reads as a designed mark, not as a font applied to a word. Fully readable, no swashes crossing the " +
      "word."].filter(Boolean).join(" "),
    hs ? "Letterforms: " + hs + "." : "",
    "Everything else is tiny against it, set in a quiet neutral sans, light weight, uppercase, with wide " +
      "letter-spacing.",
    ["Place the remaining text in two small tight clusters, away from the wordmark and close to the edges, so " +
      "most of the poster stays open:",
      "SUBLINE with 19.06.26 and UHRZEIT as one cluster.",
      "DJ NAME 1, DJ NAME 2, DJ NAME 3, CLUBNAME, LOCATION and www.website.com as the other. The three DJ " +
      "names sit at exactly the same size and weight, no numbers. CLUBNAME is one step larger than LOCATION " +
      "and the website."].join("\n"),
    "The poster has no solid blocks, no filled bars, no panels behind text, no frame.",
    "Keep the secondary layer very sparse: three or four thin white marks in total, outlined only, never filled.",
    WORDLIST + " Use at most one. " + NOTHING_ELSE,
    [palette ? "Palette: " + palette : "", style ? "Style: " + style : ""].filter(Boolean).join("\n"),
  ].filter(Boolean).join("\n\n");
}

// Artwork-Bildprompt. spec = die Regie aus vision.cleanArtworkSpecs. PFLICHT ist nur palette
// (der Aufrufer filtert Eintraege ohne sie); jedes andere Feld darf fehlen.
function buildCleanArtworkPrompt(spec) {
  const r = spec || {};
  const body = v(r.family).toLowerCase() === "surface" ? artworkSurface(r) : artworkSubject(r);
  return [body, P_FORMAT_9x16, P_LITERAL_ARTWORK].filter(Boolean).join("\n\n");
}

// ── REDESIGN-Modus: Eingabe ist ein FERTIGES Template aus dem Bestand. MOTIV und FARBWELT
// bleiben, alles andere darf neu inszeniert werden (Beschnitt + fotografische Vertiefung des
// Grundes ueber {staging}). Der Wortlaut folgt dem letzten Handtest-Stand (Marmor-Lauf); die
// bildspezifischen Stellen jenes Laufs sind hier die Sonnet-Felder.
//
// Zwei bewusste Abweichungen von Artwork:
//   • Format als KURZE Zeile "Format exactly 9:16 vertical." statt P_FORMAT_9x16 — dessen
//     Erweiterungs-Satz ("extend the design naturally to fill 9:16") passt hier nicht.
//   • P_LITERAL_ARTWORK, WORDLIST und NOTHING_ELSE werden mit Artwork GETEILT und deshalb NICHT
//     angefasst. Die abweichende Wortzahl-Regel ("genau zwei") steht als eigener Satz dazwischen,
//     damit die Artwork-Prompts zeichengleich bleiben.
//
// FEHLENDE FELDER verschlechtern die Regie, nehmen aber nie Eventinformation: Platzhalter-Namen
// und feste Regeln stehen immer, es faellt nur die Positionsangabe weg (place()). Zwei Felder
// sind ausdruecklich optional: ohne headline_material ist die Headline flach einfarbig, ohne
// colour_field gibt es keine Flaeche.
const P_FORMAT_9x16_KURZ = "Format exactly 9:16 vertical.";

function buildCleanRedesignPrompt(spec) {
  const r = spec || {};
  const staging = v(r.staging), hs = v(r.headline_style), material = v(r.headline_material);
  const sec = v(r.secondary_style), treatment = v(r.treatment), ornament = v(r.ornament);
  const carriers = v(r.carriers), field = v(r.colour_field);
  const ph = v(r.place_headline);

  return [
    "Rebuild this club poster as one composition. Keep the subject and the colour world, everything else " +
      "may be restaged.",
    staging ? staging : "",
    // Headline. Ohne Material: flach einfarbig. Mit Material: Objekt der Szene, verschraenkt mit
    // dem Motiv — die Verschraenkung gehoert AUSDRUECKLICH zum Material-Fall.
    ["The headline is huge, runs in one line and is set tight so the letters almost touch." +
      (ph ? " It sits " + ph + "." : "") +
      " It ends inside the format and is never cut off by the edge. Every letter stays clearly readable.",
      // Beide Zweige nennen das Token HEADLINE woertlich. Genau einer greift immer, damit der
      // Platzhalter auch ohne Material im Prompt steht (sonst erfindet das Modell eine Schlagzeile).
      material
        ? "It is not flat type: the word HEADLINE is an object inside the scene, its letters cut from " +
          material + ", subtle bevelled edges, soft top light, gentle shadows inside the letterforms, a " +
          "faint cool shading on the left sides."
        : "The word HEADLINE is solid, one flat colour.",
      "The subject stands in front of it and covers at most two letters.",
      // Die Verschraenkung gilt in BEIDEN Zweigen: im Handtest trug sie auch die flache Fassung.
      // Sie haengt also nicht mehr am Material.
      "The subject and the word interlock: parts of the subject pass in front of single letter stems, " +
        "while the letters reappear behind it, so the word is woven into the scene, not printed over it.",
    ].filter(Boolean).join(" "),
    "Hierarchy: the headline rules the poster. The DJ names are its second voice, strong and present. " +
      "Everything else stays small.",
    // Gruppen. Die Datumszeile steht bewusst AUSSERHALB von place(): der Dreierstapel passt nicht
    // in das Namen-Position-Regel-Muster. "each with its digit" ist der Fix aus dem Handtest —
    // der alte Wortlaut "no numbers" hat die Ziffern aus den Platzhaltern geloescht.
    ["The groups:",
      "19.06.26" + (v(r.place_date) ? " sits " + v(r.place_date) + "," : "") +
        " split into three stacked parts, 19 above 06 above 26, set heavy, tight leading, a thin vertical " +
        "rule at its left, UHRZEIT tiny at its foot.",
      place("DJ NAME 1, DJ NAME 2, DJ NAME 3", r.place_lineup,
        "stacked tight, all three the same size and weight, each rendered with its own digit; never add " +
        "index numbers such as 01 in front of them"),
      place("CLUBNAME with LOCATION and www.website.com", r.place_club,
        "one small block, set light with wide letter-spacing"),
      "SUBLINE is flush to the end of the headline, joined by a hairline.",
    ].join("\n"),
    treatment ? "Treatment of the groups: " + treatment + "." : "",
    // Traeger und Farbflaeche sind beide optional. Der "nichts liegt unter dem Text"-Satz gilt nur,
    // wenn WEDER Traeger NOCH Flaeche gefordert sind — sonst widerspraeche er ihnen.
    field ? "One colour field: " + field + ". Straight edges, anchored in one corner." : "",
    carriers ? "Carriers: " + carriers + ". A carrier holds one single line only, stays small and never " +
      "becomes a second focal point." : "",
    (!field && !carriers)
      ? "No colour field, no panel, no bar anywhere. Every text sits directly on the photograph." : "",
    // Zwei Schriftkategorien: Charakter in der Headline, secondary_style fuer alles andere.
    [hs ? "The headline face is " + hs + "." : "",
      sec ? "Everything else is set in " + sec + ", the weight changing between the groups." : "",
      "The small texts must never look like a default system font: wide letter-spacing, real weight " +
      "contrast between the groups, sizes large enough to read as design, not as captions.",
    ].filter(Boolean).join(" "),
    "Ornaments from the world of this picture" + (ornament ? ": " + ornament : "") + ". At least eight " +
      "marks in total, always smaller than the smallest placeholder, in the calm zones.",
    "The poster has no frame, no border, no cut-out or perforated outline. Do not invent any marks, glyphs " +
      "or lettering along the edges.",
    WORDLIST + " Exactly two of them appear, far apart. " + NOTHING_ELSE,
    P_FORMAT_9x16_KURZ,
    P_LITERAL_ARTWORK,
  ].filter(Boolean).join("\n\n");
}

module.exports = { CLEAN_PROMPT, buildCleanVariantPrompt, buildCleanArtworkPrompt, buildCleanRedesignPrompt };
