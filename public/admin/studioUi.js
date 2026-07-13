// Geteilte UI-Helfer fürs Template Studio (beide Modi).

const MAX = 10 * 1024 * 1024;
const MAX_EDGE = 2048; // lange Kante beim Herunterrechnen (Konvertierungs-/Downscale-Pfad)
const STD_TYPE = /^image\/(png|jpe?g|webp)$/;

// Datei -> dataURL. Standardformate (PNG/JPG/WebP) unter dem Limit werden EXAKT wie
// bisher 1:1 gelesen (Rechner-Weg unverändert, keine Neucodierung). Alles andere —
// vor allem iPhone-Fotos im HEIC/HEIF-Format oder sehr große Bilder — wird über ein
// Canvas verlustarm nach JPG konvertiert und bei Bedarf auf MAX_EDGE heruntergerechnet.
// In iOS Safari dekodiert das System HEIC, sodass das Bild geladen werden kann; die
// weitere Verarbeitung (Analyse, Generierung) bekommt damit immer ein JPG/PNG/WebP.
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("Keine Datei gewählt"));
    const type = file.type || "";
    // Unveränderter Standardpfad (Rechner: Drag-and-Drop, Einfügen, Klicken).
    if (STD_TYPE.test(type) && file.size <= MAX) {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("Datei konnte nicht gelesen werden"));
      r.readAsDataURL(file);
      return;
    }
    // Muss überhaupt ein Bild sein (Typ ODER Dateiendung) — sonst klare Meldung.
    const looksImage = type.startsWith("image/") || type === "" ||
      /\.(heic|heif|png|jpe?g|webp|gif|bmp|tiff?|avif)$/i.test(file.name || "");
    if (!looksImage) return reject(new Error("Nur Bilddateien: JPG, PNG, WebP oder HEIC (iPhone)"));
    convertImageFile(file).then(resolve, reject);
  });
}

// HEIC/HEIF oder zu große Bilder über ein Canvas nach JPG bringen (weißer Hintergrund,
// da JPG kein Alpha kann) und auf MAX_EDGE herunterrechnen. Fehler = klare Meldung
// statt stillem Fehlschlag.
function convertImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) throw new Error("leer");
        const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        const c = document.createElement("canvas");
        c.width = cw; c.height = ch;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.92));
      } catch (_) {
        URL.revokeObjectURL(url);
        reject(new Error("Bild konnte nicht verarbeitet werden. Bitte als JPG oder PNG hochladen."));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Dieses Format ließ sich hier nicht öffnen (evtl. HEIC auf einem Nicht-Apple-Gerät). Bitte als JPG oder PNG hochladen."));
    };
    img.src = url;
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

// Drag-and-Drop auf eine Dropzone: Highlight beim Drüberziehen, Datei an den
// Handler. Der Klick-Dialog (Label) bleibt als Fallback unberührt.
export function wireDropzone(el, handler) {
  if (!el) return;
  const over = (e) => { e.preventDefault(); el.classList.add("dragover"); };
  const leave = (e) => { e.preventDefault(); el.classList.remove("dragover"); };
  el.addEventListener("dragenter", over);
  el.addEventListener("dragover", over);
  el.addEventListener("dragleave", leave);
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("dragover");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handler(f);
  });
}

// Wie wireDropzone, aber gibt ALLE gedroppten Dateien (FileList) an den Handler —
// für Mehrfach-Upload (Modus 2). Lässt wireDropzone (Einzeldatei, Modus 1) unberührt.
export function wireDropzoneMulti(el, handler) {
  if (!el) return;
  const over = (e) => { e.preventDefault(); el.classList.add("dragover"); };
  const leave = (e) => { e.preventDefault(); el.classList.remove("dragover"); };
  el.addEventListener("dragenter", over);
  el.addEventListener("dragover", over);
  el.addEventListener("dragleave", leave);
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("dragover");
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) handler(files);
  });
}

// Paste (Cmd/Ctrl+V) eines Bildes aus der Zwischenablage — nur wenn das
// zugehörige Panel gerade sichtbar ist (aktiver Tab).
export function wirePaste(panelEl, handler) {
  document.addEventListener("paste", (e) => {
    if (!panelEl || panelEl.hidden) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.indexOf("image/") === 0) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); handler(f); return; }
      }
    }
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
