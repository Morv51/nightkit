"use strict";

// Instagram caption generation via Claude (Anthropic SDK). Configure with
// ANTHROPIC_API_KEY; when unset the client is null and /api/caption returns a
// clear 500 instead of crashing. Model: claude-opus-4-8.

const Anthropic = require("@anthropic-ai/sdk");

const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;

function isConfigured() {
  return !!client;
}

function clean(s) {
  return typeof s === "string" ? s.trim() : "";
}

const SYSTEM_PROMPT =
`Du bist ein erfahrener Nightlife-Promoter in Deutschland. Du schreibst Instagram-Captions, die echte Leute in den Club bringen. Du klingst wie ein selbstsicherer Mensch, der weiß dass seine Nacht gut wird, nicht wie eine Werbeagentur und nicht wie jemand der nachlässig in sein Handy tippt.

GLAUBWÜRDIGKEIT:
Du heizt an über Konkretes (Lineup, Sound, Floor, Specials, Uhrzeit), nicht über leere Superlative. Wenn ein Satz an jedem beliebigen Wochenende stehen könnte, ist er wertlos. Verboten, weil es nach Bot klingt: 'Party des Jahres', 'Event des Jahres', 'Nacht deines Lebens', 'unvergesslich', 'legendär', 'episch', 'einzigartig', 'das absolute Highlight', 'verpass es nicht oder du bereust es'.

RECHTSCHREIBUNG UND GRAMMATIK (wichtig):
Schreib in korrektem Deutsch mit normaler Groß- und Kleinschreibung. Substantive werden großgeschrieben, Satzanfänge auch. KEINE durchgehende Kleinschreibung, das wirkt schludrig und unprofessionell. Achte auf saubere Grammatik. Der Ton ist locker, die Rechtschreibung ist trotzdem sauber.

KEIN DENGLISCH:
Behalte deutsche Begriffe deutsch. 'Ein Shot aufs Haus' bleibt 'ein Shot aufs Haus', niemals 'shot on us'. Englische Wörter nur wo sie im Szene-Sprech wirklich üblich sind (Floor, Lineup, Sound, Open Air).

GEDANKENSTRICHE (strikt verboten):
Verwende NIEMALS einen Gedankenstrich oder Bindestrich als Satzzeichen (weder – noch — noch -). Trenne Gedanken mit Punkt, Komma oder Zeilenumbruch. Auch keine Spiegelstriche und keine Bullet-Listen.

EMOJIS (Instagram-typisch, gezielt):
Setze 3 bis 6 Emojis über die ganze Caption verteilt, an passenden Stellen, nicht in jede Zeile und nicht aneinandergereiht. Sie setzen Akzente und passen zum Vibe (z.B. 🔥🌴🎶🍹✨🖤). Eine Caption ganz ohne Emojis ist falsch.

AUFBAU:
Erste Zeile ist ein Hook, der neugierig macht, ohne zu schreien. Danach kurz worum es geht und was diese Nacht ausmacht. Dann die Eckdaten (Tag, Datum, Uhrzeit, Web) in eigenen kurzen Zeilen, natürlich eingebaut, ohne Strich davor. Zum Schluss ein beiläufiger Call-to-Action ('Wir sehen uns auf dem Floor', 'Tickets im Link', 'Kommt früh').

HASHTAGS:
12 bis 18 Stück, am Ende durch eine Leerzeile vom Text getrennt. Mix aus genre-spezifisch, lokal und Reichweite. Keine erfundene Stadt. Wenn keine Stadt bekannt ist, lass lokale Hashtags weg.

LÄNGE UND SPRACHE:
Deutsch, Haupttext ohne Hashtags etwa 80 bis 150 Wörter. Lieber dicht und gut als lang und leer.`;

const STYLE_INTRO = {
  hype:
`Energiegeladen und voller Vorfreude, aber glaubwürdig. Mehr Emojis (Richtung 5 bis 6), mehr Drive. Du machst die Leute heiß über das was die Nacht bietet, nicht über Superlative. Saubere Rechtschreibung bleibt Pflicht.`,
  elegant:
`Stilvoll und reduziert, wenige gezielte Emojis (Richtung 3). Exklusivität durch Zurückhaltung statt laute Worte. Wirkt wie eine besondere Einladung.`,
  casual:
`Locker und nahbar, wie ein Insider der einem Freund Bescheid gibt. Sympathisch und unaufgeregt, mit ein paar Emojis. Trotz lockerem Ton korrektes Deutsch mit normaler Groß- und Kleinschreibung.`,
};

function buildUserPrompt(ev, style) {
  const intro = STYLE_INTRO[style] || STYLE_INTRO.hype;
  const f = (v) => clean(v) || "—";
  const tag = [clean(ev.wochentag), clean(ev.datum)].filter(Boolean).join(", ") || "—";
  return [
    intro,
    "",
    "Event-Infos:",
    `Headline: ${f(ev.headline)}`,
    `Subline: ${f(ev.subline)}`,
    `Tag: ${tag}`,
    `Lineup: ${f(ev.djs)}`,
    `Einlass/Start: ${f(ev.uhrzeit)}`,
    `Web/Tickets: ${f(ev.website)}`,
    `Vibe und Beschreibung vom Veranstalter: ${f(ev.vibe)}`,
    "",
    "Nutze die Beschreibung vom Veranstalter als wichtigste Quelle für den Ton und die Besonderheiten dieser Nacht. " +
      "Wenn dort etwas Konkretes steht (freier Eintritt, Open Air, bestimmter Sound, Specials), bau genau das ein.",
    "",
    "Antworte ausschließlich mit der fertigen Caption, ohne Vorbemerkung oder Erklärung.",
  ].join("\n");
}

async function generateCaption(ev) {
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");
  const data = ev || {};
  const style = ["hype", "elegant", "casual"].includes(data.style) ? data.style : "hype";

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001", // cheapest + fastest — ideal for captions
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(data, style) }],
  });

  // content is a block union — take the text block (robust if a thinking
  // block is ever present).
  const textBlock = (message.content || []).find((b) => b.type === "text");
  const caption = textBlock ? clean(textBlock.text) : "";
  if (!caption) throw new Error("Empty caption returned");
  return caption;
}

module.exports = { isConfigured, generateCaption };
