"use strict";

// Redesign v2, Bauteil 5: der Modus-Schalter. Bewusst eine REPO-Konstante, keine ENV-Variable —
// so ist der Standard eingefroren und im Diff sichtbar, nicht in der Render-Konfiguration versteckt.
//   'core'   — der neue Prompt-Kern (prompts/core.js) + Karten-Rotation + Familie. Kein Sonnet-
//              Regie-Aufruf (cleanRedesignSpecs) mehr, die Karten ersetzen die Regie.
//   'legacy' — der bisherige Weg: Sonnet-Regie (13 Felder, REDESIGN_DIRECTIONS) -> cleanFlow.
// Beide Wege leben nebeneinander; 'legacy' bleibt unangetastet erreichbar.
const REDESIGN_PROMPT_MODE = "core";

module.exports = { REDESIGN_PROMPT_MODE };
