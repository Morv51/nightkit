"use strict";

// Redesign v2, Bauteil 2: die kuratierten Karten-Arrays + die Rotation.
//
// Zwei Achsen, je Kandidat EINE Kombination:
//   LAYOUT_CARDS  — die Grundstruktur der Komposition ([KARTE] im Kern)
//   MEDIUM_CARDS  — das Medium der expressiven Stimme ([MEDIUM] im Kern)
//
// Rotation (comboAt): der Rang laeuft ueber den templateIndex (Position in der Auswahl).
// Layout- und Medium-Index laufen TEILERFREMD — Schritt 5 gegen Laenge 6 —, damit die zwei
// Karten nicht im Gleichschritt gehen und beide voll streuen. Fuer Rang 0..5 ergibt das genau
// die teilerfremde Diagonale layout=r, medium=(r*5)%6; ab Rang 6 wandert die Kombination in die
// off-diagonalen Paare, sodass auch >6 Templates (und die Nachwuerfe) frische, noch nicht
// benutzte Kombinationen bekommen. Ueber alle 36 Raenge ist comboAt eine Bijektion auf die
// 36 moeglichen (layout, medium)-Paare.

// Jede Layout-Karte schliesst mit einem Satz zur DATUMS-FORM (Bauteil B.3), damit die Form
// garantiert mitrotiert. giant_date behaelt seine eigene Datums-Logik (kein Zusatz). Der
// Kern-Satz zur Datums-Form bleibt unveraendert und erlaubt alle Formen; die Karte konkretisiert.
const LAYOUT_CARDS = [
  { key: "fundament",
    text: "The base structure of this poster: HEADLINE sits in the lower part of the poster as its " +
      "foundation, the photograph rises above it and owns the upper space. The information groups are " +
      "distributed in the upper and middle zones, not crowded around the headline. The date stands as a " +
      "vertical mark, one number per line: 19 above 06 above 26, UHRZEIT beneath in the same size class." },
  { key: "opening_block",
    text: "The base structure of this poster: HEADLINE stands at the very top of the poster as a massive " +
      "opening block, the photograph unfolds beneath it. The information groups are distributed in the " +
      "middle and lower zones, the base line closes the poster at the bottom edge. The date forms one bold " +
      "compact block." },
  { key: "vertical_mark",
    text: "The base structure of this poster: HEADLINE runs as a strong vertical element along one side of " +
      "the poster, the photograph owns the remaining space. The information groups are distributed across " +
      "the open side, the date may stand as its own vertical mark. The date stands as a vertical mark, one " +
      "number per line: 19 above 06 above 26, UHRZEIT beneath in the same size class." },
  { key: "woven_center",
    text: "The base structure of this poster: HEADLINE sits across the middle of the poster, interlocking " +
      "with the subject, type and image sharing the center. The information groups frame this center from " +
      "the edges. The date sits as a printed tag." },
  { key: "giant_date",
    text: "The base structure of this poster: the date 19.06.26 is an oversized graphic element, one of the " +
      "largest things on the poster. HEADLINE stays strong but compact, the remaining groups are " +
      "distributed around these two anchors." },
  { key: "diagonal",
    text: "The base structure of this poster: the composition is built on a strong diagonal. HEADLINE runs " +
      "angled across the poster, the photograph and the information groups answer this diagonal, set at " +
      "different heights along it. The date stands as a compact block." },
];

// Aus der Standard-Rotation genommen, aber vollstaendig erhalten: fuer spaetere Vintage-/Antik-/
// Halloween-Auftraege vorgesehen. Aktuell OHNE UI-Anbindung, nicht in comboAt.
const LAYOUT_CARDS_SPECIAL = [
  { key: "emblem",
    text: "The base structure of this poster: the composition is centered and symmetrical, built like an " +
      "emblem or a crest around the vertical axis. The subject stands in the middle, HEADLINE centered " +
      "beneath or across it, the information groups arranged in balanced symmetry around the axis. The " +
      "right-edge rule does not apply in this structure, symmetry replaces it. Crafted ornamental frames " +
      "drawn from the image world are allowed in this structure." },
];

// Medium-Karten: je mit einem NICHT-Ziel (grenzt gegen den Brush-Default ab) und einer SUBLINE-
// Haltung — die Haltung rotiert damit die Subline-Position mit, ohne sie im Kern festzuschreiben.
const MEDIUM_CARDS = [
  { key: "brush",  text: "The medium of the expressive voice for this poster: a dry brush hand, painted in one fast confident stroke. SUBLINE sweeps across or over the headline." },
  { key: "pen",    text: "The medium of the expressive voice for this poster: an elegant pen line with fine hairline swells, never a painted brush stroke. SUBLINE sits calmly beneath the headline, precisely placed." },
  { key: "light",  text: "The medium of the expressive voice for this poster: a glowing light trail, drawn as if written with light from the scene, never a painted brush stroke. SUBLINE floats beside or beneath the headline as a glowing line." },
  { key: "carved", text: "The medium of the expressive voice for this poster: a line carved or engraved into a surface of the image world, never a painted brush stroke. SUBLINE is set small and confident directly under the headline, cut into the same surface." },
  { key: "chalk",  text: "The medium of the expressive voice for this poster: a dry chalk or charcoal stroke with broken edges, pressed dry, never a wet painted brush stroke. SUBLINE sits at the edge of the headline block, slightly offset." },
  { key: "stamp",  text: "The medium of the expressive voice for this poster: a stamped or misprinted line with rough ink edges, pressed like a rubber stamp, never a painted brush stroke. SUBLINE is stamped beneath or across the headline corner." },
];

// Rang -> Karten-Kombination. layout laeuft Schritt 1, medium teilerfremd Schritt 5 (+ ein
// langsamer Uebertrag ab Rang 6, damit die 36 Kombinationen alle genau einmal vorkommen).
function comboAt(rank) {
  const L = LAYOUT_CARDS.length; // 6
  const r = ((Math.trunc(rank) % (L * L)) + L * L) % (L * L); // 0..35, negativ-sicher
  const li = r % L;
  const mi = (r * 5 + Math.floor(r / L)) % L;
  return {
    rank: r,
    layoutKey: LAYOUT_CARDS[li].key, layoutText: LAYOUT_CARDS[li].text,
    mediumKey: MEDIUM_CARDS[mi].key, mediumText: MEDIUM_CARDS[mi].text,
  };
}

// Karten-Text zu einem gespeicherten Schluessel (fuers Gate, das die Karten woertlich vorlegt).
// Layout schlaegt in Standard UND Special nach, damit alte Laeufe mit "emblem" ihren Kartentext
// im Gate nicht verlieren.
const _byKey = (arr) => arr.reduce((o, c) => ((o[c.key] = c.text), o), {});
const _LAYOUT_TEXT = Object.assign(_byKey(LAYOUT_CARDS_SPECIAL), _byKey(LAYOUT_CARDS));
const _MEDIUM_TEXT = _byKey(MEDIUM_CARDS);
function cardText(kind, key) {
  return (kind === "layout" ? _LAYOUT_TEXT : _MEDIUM_TEXT)[key] || "";
}

module.exports = { LAYOUT_CARDS, LAYOUT_CARDS_SPECIAL, MEDIUM_CARDS, comboAt, cardText };
