// Video effect registry. Every effect is a `draw(ctx, W, H, t, img)` function
// where t goes 0→1 over exactly 10s / 300 frames. Effects are template-agnostic
// and resolution-independent: pixel sizes are scaled by `s = H / 1280` so they
// look the same whether rendered into the small preview or the full-size export.
// The base image is always drawn at the exact canvas size (0,0,W,H) so the
// flyer fills the frame with no padding or visible background.
//
// Adding a style: append to STYLES. The button row, preview and export all read
// from it — no other file changes.

// ── shared helpers ───────────────────────────────────────────────
const lerp = (a, b, x) => a + (b - a) * x;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function fillBlack(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
}

// White-ish pixel noise (VHS / film grain). `density` is the fraction of pixels
// touched; scales with area so the preview stays cheap.
function drawNoise(ctx, W, H, maxAlpha, density = 0.0012) {
  const count = Math.floor(W * H * density);
  ctx.save();
  ctx.fillStyle = "#fff";
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = Math.random() * maxAlpha;
    ctx.fillRect((Math.random() * W) | 0, (Math.random() * H) | 0, 1, 1);
  }
  ctx.restore();
}

// Per-image RGB channel canvases for the glitch split, cached so the export
// builds them once and reuses them across all 300 frames.
const channelCache = new WeakMap();
function getChannels(img, W, H) {
  const cached = channelCache.get(img);
  if (cached && cached.W === W && cached.H === H) return cached;
  const make = (color) => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, W, H);
    x.globalCompositeOperation = "multiply"; // keep only this colour channel
    x.fillStyle = color;
    x.fillRect(0, 0, W, H);
    return c;
  };
  const entry = { W, H, r: make("#ff0000"), g: make("#00ff00"), b: make("#0000ff") };
  channelCache.set(img, entry);
  return entry;
}

// ── GLITCH (template-agnostic, hard club look) ───────────────────
function drawGlitch(ctx, W, H, t, img) {
  const s = H / 1280;
  const frame = Math.round(t * 300);
  ctx.clearRect(0, 0, W, H);
  if (!img || !img.complete) { fillBlack(ctx, W, H); return; }

  // intensity curve: 0–2s build up, 2–8s full, 8–10s ease out
  const intensity = clamp01(t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1);

  // brief screen shake (2–3 frames at a time)
  let shx = 0, shy = 0;
  if (intensity > 0.3 && frame % 24 < 3) {
    shx = (Math.random() - 0.5) * 10 * s * intensity;
    shy = (Math.random() - 0.5) * 10 * s * intensity;
  }

  // RGB split — three channel copies, slight horizontal offset, opacity ~0.85.
  // Overscan by M so neither the split nor the shake ever reveals a background.
  const off = (2 + 6 * intensity) * s;
  const M = 14 * s;
  const ch = getChannels(img, W, H);
  const dw = W + 2 * M, dh = H + 2 * M, bx = -M + shx, by = -M + shy;

  fillBlack(ctx, W, H);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.85;
  ctx.drawImage(ch.r, bx - off, by, dw, dh);
  ctx.drawImage(ch.g, bx,        by, dw, dh);
  ctx.drawImage(ch.b, bx + off,  by, dw, dh);
  ctx.restore();

  // scanlines: 2px line every 4px
  const step = Math.max(2, Math.round(4 * s));
  const lh = Math.max(1, Math.round(2 * s));
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  for (let y = 0; y < H; y += step) ctx.fillRect(0, y, W, lh);

  // random glitch slices ~every 4 frames: displace a horizontal strip
  if (intensity > 0.2 && frame % 4 === 0) {
    const slices = 1 + Math.floor(Math.random() * 2);
    for (let k = 0; k < slices; k++) {
      const sh = (10 + Math.random() * 30) * s;
      const sy = Math.random() * (H - sh);
      const dir = Math.random() < 0.5 ? -1 : 1;
      const dx = dir * (10 + Math.random() * 20) * s * intensity;
      ctx.drawImage(ctx.canvas, 0, sy, W, sh, dx, sy, W, sh);
    }
  }

  // VHS noise
  drawNoise(ctx, W, H, 0.05 + 0.1 * intensity);
}

