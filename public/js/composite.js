// Burns the uploaded logo into the generated flyer at the same bottom-right
// position as the live preview overlay, returning a PNG data URL. The base
// (proxied result, CORS-clean) and the logo (same-origin object URL) can both
// be drawn without tainting the canvas, so the output stays downloadable.
//
// Keep LOGO_BOX in sync with the .logo-overlay rule in css/app.css. The box
// is centred on the template's "CLUB LOGO" area (top centre).

const LOGO_BOX = { cxPct: 0.49, cyPct: 0.135, widthPct: 0.34, heightPct: 0.11, fit: 0.92 };

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

  const boxW = W * LOGO_BOX.widthPct;
  const boxH = H * LOGO_BOX.heightPct;
  const scale = Math.min(
    (boxW * LOGO_BOX.fit) / logo.naturalWidth,
    (boxH * LOGO_BOX.fit) / logo.naturalHeight
  );
  const w = logo.naturalWidth * scale;
  const h = logo.naturalHeight * scale;
  const cx = W * LOGO_BOX.cxPct;
  const cy = H * LOGO_BOX.cyPct;

  ctx.drawImage(logo, cx - w / 2, cy - h / 2, w, h);

  return canvas.toDataURL("image/png");
}
