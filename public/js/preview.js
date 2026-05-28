import { state } from "./state.js";
import { els, val } from "./dom.js";
import { getCurrentTemplate } from "./templates.js";

const previewImageCache = new Map();

function loadPreviewImage(src) {
  if (previewImageCache.has(src)) return previewImageCache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  previewImageCache.set(src, p);
  return p;
}

export function scheduleLiveUpdate() {
  clearTimeout(state.liveUpdateTimer);
  state.liveUpdateTimer = setTimeout(updateLivePreview, 180);
}

export async function updateLivePreview() {
  const t = getCurrentTemplate();
  if (!t || !t.src) return;

  let img;
  try { img = await loadPreviewImage(t.src); }
  catch { return; }

  const canvas = els.previewCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);

  const grad = ctx.createLinearGradient(0, H * 0.3, 0, H);
  grad.addColorStop(0,   "rgba(0,0,0,0)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.72)");
  grad.addColorStop(1,   "rgba(0,0,0,0.9)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";

  const name = val("fName");
  const day  = val("fDay");
  const date = val("fDate");
  const djs  = val("fDj");
  const dateStr = [day, date].filter(Boolean).join(" ");

  if (name) {
    ctx.font = "700 " + Math.round(W * 0.088) + "px 'DM Sans', sans-serif";
    ctx.fillStyle = "#F5F5F0";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 8;
    ctx.fillText(name.toUpperCase(), W / 2, H * 0.62);
  }
  if (dateStr) {
    ctx.font = "500 " + Math.round(W * 0.058) + "px 'DM Sans', sans-serif";
    ctx.fillStyle = "#E8FF47";
    ctx.shadowBlur = 6;
    ctx.fillText(dateStr.toUpperCase(), W / 2, H * 0.72);
  }
  if (djs) {
    const djArr = djs.split(",").map((d) => d.trim()).filter(Boolean).slice(0, 3);
    ctx.font = "400 " + Math.round(W * 0.048) + "px 'DM Sans', sans-serif";
    ctx.fillStyle = "rgba(245,245,240,0.75)";
    ctx.shadowBlur = 4;
    djArr.forEach((dj, i) => {
      ctx.fillText(dj.toUpperCase(), W / 2, H * 0.81 + i * Math.round(W * 0.058));
    });
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
}
