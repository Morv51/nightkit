"use strict";

// Analyse-Prompt-Generator (Admin-Werkzeug "Analyse-Prompt").
//
// Ein Referenzflyer + Genre + Vibe -> EIN Modell-Call -> ein fertiger
// Bildgenerierungs-Prompt zum Kopieren. Dieses Modul erzeugt SELBST KEIN BILD
// und schreibt nichts: kein R2, keine Datenbank, kein Bestandseintrag. Das Bild
// geht durch den Call und wird danach verworfen.
//
// Die Vorlage prompts/promptgen_master.txt wird bei JEDEM Aufruf frisch von der
// Platte gelesen (bewusst KEIN Cache und kein require), damit sie sich ohne
// Deploy aendern laesst.

const fs = require("fs");
const path = require("path");
const openaiText = require("./openaiText");

const MASTER_PATH = path.join(__dirname, "..", "..", "prompts", "promptgen_master.txt");

// Frisch von Platte. Kein Cache — das ist der Zweck.
function loadMaster() {
  let raw;
  try { raw = fs.readFileSync(MASTER_PATH, "utf8"); }
  catch (e) { throw new Error("Analyse-Prompt nicht lesbar (prompts/promptgen_master.txt): " + e.message); }
  if (!raw || !raw.trim()) throw new Error("prompts/promptgen_master.txt ist leer");
  return raw;
}

// {{GENRE}} und {{VIBE}} in EINEM Durchgang ersetzen, damit eine Eingabe, die
// selbst wie ein Platzhalter aussieht, nicht ein zweites Mal ersetzt wird.
function fillPlaceholders(master, genre, vibe) {
  const map = { GENRE: genre, VIBE: vibe };
  return master.replace(/\{\{(GENRE|VIBE)\}\}/g, (_m, key) => map[key]);
}

function buildPrompt(genre, vibe) {
  return fillPlaceholders(loadMaster(), genre, vibe);
}

// Der eine Modell-Call. Ergebnis ist reiner Text und wird UNVERAENDERT
// zurueckgegeben — kein Trimmen von Inhalten, kein Nachbearbeiten, kein Parsen.
async function run({ apiKey, imageBase64, imageType, genre, vibe }) {
  const g = String(genre == null ? "" : genre).trim();
  const v = String(vibe == null ? "" : vibe).trim();
  if (!g) throw new Error("Genre fehlt");
  if (!v) throw new Error("Vibe fehlt");

  const prompt = buildPrompt(g, v);
  const res = await openaiText.analyzeImage({ apiKey, prompt, imageBase64, imageType });
  return { text: res.text, model: res.model, effort: res.effort, usage: res.usage };
}

module.exports = { run, buildPrompt, loadMaster, MASTER_PATH };
