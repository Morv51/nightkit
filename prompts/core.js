"use strict";

// Redesign v2, Bauteil 1: der zentrale Prompt-Kern.
//
// buildCorePrompt({fields, familyText, layoutCardText, mediumCardText, opening}) baut den
// vollstaendigen Bildprompt aus dem EINGEFRORENEN statischen Kern-Text mit fuenf Einsatzstellen:
//   opening         -> [OPENING]   'redesign' setzt den Verwerfungs-Absatz (Artwork folgt spaeter)
//   fields          -> [PLATZHALTER-LISTE] und die feld-getriebenen Gruppen-Saetze (Bauteil 1b)
//   familyText      -> [FAMILIE]    ganzer Absatz; leer -> Slot faellt ersatzlos weg
//   layoutCardText  -> [KARTE]      Layout-Karten-Absatz (Bauteil 2)
//   mediumCardText  -> [MEDIUM]     Medium-Satz im Typo-Absatz
//
// EINGEFROREN: der statische Textanteil (staticCoreText -> Kern-Hash). Aenderungen daran nur als
// beauftragte Diffs. Karten/Familie/Feld-Auswahl sind Eingaben, kein Teil des statischen Textes.

const v = (x) => (typeof x === "string" ? x.trim() : "");

// Feld-Reihenfolge fest: Headline, Subline, Datum, Uhrzeit, DJ 1-3, Clubname, Location, Website.
const FIELD_KEYS = ["headline", "subline", "date", "time", "dj", "club", "location", "website"];
const FULL_REDESIGN_FIELDS = FIELD_KEYS.reduce((o, k) => ((o[k] = true), o), {});

function normFields(fields) {
  const f = {};
  for (const k of FIELD_KEYS) f[k] = !!(fields && fields[k]);
  return f;
}

// [PLATZHALTER-LISTE]: nur vorhandene Felder, feste Reihenfolge, exakte Template-Schreibweise.
function placeholderList(f) {
  const out = [];
  if (f.headline) out.push("HEADLINE");
  if (f.subline) out.push("SUBLINE");
  if (f.date) out.push("19.06.26");
  if (f.time) out.push("UHRZEIT");
  if (f.dj) out.push("DJ NAME 1", "DJ NAME 2", "DJ NAME 3");
  if (f.club) out.push("CLUBNAME");
  if (f.location) out.push("LOCATION");
  if (f.website) out.push("www.website.com");
  return out.join(", ");
}

// ── Der eingefrorene statische Text, in Absaetzen. www.website.com bleibt SCHLICHT (kein
//    Markdown-Link), wie in allen Bildprompts dieses Projekts. ──

const OPEN_1 =
  "This image is an old flyer. Its layout is discarded: ignore every text, every graphic element and " +
  "every placement you see on it, none of it is a suggestion for your design. Keep only the photograph " +
  "inside it as your raw material. Design from it a completely new printed 9:16 poster advertising a club " +
  "event, the kind of poster that gets printed large and hung up, and that people would keep because it " +
  "looks like an artwork. Crop it, treat it, work it into the design as you see fit.";

const OPEN_3 =
  "Before designing anything, look at the photograph and let it name its own mood: its era, its light, its " +
  "energy, its material world. Whatever this specific photograph radiates is the mood of the poster, " +
  "expressed honestly, never exaggerated into a different genre and never darkened or dramatized beyond " +
  "what the photo itself shows. Every design decision is derived from what is in this specific frame, as if " +
  "the art director had studied the photo and built the poster from it. This poster should look like it " +
  "could ONLY have been designed for this photograph: if the same solution would fit any other photo, " +
  "choose again. Nothing generic, and every choice at the quality level of a designer who wins awards with it.";

const HIERARCHY =
  "The hierarchy: the subject of the photograph is the star, large, present, unobscured in what makes it " +
  "strong. The photograph contains everything the poster needs: never add people, faces, figures or objects " +
  "that are not in the photograph. But the photograph is not untouched reality, it is treated into the " +
  "graphic world of the poster: contrast, tone and finish adjusted so photo, colour and type visibly share " +
  "one printed surface, one piece, not a picture with additions.";

