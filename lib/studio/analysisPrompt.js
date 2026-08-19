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
const GENRE_VIBE_PATH = path.join(__dirname, "..", "..", "prompts", "genre_vibe.txt");
const INSTRUCTIONS_PATH = path.join(__dirname, "..", "..", "prompts", "promptgen_instructions.txt");

// Frisch von Platte. Kein Cache — das ist der Zweck.
function loadFile(pfad, anzeigename) {
  let raw;
  try { raw = fs.readFileSync(pfad, "utf8"); }
  catch (e) { throw new Error("Vorlage nicht lesbar (" + anzeigename + "): " + e.message); }
  if (!raw || !raw.trim()) throw new Error(anzeigename + " ist leer");
  return raw;
}
function loadMaster() { return loadFile(MASTER_PATH, "prompts/promptgen_master.txt"); }
function loadGenreVibe() { return loadFile(GENRE_VIBE_PATH, "prompts/genre_vibe.txt"); }

// Bewusst TOLERANT, anders als die beiden Vorlagen oben: fehlt die Datei oder
// ist sie leer, faellt das instructions-Feld einfach weg statt zu werfen. Auch
// hier frisch von Platte, also ohne Deploy aenderbar.
function loadInstructions() {
  let raw;
  try { raw = fs.readFileSync(INSTRUCTIONS_PATH, "utf8"); }
  catch (_) { return ""; }
  return (raw && raw.trim()) ? raw : "";
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
  const instructions = loadInstructions();
  const res = await openaiText.analyzeImage({ apiKey, prompt, instructions, imageBase64, imageType });
  return { text: res.text, model: res.model, effort: res.effort, usage: res.usage };
}

// ── Genre/Vibe-Vorschlag ────────────────────────────────────────────────────
// Zweiter, kleiner Call: nur das Bild und prompts/genre_vibe.txt. Erwartet wird
// genau zwei Zeilen, GENRE: ... und VIBE: ... .

const kurz = (t) => String(t == null ? "" : t).replace(/\s+/g, " ").trim().slice(0, 200);

// Toleriert fuehrende Leerzeichen und Sternchen (**GENRE:**), verlangt aber das
// Schluesselwort am Zeilenanfang. Der erste Treffer je Feld gewinnt.
function parseGenreVibe(text) {
  const out = { genre: "", vibe: "" };
  for (const zeile of String(text == null ? "" : text).split(/\r?\n/)) {
    const m = zeile.match(/^\s*\**\s*(GENRE|VIBE)\s*\**\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const wert = m[2].replace(/^\**\s*/, "").replace(/\*+\s*$/, "").trim();
    if (wert && !out[key]) out[key] = wert;
  }
  return out;
}

async function suggest({ apiKey, imageBase64, imageType }) {
  const prompt = loadGenreVibe();
  const res = await openaiText.analyzeImage({
    apiKey, prompt, imageBase64, imageType,
    model: openaiText.CLASSIFY_MODEL,
    effort: openaiText.CLASSIFY_EFFORT,
    verbosity: openaiText.CLASSIFY_VERBOSITY,
    maxOutput: openaiText.CLASSIFY_MAX_OUTPUT,
    timeoutMs: openaiText.CLASSIFY_TIMEOUT_MS,
  });
  const { genre, vibe } = parseGenreVibe(res.text);
  // Stimmt das Format nicht, ist das ein sichtbarer Fehler — und die Maske
  // laesst die Felder unveraendert. Die tatsaechliche Antwort kommt gekuerzt
  // mit, sonst raet man beim Nachstellen.
  if (!genre || !vibe) {
    const fehlt = (!genre && !vibe) ? "GENRE und VIBE fehlen" : (!genre ? "GENRE fehlt" : "VIBE fehlt");
    const e = new Error("Vorschlag nicht im erwarteten Format (" + fehlt + "). Das Modell antwortete: " + (kurz(res.text) || "(nichts)"));
    e.unparsed = true;
    throw e;
  }
  return { genre, vibe, model: res.model, raw: res.text };
}

module.exports = { run, buildPrompt, loadMaster, MASTER_PATH, suggest, loadGenreVibe, parseGenreVibe, GENRE_VIBE_PATH, loadInstructions, INSTRUCTIONS_PATH };
