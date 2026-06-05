import { state } from "./state.js";

// Burns the uploaded logo into the generated flyer at the position/size the
// user placed it (state.logoBox: centre cx/cy + width, as fractions of the
// flyer). Both images are CORS-clean (proxied result + same-origin object
// URL), so the canvas isn't tainted and the result stays downloadable.

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden: " + src));
    img.src = src;
  });
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
  ctx.drawImage(logo, cx - w / 2, cy - h / 2, w, h);

  return canvas.toDataURL("image/png");
}