const COMPOSITION =
  "The composition is one woven space with real depth: elements of the design sit behind the subject and a " +
  "few cross in front of it, so the subject stands inside the design, woven into it, never pasted beside it. " +
  "What these elements are, fields, lines, washes, grids, ornaments, marks, grows out of the image world, in " +
  "shapes and media this photograph suggests, not out of habit. Colour lives in organic forms with living " +
  "edges, never in flat geometric blocks, and at least one information group sits on or inside such a form, " +
  "merged with it. The text groups answer each other across the poster, at different edges and heights: at " +
  "least one information group is anchored to the right edge, the groups never all gather on one side. Every " +
  "text group exists exactly once on the poster, no information is repeated anywhere. No area feels dead, " +
  "everything stays composed.";

const QUALITY =
  "The quality rule for everything on this poster: nothing looks like a default. No plain system font, no " +
  "pure flat white, no flat untextured colour rectangle. Every letter and every surface feels crafted and " +
  "printed, with real ink character and slightly broken tones instead of pure white.";

const HEADLINE_PARA =
  "The headline: HEADLINE is the loudest typographic element, heavy and poster-strong, set in a face whose " +
  "character is born from this image world, whatever lettering tradition this photograph calls for, drawn as " +
  "if made for exactly this poster. One single line or two lines at most, never more; if two lines, they " +
  "form a solid justified block of equal width. The subject may overlap the headline slightly: an edge, a " +
  "contour resting on the letters. The overlap always stays shallow, every letter of HEADLINE remains fully " +
  "readable at a glance, the word is never covered by large parts of the subject.";

const COLOUR_WORLD =
  "The colour world is a strict triad: the treated photograph, one light tone, the family accent colour. " +
  "Nothing else. The accent is carried by the expressive voice and the organic forms, with a few deliberate " +
  "single touches, never spread evenly over everything.";

// Typo-Absatz: [MEDIUM] sitzt nach dem ersten Satz, der SUBLINE-Satz ist feld-getrieben.
function typographyPara(f, mediumCardText) {
  const med = v(mediumCardText);
  const subline = f.subline
    ? " The expressive voice appears on a few chosen words only: SUBLINE is set in it, directly at the " +
      "headline, clearly readable, one step smaller than the headline but unmistakably larger than all fine " +
      "print, and it may touch one or two more chosen spots."
    : " The expressive voice appears on a few chosen words only, at one or two chosen spots.";
  return "The typography lives from one contrast, the way designers pair type: one constructed voice carrying " +
    "HEADLINE and the clean information, against one expressive voice, a gestural hand for a few chosen words." +
    (med ? " " + med : "") + subline +
    " It is carried in the accent colour, so gesture and colour are one element. Never set whole information " +
    "groups in it, the contrast between the two voices is the design.";
}

// Informations-Absatz: DJ-Zeile + Datums/Uhrzeit-Zeile feld-getrieben (Bauteil 1b).
function informationPara(f) {
  const parts = [
    "The information is confident and present, not tiny, set clean and precise in its own family, never just " +
      "the headline font at a smaller size, the groups varying in weight, size and letterspacing.",
    f.dj
      ? "The DJ names DJ NAME 1, DJ NAME 2, DJ NAME 3 are always stacked vertically as one column, one name " +
        "per line, never side by side in a row, so the group keeps its shape regardless of how many names it holds."
      : "",
    f.date
      ? "The date 19.06.26" + (f.time ? " with UHRZEIT" : "") + " forms one single group, shaped as this " +
        "composition wants it, a compact block, a vertical mark, a printed tag, plain numbers without trailing dots."
      : "",
    f.date && f.time
      ? "UHRZEIT is a full member of this group, set in the same size class as the date numbers, never shrunk " +
        "to a footnote beneath them."
      : "",
    "Every smaller text physically belongs to the artwork: printed on or pressed into a surface, a form or a " +
      "gesture of the design, never floating loosely on the photograph.",
    "Carriers are never divided into separate compartments per text: one continuous surface with the words " +
      "simply set on it, no dividers, no boxed segments, no icon slots, so any single word could be removed " +
      "without leaving an empty frame.",
  ];
  return parts.filter(Boolean).join(" ");
}

