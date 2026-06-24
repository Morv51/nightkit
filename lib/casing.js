"use strict";

// Schreibweisen-Normalisierung für Script-Templates (Manifest uppercase:false).
// Der Nutzer muss sich nicht um Groß-/Kleinschreibung kümmern — wir bringen jeden
// Wert in eine sinnvolle Title-Case-Form, schützen dabei aber bewusste Eigen-
// schreibweisen und Akronyme, damit die geschwungene Schrift greift:
//
//   • Wort komplett GROSS und >4 Buchstaben  → Title Case   ("NIGHT" → "Night")
//   • Wort komplett GROSS und 2–4 Buchstaben → unverändert  ("RNB", "VIP", "DJ", "MC", "NYE")
//   • Wort komplett klein                    → erster Buchstabe groß ("night" → "Night")
//   • Wort gemischt geschrieben              → unverändert  ("RnB", "McMarv")
//
// Whitespace bleibt erhalten; rein nicht-alphabetische Tokens werden nicht
// angefasst. Die Akronym-Erkennung zählt nur Buchstaben (\p{L}), damit ein an-
// hängendes Satzzeichen (z. B. "RNB,") die Länge nicht verfälscht.
function titleCaseWord(tok) {
  if (!tok) return tok;
  const letters = (tok.match(/\p{L}/gu) || []).length;
  if (!letters) return tok; // z. B. "-", "&", "/"
  const isUpper = tok === tok.toUpperCase() && tok !== tok.toLowerCase();
  const isLower = tok === tok.toLowerCase() && tok !== tok.toUpperCase();
  if (isUpper) return letters <= 4 ? tok : tok.charAt(0) + tok.slice(1).toLowerCase();
  if (isLower) return tok.charAt(0).toUpperCase() + tok.slice(1);
  return tok; // gemischt geschrieben → so lassen
}

function titleCaseSmart(s) {
  if (typeof s !== "string") return s;
  // Auf Whitespace splitten, die Trenner aber erhalten (capturing group).
  return s.split(/(\s+)/).map((tok) => (/^\s*$/.test(tok) ? tok : titleCaseWord(tok))).join("");
}

module.exports = { titleCaseSmart, titleCaseWord };
