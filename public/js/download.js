import { state } from "./state.js";
import { els, val } from "./dom.js";

function flyerBaseName() {
  return (val("fName") || "flyer").replace(/\s+/g, "-").toLowerCase();
}

export function download(fmt) {
  if (!state.last) return;
  const a = document.createElement("a");
  a.download = flyerBaseName() + "." + fmt;
  a.href = state.last;
  a.click();
}

export async function copyImage() {
  if (!state.last) return;
  const btn = els.copyBtn;
  try {
    const res = await fetch(state.last);
    const blob = await res.blob();
    let pngBlob = blob;
    if (blob.type !== "image/png") {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      pngBlob = await new Promise((r) => c.toBlob(r, "image/png"));
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    btn.textContent = "✓ Kopiert";
    btn.classList.add("copy-ok");
    setTimeout(() => {
      btn.textContent = "⎘ Kopieren";
      btn.classList.remove("copy-ok");
    }, 2000);
  } catch {
    btn.textContent = "⚠ Fehler";
    setTimeout(() => { btn.textContent = "⎘ Kopieren"; }, 2000);
  }
}