// ── NEON PULSE (club atmosphere, always fullscreen) ──────────────
function drawNeon(ctx, W, H, t, img) {
  const s = H / 1280;
  const frame = Math.round(t * 300);
  ctx.clearRect(0, 0, W, H);
  if (!img || !img.complete) { ctx.fillStyle = "#08080f"; ctx.fillRect(0, 0, W, H); return; }

  // Ken Burns — scale stays in [1.05, 1.1], NEVER below 1.0, so no edge shows.
  const scale = 1.05 + 0.05 * Math.sin(t * Math.PI); // 1.05 → 1.1 → 1.05
  const dw = W * scale, dh = H * scale;
  const maxPanX = (dw - W) / 2, maxPanY = (dh - H) / 2;
  const panX = Math.sin(t * Math.PI * 2 * 0.35) * maxPanX * 0.8;
  const panY = Math.cos(t * Math.PI * 2 * 0.25) * maxPanY * 0.8;
  const dx = (W - dw) / 2 + panX, dy = (H - dh) / 2 + panY;
  ctx.drawImage(img, dx, dy, dw, dh);

  // soft bloom
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.22;
  ctx.filter = `blur(${10 * s}px)`;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();

  // neon colour wash, pulsing pink ↔ cyan
  const mix = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 3);
  const r = Math.round(lerp(255, 0, mix));
  const g = Math.round(lerp(0, 255, mix));
  const b = Math.round(lerp(170, 255, mix));
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // strobe beat: a quick flash every 0.5s (15 frames), 3-frame envelope
  const ph = frame % 15;
  if (ph < 3) {
    const a = [0.12, 0.3, 0.12][ph];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.62);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ── SMOOTH REVEAL (cinematic, dramatic) ──────────────────────────
function drawReveal(ctx, W, H, t, img) {
  const s = H / 1280;
  ctx.clearRect(0, 0, W, H);
  if (!img || !img.complete) { fillBlack(ctx, W, H); return; }

  if (t < 0.2) {
    // Phase 1 (0–2s): light streak wipes top→bottom, revealing the image behind.
    const p = t / 0.2;
    const lineY = p * H;
    ctx.drawImage(img, 0, 0, W, H);
    fillBlack2(ctx, 0, lineY, W, H - lineY); // not-yet-revealed area stays black
    const glowH = 80 * s;
    const grad = ctx.createLinearGradient(0, lineY - glowH, 0, lineY);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(255,255,255,0.25)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, lineY - glowH, W, glowH);
    const streak = 20 * s;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(0, lineY - streak / 2, W, streak);
    return;
  }

  // Phase 2 (2–8s): slow zoom 1.0 → 1.03 + film grain. Phase 3 freezes at 1.03.
  const scale = t < 0.8 ? 1.0 + 0.03 * ((t - 0.2) / 0.6) : 1.03;
  const dw = W * scale, dh = H * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  drawNoise(ctx, W, H, 0.06);

  // Phase 3 (8–10s): three quick blinks, then hold.
  if (t >= 0.8) {
    const tp = (t - 0.8) / 0.2;
    let blink = 0;
    for (const c of [0.12, 0.28, 0.44]) {
      const d = Math.abs(tp - c);
      if (d < 0.035) blink = Math.max(blink, 1 - d / 0.035);
    }
    if (blink > 0) {
      ctx.fillStyle = `rgba(0,0,0,${blink * 0.8})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
}

function fillBlack2(ctx, x, y, w, h) {
  ctx.fillStyle = "#000";
  ctx.fillRect(x, y, w, h);
}

export const STYLES = [
  { id: "horror", name: "Glitch", icon: "⚡", draw: drawGlitch },
  { id: "pulse",  name: "Neon",   icon: "🔮", draw: drawNeon   },
  { id: "reveal", name: "Reveal", icon: "✨", draw: drawReveal },
];

export function getStyle(id) {
  return STYLES.find((st) => st.id === id) || STYLES[0];
}
