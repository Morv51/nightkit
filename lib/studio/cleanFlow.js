"use strict";

// Clean-Flow: ein KURZER, freier Bildprompt fuer gpt-image (editImage, Original als Eingabe).
// Bewusst eigenstaendig — erbt NICHTS von den Auto-Flows, dem Handpfad, dem Regelwerk oder der
// Textzonen-Erkennung. Das Modell ordnet die Platzhalter selbst frei zu; genau das ist gewollt.
//
// GRUNDPRINZIP (nicht verhandelbar): der Prompt bleibt so KURZ wie moeglich. gpt-image verliert
// bei zu langen Prompts die Faehigkeit, allen Anweisungen zu folgen, und die Komposition leidet
// (genau das Problem des langen Regelwerk-Prompts). Wird hier je etwas ergaenzt, immer pruefen,
// ob dafuer etwas gekuerzt werden kann. Im Zweifel weglassen. Dieser Text ist die Referenzlaenge
// und sollte nicht deutlich ueberschritten werden.
const CLEAN_PROMPT =
`Rebuild this flyer as a reusable event-flyer template. This is a fillable template, every text stays a placeholder.

Keep the exact same design, style, fonts, colours and composition as the original. Keep the person and all graphic elements fully intact and never covered by text. The text must sit in the free zones of the artwork and complement the graphics — text and image form ONE composition, never foreign elements stamped on top.

Replace the texts with these placeholders, each rendered exactly as written, kept as placeholders (not real values): HEADLINE, SUBLINE, 19.06.2026, UHRZEIT, LOCATION, DJ NAME 1, DJ NAME 2, DJ NAME 3, CLUBNAME, www.website.com

Set the TEXT with real typographic craft: a strong dominant headline, deliberate size hierarchy between the groups, clean letter-spacing and alignment, generous spacing — like a professional designer set the type, never a flat even list.

Format exactly 9:16 vertical. If the original has a different ratio, extend the design naturally to fill 9:16, matching the background with no visible seams. Remove all club logos and emblems, blending the area cleanly into the background; render CLUBNAME as plain text only.

Render every placeholder word literally as written. Never turn UHRZEIT into a clock time, LOCATION into a venue, or the DJ slots into real names.`;

module.exports = { CLEAN_PROMPT };
