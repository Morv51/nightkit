import { $, val } from "./dom.js";
import { postCaption } from "./api.js";

// Instagram caption generator. The whole UI lives inside the result panel, so
// it only appears after a flyer has been generated. Reads the same event form
// the generator uses, plus the new "Vibe" field, and a selected style.

export function initCaption() {
  const genBtn = $("btnCaption");
  if (!genBtn) return;

  const styles = $("captionStyles");
  if (styles) {
    styles.addEventListener("click", (e) => {
      const btn = e.target.closest(".cap-style");
      if (!btn) return;
      styles.querySelectorAll(".cap-style").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  }

  genBtn.addEventListener("click", generateCaption);

  const copyBtn = $("captionCopy");
  if (copyBtn) copyBtn.addEventListener("click", copyCaption);

  const regen = $("captionRegen");
  if (regen) regen.addEventListener("click", (e) => { e.preventDefault(); generateCaption(); });
}

function currentStyle() {
  const active = document.querySelector(".cap-style.active");
  return active ? active.dataset.style : "hype";
}

async function generateCaption() {
  const btn = $("btnCaption");
  if (!btn || btn.disabled) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Wird generiert…';

  const box = $("captionBox");
  try {
    const caption = await postCaption({
      headline: val("fName"),
      subline:  val("fPrefix"),
      datum:    val("fDate"),
      wochentag: val("fDay"),
      djs:      val("fDj"),
      uhrzeit:  val("fTime"),
      website:  val("fContact"),
      vibe:     val("fVibe"),
      style:    currentStyle(),
    });
    $("captionText").textContent = caption;
    box.style.display = "block";
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    $("captionText").textContent = "⚠ " + (e.message || "Caption konnte nicht erstellt werden.");
    box.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function copyCaption() {
  const btn = $("captionCopy");
  const text = $("captionText").textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "✓ Kopiert!";
    btn.classList.add("copied");
  } catch {
    btn.textContent = "Fehler";
  }
  setTimeout(() => { btn.textContent = "⎘ Kopieren"; btn.classList.remove("copied"); }, 2000);
}