// Basiszeilen-Absatz: CLUBNAME als Anker, LOCATION/Website darunter, feld-getrieben. CLUBNAME
// traegt den Absatz; ohne Clubname faellt der ganze Absatz weg.
function baseLinePara(f) {
  if (!f.club) return "";
  // Der Auftrag schreibt "CLUBNAME with LOCATION and www.website.com" im Auftakt, aber "LOCATION
  // with www.website.com" im zweiten Satz — darum zwei Fassungen der Unterzeile.
  const beneath = [f.location ? "LOCATION" : "", f.website ? "www.website.com" : ""].filter(Boolean);
  const beneathAnd = beneath.join(" and ");   // Auftakt
  const beneathWith = beneath.join(" with ");  // zweiter Satz
  const plural = beneath.length > 1 ? "sit" : "sits";
  const opener = beneathAnd
    ? "The base line, CLUBNAME with " + beneathAnd + " beneath it, is not printed on a separate dark box: it "
    : "The base line, CLUBNAME, is not printed on a separate dark box: it ";
  let s = opener +
    "sits directly on the lower edge of the artwork itself, finished with a single thin accent rule, so the " +
    "bottom of the poster is part of the design, not an attached bar. CLUBNAME stands as the anchor, one step " +
    "larger and heavier than the other small texts, like a compact wordmark";
  if (beneathWith) {
    s += ", and " + beneathWith + " " + plural + " as one smaller, lighter line directly beneath it, never " +
      "in the same row as CLUBNAME. No dividers between the words, only size and weight create the order, so " +
      "any single word could be removed without leaving a gap.";
  } else {
    s += ".";
  }
  return s;
}

function buildCorePrompt({ fields, familyText, layoutCardText, mediumCardText, opening } = {}) {
  const f = normFields(fields);
  const list = placeholderList(f);
  const parts = [];

  if (opening === "redesign") {
    parts.push(OPEN_1);
    parts.push(
      "The text content is fixed and not yours to invent: this is a template, and the only words on the new " +
      "poster are these placeholders, rendered literally, letter for letter as written here: " + list + ". " +
      "Set them fresh in your own design, never keep them where the old flyer had them. Never replace them " +
      "with invented titles, names, times or venues, never add any other word, slogan or label anywhere. Your " +
      "entire creative freedom lies in the design, none of it in the wording."
    );
    parts.push(OPEN_3);
  }

  const fam = v(familyText);
  if (fam) parts.push(fam);            // [FAMILIE] — leer -> Slot faellt weg (familienloser Modus)

  const card = v(layoutCardText);
  if (card) parts.push(card);          // [KARTE]

  parts.push(HIERARCHY, COMPOSITION, QUALITY, HEADLINE_PARA);
  parts.push(typographyPara(f, mediumCardText));
  parts.push(informationPara(f));
  const base = baseLinePara(f);
  if (base) parts.push(base);
  parts.push(COLOUR_WORLD);
  parts.push(
    "Keep every placeholder exactly as written" + (f.date ? ", keep the date exactly as 19.06.26" : "") +
    ". Format exactly 9:16 vertical."
  );

  return parts.filter(Boolean).join("\n\n");
}

// Familien-Absatz (Bauteil 3): festes Muster, der Charakter-Zusatz wird IMMER serverseitig an
// accent angehaengt, Sonnet formuliert ihn nie selbst.
const ACCENT_CHARACTER = ", used as graphic printed shapes and marks, never washes, stains or splatter";

function buildFamilyText(accent, tone) {
  const a = v(accent), t = v(tone);
  if (!a || !t) return "";
  return "This poster belongs to a category of sibling posters. What binds the family together: the accent " +
    "colour is " + a + ACCENT_CHARACTER + ", and the overall tone stays " + t + ". Within this, every design " +
    "decision is still yours, derived from this specific photograph.";
}

// Der statische Kern-Text mit Sentinels in den variablen Slots -> Grundlage des Kern-Hashes.
// Aendert sich ein statisches Literal, aendert sich der Hash; eine andere Karte/Familie nicht.
function staticCoreText() {
  return buildCorePrompt({
    fields: FULL_REDESIGN_FIELDS,
    familyText: "FAMILY",
    layoutCardText: "LAYOUT",
    mediumCardText: "MEDIUM",
    opening: "redesign",
  });
}

module.exports = {
  buildCorePrompt, buildFamilyText, staticCoreText,
  FULL_REDESIGN_FIELDS, FIELD_KEYS, ACCENT_CHARACTER, placeholderList,
};
