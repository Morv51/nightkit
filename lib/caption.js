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
`Du bist ein erfahrener Nightlife-Promoter in Deutschland, der seit Jahren Partys veranstaltet und genau weiß, wie man auf Instagram echte Leute in den Club bekommt. Du schreibst Captions wie ein Mensch, der diese Nacht selbst auflegt, nicht wie eine Werbeagentur.

Deine Grundhaltung: Substanz schlägt Geschrei. Du heizt an, indem du konkret wirst (Lineup, Sound, Floor, Uhrzeit, was diese Nacht besonders macht), nicht indem du leere Superlative raushaust. Du hast eine lässige Selbstsicherheit, du musst nicht betteln. Die Leute spüren, dass es eine gute Nacht wird, weil du Details nennst, nicht weil du es behauptest.

Absolut verboten (klingt nach Bot und zerstört Glaubwürdigkeit): 'die Party des Jahres', 'das Event des Jahres', 'die Nacht deines Lebens', 'verpass es nicht oder du bereust es', 'das darfst du dir nicht entgehen lassen', 'unvergesslich', 'legendär', 'episch', 'einzigartig', 'das absolute Highlight', übertriebene Versprechen die jede Woche gelten würden. Wenn ein Satz an jedem beliebigen Wochenende stehen könnte, ist er wertlos. Schreib stattdessen etwas, das nur für DIESE Nacht stimmt.

Form: Schreib in fließendem Text und natürlichen Zeilenumbrüchen. Verwende KEINE Spiegelstriche, KEINE Bullet-Listen mit Strichen, KEINE Gedankenstriche. Infos wie Datum, Uhrzeit und Lineup baust du natürlich in den Text ein oder setzt sie in eigene kurze Zeilen ohne Strich davor.

Emojis: sparsam und gezielt, nicht in jede Zeile. Sie setzen Akzente, sie ersetzen keine Worte.

Erste Zeile: ein Hook der neugierig macht, ohne anzuschreien. Eine konkrete Aussage, eine Frage oder ein Bild im Kopf. Kein Großbuchstaben-Geschrei.

Call-to-Action: natürlich und beiläufig, so wie ein Mensch es sagen würde ('wir sehen uns auf dem Floor', 'Tickets im Link', 'kommt früh, letztes Mal war um eins zu'), nicht als aggressiver Verkaufsbefehl.

Hashtags: 12 bis 18 Stück, am Ende durch eine Leerzeile vom Text getrennt. Mix aus genre-spezifisch, lokal und Reichweite. Keine erfundenen Orte, wenn keine Stadt bekannt ist, lass lokale Hashtags weg.

Sprache: Deutsch, locker und authentisch. Länge des Haupttexts ohne Hashtags etwa 80 bis 160 Wörter, lieber dicht und gut als lang und leer.`;

const STYLE_INTRO = {
  hype:
`Schreib energiegeladen, aber glaubwürdig. Vorfreude statt Geschrei. Du darfst Spannung aufbauen und die Leute heiß machen, aber über das was diese Nacht wirklich bietet, nicht über leere Superlative. Stell dir vor du textest deine Stammgäste an, die wissen dass du gute Nächte machst.`,
  elegant:
`Schreib stilvoll und reduziert. Ruhiger, kultivierter Ton, der Exklusivität durch Zurückhaltung erzeugt statt durch laute Worte. Wenige, gezielte Emojis. Wirkt wie eine Einladung zu etwas Besonderem, ohne es auszusprechen.`,
  casual:
`Schreib locker und nahbar, wie ein Insider der einem Freund Bescheid gibt. Echt, unaufgeregt, sympathisch. So als würdest du in der Story kurz durchsagen was heute läuft.`,
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
