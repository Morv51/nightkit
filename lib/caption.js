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
`Du bist ein Social Media Experte für Nightlife und Club-Events in Deutschland. Du schreibst Instagram Captions die viral gehen, hohe Engagement-Raten erzielen und zu echten Ticket-Verkäufen führen.

Deine Captions folgen bewährten Conversion-Prinzipien:
- Erste Zeile ist ein starker Hook der zum Weiterlesen zwingt (Frage, provokante Aussage oder FOMO-Trigger)
- Emojis strategisch einsetzen — nicht übertreiben, aber Aufmerksamkeit lenken
- Event-Infos klar und scanbar strukturiert
- Sozialer Beweis oder Exklusivität wenn möglich andeuten
- Starker Call-to-Action am Ende
- Hashtag-Block: 15-20 Hashtags, Mix aus:
  * Genre-spezifisch (#housemusic #techno etc.)
  * Location-basiert (#club #nightlife #[stadt wenn bekannt])
  * Event-spezifisch (#saturday #weekend etc.)
  * Reichweiten-Hashtags (#music #party #dance)
- Sprache: Deutsch für den Haupttext, englische Hashtags sind okay
- Länge: 150-250 Wörter ohne Hashtags`;

const STYLE_INTRO = {
  hype:
`Schreibe eine aggressive, energiegeladene Instagram Caption mit starkem FOMO-Effekt. Nutze Großschreibung für Betonung, viele Energie-Emojis (🔥⚡️💥🎉). Der Ton ist aufgedreht und mitreißend — der User soll das Gefühl haben er verpasst das Event des Jahres wenn er nicht kommt.`,
  elegant:
`Schreibe eine stilvolle, Premium-Instagram Caption. Wenige aber gezielte Emojis (✨🖤🎵). Ton: exklusiv, kultiviert, als würde man zu etwas Besonderem eingeladen. Kein Schreien, keine Übertreibung — pure Klasse.`,
  casual:
`Schreibe eine lockere, authentische Instagram Caption wie von einem echten Club-Insider. Freundlich, nahbar, als würde ein Freund einem anderen sagen 'hey, komm vorbei'. Emojis natürlich eingestreut (😊🎶🍹). Hashtags trotzdem vollständig und conversion-optimiert.`,
};

function buildUserPrompt(ev, style) {
  const intro = STYLE_INTRO[style] || STYLE_INTRO.hype;
  const f = (v) => clean(v) || "—";
  return [
    intro,
    "",
    "Event-Details:",
    `- Event: ${f(ev.wochentag)}, ${f(ev.datum)}`,
    `- Headline: ${f(ev.headline)}`,
    `- Subline: ${f(ev.subline)}`,
    `- DJs / Acts: ${f(ev.djs)}`,
    `- Uhrzeit: ${f(ev.uhrzeit)}`,
    `- Website: ${f(ev.website)}`,
    `- Zusätzlicher Vibe / Beschreibung: ${f(ev.vibe)}`,
    "",
    "Erstelle die Caption. Trenne den Hashtag-Block mit einer Leerzeile vom Haupttext. " +
      "Gib ausschließlich die fertige Caption aus — keine Vorbemerkung, keine Erklärung, keinen Gedankengang.",
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
