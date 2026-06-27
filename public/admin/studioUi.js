// Geteilte UI-Helfer fürs Template Studio (beide Modi).

const MAX = 10 * 1024 * 1024;

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("Keine Datei gewählt"));
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error("Nur PNG, JPG oder WebP"));
    if (file.size > MAX) return reject(new Error("Bild zu groß (max. 10 MB)"));
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Datei konnte nicht gelesen werden"));
    r.readAsDataURL(file);
  });
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// PNG/beliebige dataURL → JPG dataURL in voller Auflösung (weißer Hintergrund,
// da JPG kein Alpha kann).
export function toJpeg(dataUrl, quality = 0.95) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Bild konnte nicht konvertiert werden"));
    img.src = dataUrl;
  });
}

let toastTimer;
export function notify(msg, type = "info") {
  let el = document.getElementById("studioToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "studioToast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = "studio-toast show" + (type === "error" ? " err" : type === "success" ? " ok" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "studio-toast"; }, 4200);
}
