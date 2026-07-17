"use strict";

// Auswahl der Zeilen, die aus dem destillierten Regelwerk in den BILDPROMPT gehen.
// Reine Funktion: kein R2, kein Netz, kein Zustand — dadurch pruefbar und ueberall einsetzbar.
//
// Das Regelwerk ist jetzt UNIVERSELL (aus ALLEN Flyern gemeinsam, nicht pro Stil-Kategorie).
// Eingespeist werden:
//   1. das anordnung_muster (der destillierte typische Anordnungs-Absatz), IMMER,
//   2. die konkreten Anordnungsregeln (universelle_regeln), IMMER,
//   3. je FEHLENDER Rolle (typisch djs) deren konkrete, aus echten Flyern gelernte Platzierung.
// Keine Kategorie-Auswahl und keine Datensatz-Schwelle mehr — das war die Zerstueckelung, die
// den Info-Block platt gemacht hat. Alte Regelwerke (Kategorie-Form) werden noch toleriert:
// deren universelle_regeln kommen weiter durch, Kategorie-Teile werden ignoriert.

const v = (x) => (typeof x === "string" ? x.trim() : "");
const norm = (x) => String(x == null ? "" : x).trim().toLowerCase();

// Wer sticht die Regeln, wenn sie sich widersprechen? Im Auto-Flow die Leitidee der Referenz
// (bisheriges Verhalten, Default). Im Handpfad gibt es keine Leitidee: dort steht das Design
// des Originalflyers und die geprueften Rollen-Zuordnungen ueber den Regeln.
const VORRANG_SATZ = {
  leitidee: "Where a rule contradicts the GUIDING IDEA above, THE GUIDING IDEA WINS.",
  original: "Where a rule contradicts the original flyer's design language or the placeholder " +
    "assignments above, THE ORIGINAL DESIGN AND THE ASSIGNMENTS WIN.",
};

// Beschriftung der Rolle im Prompt (die Platzhalter-Rollen des Prompt-Bauers).
const ROLLE_LABEL = {
  djs: "the DJ NAME slots",
  location: "the LOCATION slot",
  uhrzeit: "the TIME slot",
  datum: "the DATE slot",
};

// ruleset: das aus R2 geladene, universelle Regelwerk (oder null).
// fehlendeRollen: Rollen, die die REFERENZ nicht zeigt (aus dna.fehlende_rollen oder, im
// Handpfad, aus der geprueften Zuordnung). vorrang: "leitidee" (Default, Auto-Flow) |
// "original" (Handpfad).
// -> { lines, meta }. lines = fertige Promptzeilen (leer = nichts einspeisen).
// meta erklaert die Auswahl (fuer Log und Nachvollziehbarkeit), nie fuer den Prompt.
function selectRuleLines(ruleset, opts = {}) {
  const vorrang = VORRANG_SATZ[norm(opts.vorrang)] || VORRANG_SATZ.leitidee;
  const meta = { universell: 0, rollen: [], muster: false, grund: "" };
  if (!ruleset || typeof ruleset !== "object") { meta.grund = "kein Regelwerk vorhanden"; return { lines: [], meta }; }

  const muster = v(ruleset.anordnung_muster);
  const uni = (Array.isArray(ruleset.universelle_regeln) ? ruleset.universelle_regeln : [])
    .map((r) => v(r && r.regel)).filter(Boolean);

  // Herleitung NUR fuer Rollen, die die Referenz nicht zeigt — dort fehlt dem Bildmodell die
  // Vorlage, genau da traegt die aus echten Flyern gelernte Platzierung. Aus dem TOP-LEVEL des
  // neuen Regelwerks; alte Kategorie-Regelwerke haben das dort nicht -> dann keine Herleitung.
  const fehlend = (Array.isArray(opts.fehlendeRollen) ? opts.fehlendeRollen : []).map(norm).filter(Boolean);
  const herleitung = [];
  for (const h of (Array.isArray(ruleset.herleitung_rollen) ? ruleset.herleitung_rollen : [])) {
    const rolle = norm(h && h.rolle);
    const m = v(h && h.muster);
    if (!rolle || !m || !fehlend.includes(rolle)) continue;
    herleitung.push({ rolle, muster: m });
  }
  meta.universell = uni.length;
  meta.rollen = herleitung.map((h) => h.rolle);
  meta.muster = !!muster;

  if (!muster && !uni.length && !herleitung.length) {
    meta.grund = "keine passenden Regeln im Regelwerk";
    return { lines: [], meta };
  }

  const basis = parseInt(ruleset.basis && ruleset.basis.datensaetze, 10) || 0;
  const lines = [];
  // Kopf: Rang klar setzen. Die Anordnung ERGAENZT die technischen Bloecke (sie hebt keinen auf),
  // und ueber ihr steht, was der Aufrufer als vorrangig gesetzt hat (Leitidee bzw. Original).
  lines.push("SECONDARY-BLOCK ARRANGEMENT — how a graphic designer actually arranges the secondary information " +
    "(DJ names, date, time, location, club name, website), distilled from " + (basis || "many") + " real, " +
    "professionally designed club flyers. Reproduce THIS real arrangement; do NOT fall back to an even, evenly " +
    "stacked default block. It ADDS to the technical blocks below and never cancels them. " + vorrang +
    " The texts are in German:");
  if (muster) lines.push("- TYPICAL ARRANGEMENT: " + muster);
  for (const r of uni) lines.push("- ARRANGEMENT RULE: " + r);
  for (const h of herleitung) {
    lines.push("- MISSING ROLE — the reference does NOT show " + (ROLLE_LABEL[h.rolle] || h.rolle) + ", but the " +
      "template must carry that text. Do not invent a look and do not fall back to plain default type: place and " +
      "set it the way the real flyers do: " + h.muster);
  }
  meta.grund = (muster ? "Muster-Absatz, " : "") + uni.length + " Anordnungsregeln, " + herleitung.length + " Rollen-Herleitungen";
  return { lines, meta };
}

module.exports = { selectRuleLines };
