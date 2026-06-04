import { els } from "./dom.js";

// Drives the weekday + flyer date from a native <input type="date">, so the
// user can never mistype them. The picker holds an ISO date (YYYY-MM-DD); we
// derive the German weekday into the read-only fDay field and a DD.MM.YYYY
// string into the hidden fDate field that the generator already reads.

const WEEKDAYS_DE = [
  "Sonntag", "Montag", "Dienstag", "Mittwoch",
  "Donnerstag", "Freitag", "Samstag",
];

const pad = (n) => String(n).padStart(2, "0");

function applyDate(iso) {
  if (!iso) {
    if (els.fDay) els.fDay.value = "";
    if (els.fDate) els.fDate.value = "";
    return;
  }
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d); // local time — no timezone shift
  if (els.fDay) els.fDay.value = WEEKDAYS_DE[date.getDay()];
  if (els.fDate) els.fDate.value = `${pad(d)}.${pad(m)}.${y}`;
}

export function initDatePicker() {
  const picker = els.fDatePicker;
  if (!picker) return;
  picker.addEventListener("change", () => applyDate(picker.value));
  applyDate(picker.value); // seed fDay/fDate from the picker's initial value
}
