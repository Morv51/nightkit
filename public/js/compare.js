import { state } from "./state.js";
import { $ } from "./dom.js";

// Vorher/Nachher-Vergleich: blendet im Flyer-Rahmen weich (300ms opacity)
// zwischen dem leeren Ausgangs-Template (#beforeImg) und dem generierten Flyer
// (#resultImg) um. Im "Vorher"-Modus werden Downloads, Korrigieren, Formate,
// Video und Caption ausgegraut und gesperrt — nur der Toggle bleibt aktiv.
// Gesteuert über die Klasse `before-mode` auf #stateResult (siehe app.css).

const DISABLED_TIP = "Wechsle zurück zum fertigen Flyer";

let showingBefore = false;

function templateSrc() {
  const t = state.templates.find((x) => x.file === state.currentTemplateFile);
  return t ? t.src : "";
}

// Setzt das Vergleichsbild auf das aktuell gewählte Template (vor jeder neuen
// Anzeige aufgerufen, damit "Vorher" immer die passende Vorlage zeigt).
export function setBeforeImage() {
  const img = $("beforeImg");
  const src = templateSrc();
  if (img && src && img.getAttribute("src") !== src) img.src = src;
}

function apply() {
  const result = $("stateResult");
  if (result) result.classList.toggle("before-mode", showingBefore);

  const btn = $("btnCompare");
  if (btn) {
    btn.textContent = showingBefore ? "◑ Nachher" : "◑ Vorher";
    btn.classList.toggle("active", showingBefore);
    btn.setAttribute("aria-pressed", String(showingBefore));
  }

  // Tooltip auf den gesperrten Bereichen. Die inneren Bedienelemente sind per
  // CSS pointer-events:none, der Hover fällt auf den (weiter hoverbaren)
  // Container — dort sitzt der Hinweis.
  const tip = showingBefore ? DISABLED_TIP : "";
  const areas = [document.querySelector(".result-btns"), $("formatsBlock"), document.querySelector(".action-cards")];
  for (const el of areas) {
    if (!el) continue;
    if (tip) el.setAttribute("title", tip);
    else el.removeAttribute("title");
  }
}

function toggleCompare() {
  showingBefore = !showingBefore;
  apply();
}

// Zurück in den "Nachher"-Zustand (fertiger Flyer). Wird bei jedem
// State-Wechsel (neue Generierung, Template-Wechsel) aufgerufen.
export function exitBeforeMode() {
  showingBefore = false;
  apply();
}

export function initCompare() {
  const btn = $("btnCompare");
  if (btn) btn.addEventListener("click", toggleCompare);
}
