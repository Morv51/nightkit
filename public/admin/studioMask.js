// Masken + Composite fürs maskierte Editieren (Modus 1). Sorgt dafür, dass NUR
// die Textzonen geändert werden und alles andere (Gesichter, Komposition,
// Hintergrund) pixelgenau aus dem Original übernommen wird.

function loadImg(dataUrl) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Bild konnte nicht gelesen werden"));
    i.src = dataUrl;
  });
}

// Normierte bbox [x,y,w,h] → Pixel-Rechteck mit Polsterung, geklemmt.
function rectFromBbox(b, w, h, pad) {
  const x = Math.max(0, b[0] - pad) * w;
  const y = Math.max(0, b[1] - pad) * h;
  const rw = Math.min(1, b[2] + 2 * pad) * w - Math.max(0, -(b[0] - pad)) * w;
  const rh = Math.min(1, b[3] + 2 * pad) * h - Math.max(0, -(b[1] - pad)) * h;
  return [x, y, Math.min(rw, w - x), Math.min(rh, h - y)];
}

// Maske in den Maßen des Bildes. editBlack=true → zu editierende Zonen SCHWARZ,
// Rest WEISS (Ideogram-V3-Konvention laut Doku). Bei Bedarf umstellbar.
export async function buildZoneMask(dataUrl, bboxes, { pad = 0.012, editBlack = true } = {}) {
  const img = await loadImg(dataUrl);
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = editBlack ? "#FFFFFF" : "#000000"; // behalten
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = editBlack ? "#000000" : "#FFFFFF"; // editieren
  for (const b of bboxes || []) {
    if (!Array.isArray(b) || b.length !== 4) continue;
    const [x, y, rw, rh] = rectFromBbox(b, w, h, pad);
    ctx.fillRect(x, y, rw, rh);
  }
  return c.toDataURL("image/png");
}

// Composite: Original als Basis, NUR die bbox-Regionen aus dem editierten Bild
// übernehmen. Außerhalb der Boxen bleiben die Original-Pixel erhalten. Liefert
// PNG (verlustfrei). edited darf andere Maße haben — wird passend kopiert.
export async function compositeRegions(originalDataUrl, editedDataUrl, bboxes, pad = 0.012) {
  const [orig, edited] = await Promise.all([loadImg(originalDataUrl), loadImg(editedDataUrl)]);
  const w = orig.naturalWidth, h = orig.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(orig, 0, 0, w, h);
  const sx = edited.naturalWidth / w, sy = edited.naturalHeight / h;
  for (const b of bboxes || []) {
    if (!Array.isArray(b) || b.length !== 4) continue;
    const [x, y, rw, rh] = rectFromBbox(b, w, h, pad);
    ctx.drawImage(edited, x * sx, y * sy, rw * sx, rh * sy, x, y, rw, rh);
  }
  return c.toDataURL("image/png");
}
