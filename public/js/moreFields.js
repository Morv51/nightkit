// Einklappbarer Optional-Bereich im Formular ("Weitere Details").
//
// Standardmäßig zugeklappt, damit der Nutzer zuerst nur die fünf Kernfelder
// sieht. Der Zustand wird in sessionStorage gemerkt. Hat der Nutzer bereits
// eines der optionalen Felder ausgefüllt (z. B. vor einem Template-Wechsel),
// bleibt der Bereich automatisch aufgeklappt.

const KEY = "nk_more_open";
const OPTIONAL_IDS = ["fContact", "fClub", "fLocation", "fVibe"];

export function initMoreFields() {
  const toggle = document.getElementById("moreToggle");
  const panel = document.getElementById("moreFields");
  if (!toggle || !panel) return;

  // Setzt den Zustand. Beim Aufklappen wird nach der Transition max-height auf
  // "none" gesetzt, damit dynamische Inhalte (z. B. Logo-Vorschau) nicht
  // abgeschnitten werden. `animate=false` für den initialen, ruckelfreien Stand.
  function setOpen(open, animate) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (!animate) {
      panel.style.transition = "none";
      panel.style.maxHeight = open ? "none" : "0";
      void panel.offsetHeight; // reflow
      panel.style.transition = "";
      return;
    }
    if (open) {
      panel.style.maxHeight = panel.scrollHeight + "px";
      const done = () => {
        if (toggle.getAttribute("aria-expanded") === "true") panel.style.maxHeight = "none";
        panel.removeEventListener("transitionend", done);
      };
      panel.addEventListener("transitionend", done);
    } else {
      panel.style.maxHeight = panel.scrollHeight + "px"; // von "none" auf festen Wert
      void panel.offsetHeight; // reflow erzwingen, damit die Transition greift
      panel.style.maxHeight = "0";
    }
  }

  function hasOptionalValue() {
    return OPTIONAL_IDS.some((id) => {
      const el = document.getElementById(id);
      return el && el.value && el.value.trim();
    });
  }

  // Startzustand: standardmäßig AUFGEKLAPPT; eine gespeicherte Wahl hat Vorrang,
  // und sobald ein optionales Feld befüllt ist, bleibt der Bereich offen.
  const stored = sessionStorage.getItem(KEY);
  let open = stored === null ? true : stored === "1";
  if (hasOptionalValue()) open = true;
  setOpen(open, false);

  toggle.addEventListener("click", () => {
    const next = toggle.getAttribute("aria-expanded") !== "true";
    setOpen(next, true);
    try { sessionStorage.setItem(KEY, next ? "1" : "0"); } catch (e) { /* sessionStorage evtl. blockiert */ }
  });
}
