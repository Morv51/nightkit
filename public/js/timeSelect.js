import { $, on } from "./dom.js";

// Uhrzeit: Auswahlliste statt Freitext. Sichtbar sind das Dropdown und — nur
// wenn "Andere Uhrzeit" gewaehlt ist — ein Textfeld darunter. Beide schreiben
// ihren Wert in das versteckte #fTime, das generator.js und caption.js
// unveraendert per val("fTime") auslesen.
//
// Gleiches Muster wie beim Datum: #fDatePicker ist sichtbar, #fDate haelt den
// Wert, den der Rest der App liest (siehe datepicker.js).

const ANDERE = "custom";

function setzeWert(text) {
  const ziel = $("fTime");
  if (ziel) ziel.value = text || "";
}

// Haelt Textfeld und #fTime im Einklang mit der Auswahl.
function uebernehmen(fokussieren) {
  const sel = $("fTimeSelect");
  const frei = $("fTimeCustom");
  if (!sel || !frei) return;
  if (sel.value === ANDERE) {
    frei.hidden = false;
    setzeWert(frei.value.trim());
    if (fokussieren) frei.focus();
  } else {
    frei.hidden = true;
    frei.value = "";       // nichts Unsichtbares stehen lassen
    setzeWert(sel.value);  // leerer Eintrag ergibt leeren Wert
  }
}

export function initTimeSelect() {
  const sel = $("fTimeSelect");
  const frei = $("fTimeCustom");
  if (!sel || !frei) return;
  on(sel, "change", () => uebernehmen(true));
  on(frei, "input", () => setzeWert(frei.value.trim()));
  uebernehmen(false); // Startzustand aus dem Markup ableiten, ohne Fokusklau
}
