// Wiederverwendbares Tooltip-System für die "i"-Icons (.hint mit data-tip).
// Ein einziges fixed-positioniertes Tooltip-Element für die ganze Seite:
// so kann nichts von Sidebar-Scrollern abgeschnitten werden und die Box
// wird am Viewport-Rand sauber eingeklemmt (der Pfeil zeigt trotzdem aufs
// Icon). Desktop: Hover. Mobile: Tap toggelt, Tap außerhalb schließt.

let tip = null;
let current = null;

function ensureTip() {
  if (tip) return tip;
  tip = document.createElement("div");
  tip.className = "tip-box";
  tip.innerHTML = '<div class="tip-arrow"></div><div class="tip-text"></div>';
  document.body.appendChild(tip);
  return tip;
}

function show(el) {
  ensureTip();
  current = el;
  tip.querySelector(".tip-text").textContent = el.dataset.tip || "";
  tip.classList.add("on");

  // Erst messen, dann über dem Icon platzieren (unterhalb, wenn oben kein
  // Platz ist) und horizontal am Viewport einklemmen.
  tip.style.left = "0px";
  tip.style.top = "0px";
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(10, Math.min(x, window.innerWidth - w - 10));
  let y = r.top - h - 9;
  const below = y < 8;
  if (below) y = r.bottom + 9;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
  tip.classList.toggle("below", below);
  tip.style.setProperty("--arrow-x", (r.left + r.width / 2 - x) + "px");
}

function hide() {
  current = null;
  if (tip) tip.classList.remove("on");
}

export function initHints() {
  document.addEventListener("pointerover", (e) => {
    const h = e.target.closest(".hint");
    if (h && e.pointerType === "mouse") show(h);
  });
  document.addEventListener("pointerout", (e) => {
    if (e.target.closest(".hint") && e.pointerType === "mouse") hide();
  });
  document.addEventListener("click", (e) => {
    const h = e.target.closest(".hint");
    if (h) {
      e.preventDefault();
      e.stopPropagation();
      // Touch/Stift: Tap toggelt. Maus: Klick zeigt einfach (Hover läuft eh).
      if (current === h && e.pointerType !== "mouse") hide();
      else show(h);
    } else if (current) {
      hide(); // Tap/Klick außerhalb schließt
    }
  });
  // Tastatur-Fokus (Barrierefreiheit)
  document.addEventListener("focusin", (e) => {
    const h = e.target.closest && e.target.closest(".hint");
    if (h) show(h);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target.closest && e.target.closest(".hint")) hide();
  });
  // Beim Scrollen/Resizen würde die Position veralten → ausblenden.
  document.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
}
