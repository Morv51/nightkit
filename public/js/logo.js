import { state } from "./state.js";
import { els } from "./dom.js";

// Reads the chosen logo file, shows it in the form preview, and drops it into
// the flyer preview's overlay (replacing the dashed placeholder). Object URLs
// are revoked on replace to avoid leaks. Preview-only for now — the logo is
// not yet composited into the generated image.
export function initLogo() {
  if (!els.fLogo) return;
  els.fLogo.addEventListener("change", () => {
    const file = els.fLogo.files && els.fLogo.files[0];
    if (file) setLogo(URL.createObjectURL(file));
    else clearLogo();
  });
}

function setLogo(url) {
  if (state.logoUrl) URL.revokeObjectURL(state.logoUrl);
  state.logoUrl = url;

  if (els.logoPreview) {
    els.logoPreview.src = url;
    els.logoPreview.style.display = "block";
  }
  if (els.logoOverlayImg) els.logoOverlayImg.src = url;
  if (els.logoOverlay) els.logoOverlay.classList.add("has-logo");
}

function clearLogo() {
  if (state.logoUrl) {
    URL.revokeObjectURL(state.logoUrl);
    state.logoUrl = null;
  }
  if (els.logoPreview) {
    els.logoPreview.removeAttribute("src");
    els.logoPreview.style.display = "none";
  }
  if (els.logoOverlayImg) els.logoOverlayImg.removeAttribute("src");
  if (els.logoOverlay) els.logoOverlay.classList.remove("has-logo");
}
