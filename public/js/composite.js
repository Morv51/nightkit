import { state } from "./state.js";

// Burns the uploaded logo into the generated flyer at the position/size the
// user placed it (state.logoBox: centre cx/cy + width, as fractions of the
// flyer, dazu inv fuer die Invertierung). Both images are CORS-clean
// (proxied result + same-origin object URL), so the canvas isn't tainted
// and the result stays downloadable.

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden: " + src));
    img.src = src;
  });
}

// Invertiert das Logo fuer das ERGEBNIS, passend zum CSS-Filter der Vorschau.
// ctx.filter kann das direkt, wird aber nicht ueberall gefuehrt (Safari erst ab
// 17) und faellt dort still auf "none" zurueck -- dann saehe der fertige Flyer
// anders aus als die Buehne. Deshalb wird zur Laufzeit geprueft und sonst
// dieselbe Rechnung von Hand gemacht: 255 minus Kanal, Alpha bleibt.
//
// Gezeichnet wird auf einen eigenen Canvas, der NUR das Logo traegt. Das haelt
// die Basispixel heraus, und getImageData kann nicht an einem verunreinigten
// Canvas scheitern.
function invertiertesLogo(logo, w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d");

  ctx.filter = "invert(1)";
  if (ctx.filter === "invert(1)") {   // Zuruecklesen: greift der Filter wirklich?
    ctx.drawImage(logo, 0, 0, c.width, c.height);
    return c;
  }

  ctx.filter = "none";
  ctx.drawImage(logo, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i]     = 255 - d.data[i];
    d.data[i + 1] = 255 - d.data[i + 1];
    d.data[i + 2] = 255 - d.data[i + 2];
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

export async function compositeLogo(baseSrc, logoSrc) {
  const [base, logo] = await Promise.all([loadImage(baseSrc), loadImage(logoSrc)]);
  const W = base.naturalWidth;
  const H = base.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(base, 0, 0, W, H);

  const box = state.logoBox || { cx: 0.5, cy: 0.15, w: 0.3 };
  const w = box.w * W;
  const h = w * (logo.naturalHeight / logo.naturalWidth); // preserve logo aspect
  const cx = box.cx * W;
  const cy = box.cy * H;
  // box.inv fehlt bei aelteren gespeicherten Boxen -- undefined gilt als "nicht
  // invertiert", das Ergebnis bleibt fuer sie unveraendert.
  const quelle = box.inv ? invertiertesLogo(logo, w, h) : logo;
  ctx.drawImage(quelle, cx - w / 2, cy - h / 2, w, h);

  return canvas.toDataURL("image/png");
}
