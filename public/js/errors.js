import { els } from "./dom.js";

export function showErr(message) {
  if (!els.errBox) return;
  els.errBox.style.display = "block";
  els.errBox.textContent = message;
}

export function clearErr() {
  if (els.errBox) els.errBox.style.display = "none";
}
