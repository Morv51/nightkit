// Vorher/Nachher-Vergleich über der Ergebnis-Bühne (beide Modi). Slider mit
// ziehbarer Trennlinie: links = Original-Upload (vorher), rechts = Ergebnis
// (nachher). Standardansicht bleibt das Ergebnis; der Vergleich erscheint auf
// Klick. Reines Frontend, additiv.

import { notify } from "./studioUi.js";

export function createCompare({ stage, getBefore }) {
  let overlay, beforeImg, handle, active = false, pos = 50;

  function apply() {
    // Vorher-Bild liegt oben und wird von links bis pos% gezeigt; rechts davon
    // scheint das darunterliegende Ergebnisbild der Bühne durch.
    beforeImg.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
    handle.style.left = pos + "%";
  }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "cmp-overlay";
    beforeImg = document.createElement("img");
    beforeImg.className = "cmp-before";
    beforeImg.alt = "";
    handle = document.createElement("div");
    handle.className = "cmp-handle";
    handle.innerHTML = '<span class="cmp-grip">⇄</span>';
    const labL = document.createElement("div"); labL.className = "cmp-lab cmp-lab-l"; labL.textContent = "Vorher";
    const labR = document.createElement("div"); labR.className = "cmp-lab cmp-lab-r"; labR.textContent = "Nachher";
    overlay.append(beforeImg, handle, labL, labR);
    stage.appendChild(overlay);

    const setFromX = (clientX) => {
      const r = overlay.getBoundingClientRect();
      pos = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
      apply();
    };
    let dragging = false;
    overlay.addEventListener("pointerdown", (e) => {
      dragging = true;
      try { overlay.setPointerCapture(e.pointerId); } catch {}
      setFromX(e.clientX);
    });
    overlay.addEventListener("pointermove", (e) => { if (dragging) setFromX(e.clientX); });
    overlay.addEventListener("pointerup", () => { dragging = false; });
    overlay.addEventListener("pointerleave", () => { dragging = false; });
  }

  function open(before) {
    if (!overlay) build();
    beforeImg.src = before;
    pos = 50; apply();
    overlay.style.display = "block";
    active = true;
  }

  function close() {
    if (overlay) overlay.style.display = "none";
    active = false;
  }

  // Button-Handler: schaltet den Vergleich an/aus.
  function toggle() {
    if (active) { close(); return false; }
    const before = getBefore && getBefore();
    if (!before) { notify("Noch kein Vergleich — erst ein Template bauen", "info"); return false; }
    open(before);
    return true;
  }

  return { toggle, close, isActive: () => active };
}
