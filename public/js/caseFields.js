import { $, on } from "./dom.js";

// Schreibweise direkt im Eingabefeld, damit der Nutzer sieht, was auf dem Flyer
// landet. Bewusst als echte Wertaenderung und NICHT per CSS text-transform:
// gesendet werden soll genau das, was im Feld steht.
//
// Unberuehrt bleiben Datum, Uhrzeit und Vibe.

const GROSS = ["fName", "fPrefix", "fDj", "fClub", "fLocation"];
const KLEIN = ["fContact"];

const hoch = (s) => s.toUpperCase();
const runter = (s) => s.toLowerCase();

// Wandelt den Feldinhalt und setzt die Schreibmarke dorthin zurueck, wo sie
// inhaltlich stand -- wer mitten im Text korrigiert, wird nicht ans Ende
// geworfen.
//
// Die alte Zahl einfach wieder zu setzen reicht dafuer nicht: toUpperCase kann
// die Laenge aendern, das deutsche "ß" wird zu "SS". Deshalb wird der Text VOR
// der Marke mitgewandelt, und dessen neue Laenge ist die neue Position.
function wandle(el, fn) {
  if (!el) return;
  const alt = el.value;
  const neu = fn(alt);
  if (neu === alt) return; // nichts zu tun, Marke gar nicht erst anfassen

  const start = el.selectionStart;
  const ende = el.selectionEnd;
  el.value = neu;
  if (start === null || ende === null) return; // Feld ohne Auswahl-Schnittstelle

  const nStart = fn(alt.slice(0, start)).length;
  const nEnde = start === ende ? nStart : fn(alt.slice(0, ende)).length;
  try { el.setSelectionRange(nStart, nEnde); } catch (e) { /* egal */ }
}

// Einmal ueber alle verwalteten Felder. Wird auch von aussen gebraucht: ein
// programmatisch gesetzter Wert loest KEIN input-Ereignis aus, der Clubwechsel
// in clubs.js muss also selbst anstossen.
export function wandleAlleFelder() {
  for (const id of GROSS) wandle($(id), hoch);
  for (const id of KLEIN) wandle($(id), runter);
}

export function initCaseFields() {
  // input deckt Tippen, Einfuegen aus der Zwischenablage, Hineinziehen von Text
  // und das Rueckgaengigmachen gleichermassen ab -- alles laeuft durch dieselbe
  // Wandlung.
  for (const id of GROSS) on($(id), "input", (e) => wandle(e.target, hoch));
  for (const id of KLEIN) on($(id), "input", (e) => wandle(e.target, runter));
  // Was der Browser beim Laden wiederhergestellt hat, gleich angleichen.
  wandleAlleFelder();
}
