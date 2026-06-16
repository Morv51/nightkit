import { $ } from "./dom.js";

// Aufklappbare Sektionen (Video Export, Instagram Caption) für die Progressive
// Disclosure auf der Ergebnisseite. Standardmäßig zugeklappt. Der Zustand wird
// pro Sektion in sessionStorage gehalten und beim Laden wiederhergestellt.
// Die Höhe wird über max-height animiert (300ms): beim Öffnen scrollHeight →
// "none" (damit dynamische Inhalte wie Video-Preview/Caption frei wachsen),
// beim Schließen aktuelle Höhe → 0.

const SECTIONS = ["videoSection", "captionSection"];

function bodyOf(section) { return section.querySelector(".disclosure-body"); }

function setOpen(section, open, animate = true) {
  const body = bodyOf(section);
  if (!body) return;
  section.classList.toggle("open", open);
  const head = section.querySelector(".disclosure-head");
  if (head) head.setAttribute("aria-expanded", String(open));

  if (!animate) {
    body.style.maxHeight = open ? "none" : "0px";
    return;
  }
  if (open) {
    body.style.maxHeight = body.scrollHeight + "px";
    const done = () => { body.style.maxHeight = "none"; body.removeEventListener("transitionend", done); };
    body.addEventListener("transitionend", done);
  } else {
    body.style.maxHeight = body.scrollHeight + "px"; // explizite Starthöhe …
    requestAnimationFrame(() => { body.style.maxHeight = "0px"; }); // … dann auf 0
  }
}

function store(section, open) {
  const key = section.dataset.store;
  if (!key) return;
  try { sessionStorage.setItem(key, open ? "1" : "0"); } catch {}
}

function isStoredOpen(section) {
  const key = section.dataset.store;
  if (!key) return false;
  try { return sessionStorage.getItem(key) === "1"; } catch { return false; }
}

function toggle(section) {
  const open = !section.classList.contains("open");
  setOpen(section, open);
  store(section, open); // bewusste Nutzer-Wahl merken (überlebt Reload)
}

// Beim Neu-Generieren beide Sektionen zuklappen (frischer Flyer = ruhiger
// Einstieg). Läuft, solange der Result-State noch verborgen ist → ohne
// Animation. Die sessionStorage-Präferenz bleibt unangetastet, damit eine
// bewusst geöffnete Sektion nach einem Reload wieder aufgeht.
export function resetDisclosures() {
  for (const id of SECTIONS) {
    const s = $(id);
    if (s) setOpen(s, false, false);
  }
}

export function initDisclosure() {
  for (const id of SECTIONS) {
    const section = $(id);
    if (!section) continue;
    const head = section.querySelector(".disclosure-head");
    if (head) {
      head.addEventListener("click", () => toggle(section));
      head.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(section); }
      });
    }
    setOpen(section, isStoredOpen(section), false); // Anfangszustand ohne Animation
  }
}
