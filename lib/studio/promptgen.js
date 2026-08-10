"use strict";

// Prompt-Generator (Admin-Werkzeug, Beta): aus einem hochgeladenen Referenzflyer entsteht in
// ZWEI getrennten Sonnet-Aufrufen erst eine Masteranalyse, dann der Produktionsprompt.
//
// Die Trennung ist beabsichtigt und wird NICHT zusammengezogen: Call 2 bekommt bewusst kein
// Bild, die Analyse ist fuer ihn verbindlich. Ausserdem laeuft jeder Call in einem eigenen
// HTTP-Request (server.timeout liegt bei 120 s — zwei lange Aufrufe in einem Request waeren
// eine Zeitbombe), was zugleich die Fortschrittsanzeige und das Abschnitts-Gate ermoeglicht.
//
// DIE PROMPT-TEXTE STEHEN NICHT HIER. Sie liegen als vier reine Textdateien unter prompts/
// und werden bei JEDEM Aufruf frisch gelesen; der Code ersetzt ausschliesslich die zwei
// Platzhalter {{USER_CONTEXT}} und {{MASTER_ANALYSIS}} und sonst kein Zeichen. So laesst sich
// der Prompt ohne Codeaenderung anpassen.

const fs = require("fs");
const path = require("path");
const vision = require("./vision");
const usage = require("../admin/usage");

const DIR = path.join(__dirname, "..", "..", "prompts");
const FILES = {
  analysisSystem: "master-analysis.txt",
  analysisUser: "master-analysis-user.txt",
  converterSystem: "production-converter.txt",
  converterUser: "production-converter-user.txt",
};

// Fehlt der Kontext, tritt exakt dieser Satz an die Stelle des Platzhalters.
const NO_CONTEXT = "No user context provided. Derive genre and cultural identity from the image alone.";

// Die vom Masteranalyse-Prompt geforderte Gliederung. Fehlt einer dieser Abschnitte, wird
// Call 2 NICHT gestartet (Bauteil 4). Die Pruefung laeuft serverseitig, damit die Regel eine
// einzige Quelle hat.
const SECTIONS = [
  ["A", "MASTER SUMMARY"],
  ["B", "VISUAL DNA"],
  ["C", "GENRE AND CULTURAL DNA"],
  ["D", "PERFORMER AND OBJECT DNA"],
  ["E", "TYPOGRAPHIC MORPHOLOGY"],
  ["F", "CATEGORY 1 MODULES"],
  ["G", "CATEGORY 2 MODULES"],
  ["H", "CATEGORY 3 MODULES"],
  ["I", "DJ MODULE LOGIC"],
  ["J", "DATE AND TIME LOGIC"],
  ["K", "FOOTER AND LOWER ZONE LOGIC"],
  ["L", "SYMBOLS AND DECORATIVE LANGUAGE"],
  ["M", "FAILURE PREVENTION"],
  ["N", "PRODUCTION CONVERSION RULES"],
];

function readPrompt(key) {
  const name = FILES[key];
  if (!name) throw new Error("Unbekannte Prompt-Datei: " + key);
  try {
    return fs.readFileSync(path.join(DIR, name), "utf8");
  } catch (e) {
    throw new Error("Prompt-Datei nicht lesbar: prompts/" + name);
  }
}

// Ersetzt AUSSCHLIESSLICH den genannten Platzhalter, ueber split/join (kein Regex, damit
// Sonderzeichen im eingesetzten Text nichts kaputt machen koennen). Alle Vorkommen.
function fill(text, marker, value) {
  return text.split(marker).join(value);
}

// Ein Abschnitt gilt als vorhanden, wenn seine Ueberschrift am Zeilenanfang steht. Toleriert
// Markdown-Deko (##, **, -) und "A)" statt "A.", damit die Pruefung nicht an Formatierung
// scheitert, die inhaltlich nichts bedeutet.
function checkSections(analysis) {
  const text = String(analysis || "");
  const missing = [];
  for (const [letter, title] of SECTIONS) {
    const re = new RegExp("^[\\s>#*_\\-]*" + letter + "[.)]\\s*\\**\\s*" + title.replace(/ /g, "\\s+"), "im");
    if (!re.test(text)) missing.push(letter + ". " + title);
  }
  return { ok: missing.length === 0, missing, total: SECTIONS.length, found: SECTIONS.length - missing.length };
}

// ── Call 1: Bild + Kontext -> Masteranalyse ──
async function runAnalysis({ imageBase64, mediaType, userContext, model }) {
  const ctx = typeof userContext === "string" ? userContext.trim() : "";
  const system = readPrompt("analysisSystem");
  const instruction = fill(readPrompt("analysisUser"), "{{USER_CONTEXT}}", ctx || NO_CONTEXT);

  const out = await vision.promptgenAnalysis({ imageBase64, mediaType, system, instruction, model });
  try { usage.count("claude_promptgen_analysis"); } catch (_) {}

  const check = checkSections(out.text);
  return {
    analysis: out.text,
    hasContext: !!ctx,
    truncated: out.stopReason === "max_tokens", // Analyse abgeschnitten -> Abschnitte fehlen zwangslaeufig
    ...check,
  };
}

// ── Call 2: Masteranalyse (kein Bild) -> Produktionsprompt ──
// Der Aufrufer startet das nur, wenn Call 1 vollstaendig war; zur Sicherheit prueft es hier
// nochmal, damit ein direkter Routen-Aufruf das Gate nicht umgehen kann.
async function runConversion({ analysis, model }) {
  const text = typeof analysis === "string" ? analysis : "";
  const check = checkSections(text);
  if (!check.ok) {
    const err = new Error("Analyse unvollstaendig: " + check.missing.join(", "));
    err.status = 400;
    err.missing = check.missing;
    throw err;
  }
  const system = readPrompt("converterSystem");
  const instruction = fill(readPrompt("converterUser"), "{{MASTER_ANALYSIS}}", text);

  const out = await vision.promptgenConversion({ system, instruction, model });
  try { usage.count("claude_promptgen_convert"); } catch (_) {}
  return { prompt: out.text, truncated: out.stopReason === "max_tokens" };
}

module.exports = { runAnalysis, runConversion, checkSections, SECTIONS, NO_CONTEXT };
