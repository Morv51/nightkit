"use strict";

// Auswahl der Regeln, die aus dem destillierten Regelwerk in den BILDPROMPT gehen.
// Reine Funktion: kein R2, kein Netz, kein Zustand — dadurch pruefbar und ueberall einsetzbar.
//
// Grundsatz: NICHT das ganze Regelwerk in den Prompt (das ueberlaedt ihn), sondern
//   1. die universellen Regeln (gelten ueber alle Stile), IMMER,
//   2. die stilabhaengigen Regeln NUR fuer die an der Referenz erkannte Kategorie,
//   3. je im Referenzflyer FEHLENDER Rolle (typisch djs) deren stilspezifische Herleitung.
//
// Rueckfall bei duennen Kategorien: hat die erkannte Kategorie weniger als MIN_DATENSAETZE
// Datensaetze, bleiben ihre stilabhaengigen Regeln (inkl. Herleitung) DRAUSSEN — Regeln aus
// ein, zwei Beispielen sind nicht belastbar. Die universellen Regeln beruhen auf allen
// Datensaetzen und bleiben.

const MIN_DATENSAETZE = 4;

const v = (x) => (typeof x === "string" ? x.trim() : "");
const norm = (x) => String(x == null ? "" : x).trim().toLowerCase();

// Beschriftung der Rolle im Prompt (die Platzhalter-Rollen des Prompt-Bauers).
const ROLLE_LABEL = {
  djs: "the DJ NAME slots",
  location: "the LOCATION slot",
  uhrzeit: "the TIME slot",
  datum: "the DATE slot",
};

// ruleset: das aus R2 geladene Regelwerk (oder null). kategorie: dna.stil_kategorie.
// fehlendeRollen: dna.fehlende_rollen (Rollen, die die REFERENZ nicht zeigt).
// -> { lines, meta }. lines = fertige Promptzeilen (leer = nichts einspeisen).
// meta erklaert die Auswahl (fuer Log und Nachvollziehbarkeit), nie fuer den Prompt.
function selectRuleLines(ruleset, opts = {}) {
  const kategorie = norm(opts.kategorie);
  const meta = {
    kategorie, anzahl: 0, universell: 0, stilRegeln: 0,
    rollen: [], duenn: false, grund: "",
  };
  if (!ruleset || typeof ruleset !== "object") { meta.grund = "kein Regelwerk vorhanden"; return { lines: [], meta }; }

  const uni = (Array.isArray(ruleset.universelle_regeln) ? ruleset.universelle_regeln : [])
    .map((r) => v(r && r.regel)).filter(Boolean);
  const stilAlle = (ruleset.stilabhaengige_regeln && typeof ruleset.stilabhaengige_regeln === "object")
    ? ruleset.stilabhaengige_regeln : {};

  // Kategorie unabhaengig von Gross/Kleinschreibung treffen.
  let grp = null, key = "";
  for (const k of Object.keys(stilAlle)) {
    if (norm(k) === kategorie && kategorie) { grp = stilAlle[k] || {}; key = k; break; }
  }
  const anzahl = parseInt(grp && grp.anzahl, 10) || 0;
  meta.anzahl = anzahl;

  // Rueckfall: keine Kategorie erkannt, Kategorie nicht im Regelwerk, oder zu duenn.
  const duenn = !grp || anzahl < MIN_DATENSAETZE;
  meta.duenn = duenn;
  if (!kategorie) meta.grund = "keine Stil-Kategorie an der Referenz erkannt -> nur universelle Regeln";
  else if (!grp) meta.grund = 'Kategorie "' + kategorie + '" nicht im Regelwerk -> nur universelle Regeln';
  else if (duenn) meta.grund = 'Kategorie "' + kategorie + '" nur ' + anzahl + " Datensaetze (< " + MIN_DATENSAETZE + ") -> nur universelle Regeln";
  else meta.grund = 'Kategorie "' + kategorie + '" mit ' + anzahl + " Datensaetzen -> universelle + stilabhaengige Regeln";

  const stilRegeln = duenn ? [] : (Array.isArray(grp.regeln) ? grp.regeln : []).map((r) => v(r && r.regel)).filter(Boolean);

  // Herleitung NUR fuer Rollen, die die Referenz nicht zeigt — dort fehlt dem Bildmodell die
  // Vorlage, genau da traegt die destillierte Herleitung. Bei duenner Kategorie entfaellt sie
  // mit den uebrigen stilabhaengigen Regeln.
  const fehlend = (Array.isArray(opts.fehlendeRollen) ? opts.fehlendeRollen : []).map(norm).filter(Boolean);
  const herleitung = [];
  if (!duenn && fehlend.length) {
    for (const h of (Array.isArray(grp.herleitung_rollen) ? grp.herleitung_rollen : [])) {
      const rolle = norm(h && h.rolle);
      const muster = v(h && h.muster);
      if (!rolle || !muster || !fehlend.includes(rolle)) continue;
      herleitung.push({ rolle, muster });
    }
  }
  meta.universell = uni.length;
  meta.stilRegeln = stilRegeln.length;
  meta.rollen = herleitung.map((h) => h.rolle);

  if (!uni.length && !stilRegeln.length && !herleitung.length) {
    meta.grund += " (keine passenden Regeln)";
    return { lines: [], meta };
  }

  const basis = parseInt(ruleset.basis && ruleset.basis.datensaetze, 10) || 0;
  const lines = [];
  // Kopf: Rang klar setzen. Die Regeln ERGAENZEN die technischen Bloecke (sie heben keinen auf),
  // und die Leitidee der Referenz steht ueber ihnen.
  lines.push("DESIGN RULES — craft guidance distilled by a graphic designer from " + (basis || "many") +
    " analysed club flyers. They describe HOW such a flyer is CRAFTED. They ADD judgement on top of the " +
    "technical blocks below — they never cancel or weaken any of them. Where a rule contradicts the GUIDING " +
    "IDEA above, THE GUIDING IDEA WINS. The rule texts are in German:");
  for (const r of uni) lines.push("- RULE (applies to every style): " + r);
  for (const r of stilRegeln) lines.push('- RULE for the "' + key + '" style of this reference (' + anzahl + " analysed flyers): " + r);
  for (const h of herleitung) {
    lines.push("- MISSING ROLE — the reference does NOT show " + (ROLLE_LABEL[h.rolle] || h.rolle) + ", but the new " +
      "flyer must carry that text. Do not invent a look and do not fall back to plain default type: DERIVE it the " +
      'way the "' + key + '" style derives it: ' + h.muster);
  }
  return { lines, meta };
}

module.exports = { selectRuleLines, MIN_DATENSAETZE };
