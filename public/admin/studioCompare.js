// Vorher/Nachher als einfacher TOGGLE (kein Slider). Ein Klick zeigt das
// Original (vorher), nochmal Klick zurück zum generierten Ergebnis (nachher).
// Das komplette Ergebnisbild wird umgeschaltet. Standard bleibt das Ergebnis.
// Reines Frontend, additiv.

import { notify } from "./studioUi.js";

export function createCompare({ resultImg, getBefore, getAfter, button }) {
  let showingBefore = false;
  let badge;

  function ensureBadge() {
    if (badge || !resultImg || !resultImg.parentElement) return;
    badge = document.createElement("div");
    badge.className = "cmp-badge";
    badge.textContent = "Vorher · Original";
    resultImg.parentElement.appendChild(badge);
  }

  function showAfter() {
    const after = getAfter && getAfter();
    if (after) resultImg.src = after;
    showingBefore = false;
    if (badge) badge.style.display = "none";
    if (button) button.classList.remove("active");
  }

  function toggle() {
    if (showingBefore) { showAfter(); return false; }
    const before = getBefore && getBefore();
    if (!before) { notify("Noch kein Vergleich — erst ein Template bauen", "info"); return false; }
    ensureBadge();
    resultImg.src = before;
    showingBefore = true;
    if (badge) badge.style.display = "block";
    if (button) button.classList.add("active");
    return true;
  }

  // Bei neuem Ergebnis/Build zurück in den Nachher-Zustand (Badge/Active weg).
  function reset() {
    showingBefore = false;
    if (badge) badge.style.display = "none";
    if (button) button.classList.remove("active");
  }

  return { toggle, reset, isBefore: () => showingBefore };
}
