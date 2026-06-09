// Video effect registry. Every effect is a `draw(ctx, W, H, t, img)` function
// where t goes 0→1 over exactly 10s / 300 frames (frame = round(t*300)).
// Effects are template-agnostic and resolution-independent: pixel sizes scale
// by `s = H / 1280` so they look identical in the small preview and the full
// export. The flyer is always drawn covering the whole canvas (no padding, no
// visible background); zoom never goes below scale 1.0 so no edge is revealed.
//
// Adding a style: append to STYLES. The pill row, preview and export read from
// it — no other file changes. video.js calls getStyle(id).draw(...) per frame,
// reading the selected effect from state.currentVideoStyle.

// ── shared helpers ───────────────────────────────────────────────
const lerp = (a, b, x) => a + (b - a) * x;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

// Intensity envelope over the 10s: soft build (0–1.5s), full (1.5–8.5s),
// ease-out (8.5–10s).
function envelope(t) {
  const a = 0.15, b = 0.85;
  if (t < a) return smooth(t / a);
  if (t > b) return smooth((1 - t) / (1 - b));
  return 1;
}

function fillBlack(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
}

// Cover-draw the image at `scale` (>=1) centred + offset, optional blur. Because
// scale >= 1 and offsets stay within the overscan, the frame is always filled.
function drawCover(ctx, img, W, H, scale, ox = 0, oy = 0, blur = 0) {
  const dw = W * scale, dh = H * scale;
  const dx = (W - dw) / 2 + ox, dy = (H - dh) / 2 + oy;
  if (blur) {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(img, dx, dy, dw, dh);
  }
}

function vignette(ctx, W, H, strength) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.62);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// White-ish pixel noise (VHS / film grain). Sparse — scales with area.
function drawNoise(ctx, W, H, maxAlpha, density = 0.0011) {
  const count = Math.floor(W * H * density);
  ctx.save();
  ctx.fillStyle = "#fff";
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = Math.random() * maxAlpha;
    ctx.fillRect((Math.random() * W) | 0, (Math.random() * H) | 0, 1, 1);
  }
  ctx.restore();
}

// Reusable offscreen canvas (parallax foreground mask, liquid source strip).
let _scratch = null;
function getScratch(w, h) {
  if (!_scratch) _scratch = { canvas: document.createElement("canvas"), ctx: null };
  if (_scratch.canvas.width !== w || _scratch.canvas.height !== h) {
    _scratch.canvas.width = w;
    _scratch.canvas.height = h;
    _scratch.ctx = _scratch.canvas.getContext("2d");
  }
  return _scratch;
}

// Per-image RGB channel canvases for the glitch split, cached so the export
// builds them once and reuses them across all 300 frames.
const channelCache = new WeakMap();
function getChannels(img, W, H) {
  const cached = channelCache.get(img);
  if (cached && cached.W === W && cached.H === H) return cached;
  const make = (color) => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, W, H);
    x.globalCompositeOperation = "multiply";
    x.fillStyle = color;
    x.fillRect(0, 0, W, H);
    return c;
  };
  const entry = { W, H, r: make("#ff0000"), g: make("#00ff00"), b: make("#0000ff") };
  channelCache.set(img, entry);
  return entry;
}

// ── 1. GLITCH (template-agnostic, hard + clean, glitches in waves) ──
function drawGlitch(ctx, W, H, t, img) {
  const s = H / 1280;
  const frame = Math.round(t * 300);
  ctx.clearRect(0, 0, W, H);
  if (!img || !img.complete) { fillBlack(ctx, W, H); return; }

  const e = envelope(t);
  // glitches arrive in bursts (waves) rather than continuously
  const burst = Math.max(0, Math.sin(t * Math.PI * 2 * 2.2)) * e;

  // micro-shake on burst peaks (2–4px, 2–3 frames)
  let shx = 0, shy = 0;
  if (burst > 0.45 && frame % 24 < 3) {
    shx = (Math.random() - 0.5) * (4 + 4 * burst) * s;
    shy = (Math.random() - 0.5) * (4 + 4 * burst) * s;
  }

  // RGB split — three channel copies, horizontal offset 2–8px. Overscan by M so
  // neither the split nor the shake reveals a background.
  const off = (2 + 6 * e) * s;
  const M = 14 * s;
  const ch = getChannels(img, W, H);
  const dw = W + 2 * M, dh = H + 2 * M, bx = -M + shx, by = -M + shy;

  fillBlack(ctx, W, H);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.85;
  ctx.drawImage(ch.r, bx - off, by, dw, dh);
  ctx.drawImage(ch.g, bx, by, dw, dh);
  ctx.drawImage(ch.b, bx + off, by, dw, dh);
  ctx.restore();

  // scanlines: 2px line every 4px, opacity 0.12
  const step = Math.max(2, Math.round(4 * s));
  const lh = Math.max(1, Math.round(2 * s));
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  for (let y = 0; y < H; y += step) ctx.fillRect(0, y, W, lh);

  // block glitch (in bursts): 1–3 horizontal strips (8–40px) shoved 15–40px
  if (burst > 0.25 && frame % 5 === 0) {
    const slices = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < slices; k++) {
      const sh = (8 + Math.random() * 32) * s;
      const sy = Math.random() * (H - sh);
      const dir = Math.random() < 0.5 ? -1 : 1;
      const dx = dir * (15 + Math.random() * 25) * s * burst;
      ctx.drawImage(ctx.canvas, 0, sy, W, sh, dx, sy, W, sh);
    }
  }

  // datamosh accent ~every 1s: a short #CCFF00 colour tear
  if (e > 0.3 && frame % 30 < 2) {
    const th = (8 + Math.random() * 24) * s;
    const ty = Math.random() * (H - th);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55;
    ctx.drawImage(ctx.canvas, 0, ty, W, th, (Math.random() - 0.5) * 40 * s, ty, W, th);
    ctx.fillStyle = "rgba(204,255,0,0.2)";
    ctx.fillRect(0, ty, W, th);
    ctx.restore();
  }

  // fine digital noise, opacity ~0.06
  drawNoise(ctx, W, H, 0.06);
}

// ── 2. NEON PULSE (always fullscreen, saturated glow, beat) ──────
function drawNeon(ctx, W, H, t, img) {
  const s = H / 1280;
  const frame = Math.round(t * 300);
  ctx.clearRect(0, 0, W, H);
  if (!img || !img.complete) { ctx.fillStyle = "#08080f"; ctx.fillRect(0, 0, W, H); return; }

  // Ken Burns — scale in [1.04, 1.10], slow Lissajous pan, never below 1.0.
  const scale = 1.04 + 0.06 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 - Math.PI / 2));
  const dw = W * scale, dh = H * scale;
  const maxPanX = (dw - W) / 2, maxPanY = (dh - H) / 2;
  const dx = (W - dw) / 2 + Math.sin(t * Math.PI * 2 * 0.35) * maxPanX * 0.8;
  const dy = (H - dh) / 2 + Math.cos(t * Math.PI * 2 * 0.25) * maxPanY * 0.8;
  ctx.drawImage(img, dx, dy, dw, dh);

  // bloom on bright areas (blurred additive copy)
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.24;
  ctx.filter = `blur(${12 * s}px)`;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();

  // colour glow pulsing pink (#ff2d95) ↔ cyan (#00e5ff)
  const mix = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 1.5);
  const cr = Math.round(lerp(255, 0, mix));
  const cg = Math.round(lerp(45, 229, mix));
  const cb = Math.round(lerp(149, 255, mix));
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.06 + 0.04 * mix;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // beat pulse: a quick flash every 0.5s (15 frames), 0→0.25→0 over 3 frames
  const ph = frame % 15;
  if (ph < 3) {
    const a = [0.1, 0.25, 0.1][ph];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  vignette(ctx, W, H, 0.5);
}

// ── 3. SMOOTH REVEAL (cinematic) ─────────────────────────────────
function drawReveal(ctx, W, H, t, img) {
  const s = H / 1280;
  ctx.clearRect(0, 0, W, H);
  if (!img || !img.complete) { fillBlack(ctx, W, H); return; }

  // Phase 1 (0–2s): light streak wipes top→bottom, revealing the image behind.
  if (t < 0.2) {
    const lineY = smooth(t / 0.2) * H;
    ctx.drawImage(img, 0, 0, W, H);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, lineY, W, H - lineY);
    const glowH = 70 * s;
    const g = ctx.createLinearGradient(0, lineY - glowH, 0, lineY);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(255,255,255,0.22)");
    ctx.fillStyle = g;
    ctx.fillRect(0, lineY - glowH, W, glowH);
    const sh = 24 * s;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(0, lineY - sh / 2, W, sh);
    ctx.restore();
    vignette(ctx, W, H, 0.3);
    return;
  }

  // Phase 2 (2–8s): slow push-in 1.0 → 1.04 + fine film grain. Freezes at 1.04.
  const zp = t < 0.8 ? (t - 0.2) / 0.6 : 1;
  drawCover(ctx, img, W, H, 1.0 + 0.04 * smooth(zp));
  drawNoise(ctx, W, H, 0.05);
  vignette(ctx, W, H, 0.3);

  // Phase 3 (8–10s): a second light streak runs through fast, then freeze.
  if (t >= 0.8) {
    const sp = (t - 0.8) / 0.1; // 8–9s streak, 9–10s hold
    if (sp <= 1) {
      const ly = smooth(sp) * H;
      const sh = 24 * s;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createLinearGradient(0, ly - 60 * s, 0, ly + 10 * s);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.85, "rgba(255,255,255,0.5)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, ly - 60 * s, W, 70 * s);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillRect(0, ly - sh / 2, W, sh);
      ctx.restore();
    }
  }
}

// ── 4. PARALLAX DEPTH (simulated depth, premium 3D look) ─────────
function drawParallax(ctx, W, H, t, img) {
  const s = H / 1280;
  ctx.clearRect(0, 0, W, H);
  if (!img || !img.complete) { fillBlack(ctx, W, H); return; }

  const e = envelope(t);
  const ang = t * Math.PI * 2;                       // one figure-eight loop / 10s
  const endPush = t > 0.85 ? smooth((t - 0.85) / 0.15) * 0.04 : 0;

  // background — moves little, soft blur, scale 1.06
  const bgA = 6 * s * e;
  drawCover(ctx, img, W, H, 1.06 + endPush, Math.sin(ang) * bgA, Math.sin(ang * 2) * bgA * 0.6, 1.6 * s);

  // foreground — stronger, counter-moving, radial mask keeps only the centre
  const fgA = 16 * s * e;
  const sc = getScratch(W, H);
  sc.ctx.clearRect(0, 0, W, H);
  drawCover(sc.ctx, img, W, H, 1.12 + endPush, -Math.sin(ang) * fgA, -Math.sin(ang * 2) * fgA * 0.6, 0);
  sc.ctx.save();
  sc.ctx.globalCompositeOperation = "destination-in";
  const m = sc.ctx.createRadialGradient(W / 2, H * 0.46, H * 0.10, W / 2, H * 0.5, H * 0.6);
  m.addColorStop(0, "rgba(255,255,255,1)");
  m.addColorStop(0.6, "rgba(255,255,255,0.92)");
  m.addColorStop(1, "rgba(255,255,255,0)");
  sc.ctx.fillStyle = m;
  sc.ctx.fillRect(0, 0, W, H);
  sc.ctx.restore();
  ctx.drawImage(sc.canvas, 0, 0);

  vignette(ctx, W, H, 0.38);
}

// ── 5. LIQUID DISTORTION (wave warp, hypnotic, strip-based) ──────
function drawLiquid(ctx, W, H, t, img) {
  const s = H / 1280;
  ctx.clearRect(0, 0, W, H);
  if (!img || !img.complete) { fillBlack(ctx, W, H); return; }

  const e = envelope(t);
  const M = Math.ceil(18 * s);                 // horizontal margin for the shift
  const sw = W + 2 * M;
  // Source = flyer scaled 1.04 (vertical overscan) centred in a wider scratch,
  // so horizontal/vertical sampling offsets never hit a transparent edge.
  const sc = getScratch(sw, H);
  sc.ctx.clearRect(0, 0, sw, H);
  const scale = 1.04, dw = W * scale, dh = H * scale;
  sc.ctx.drawImage(img, (sw - dw) / 2, (H - dh) / 2, dw, dh);

  const amp = 10 * s * e;
  const ampA = amp * 0.6, ampB = amp * 0.4;
  const freqA = 0.018 / s, freqB = 0.040 / s;
  const vAmp = 3 * s * e;
  const stripH = Math.max(2, Math.round(4 * s));
  const TAU = Math.PI * 2;

  for (let y = 0; y < H; y += stripH) {
    const off = Math.sin(y * freqA + t * TAU * 1.4) * ampA
              + Math.sin(y * freqB - t * TAU * 0.9) * ampB;
    const voff = Math.sin(y * freqA * 0.5 + t * TAU * 0.7) * vAmp;
    const hh = Math.min(stripH + 1, H - y);
    const sy = Math.max(0, Math.min(H - hh, y + voff));
    ctx.drawImage(sc.canvas, M - off, sy, W, hh, 0, y, W, hh);
  }

  // subtle chromatic sheen at the high-contrast edges
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.045 * e;
  ctx.drawImage(ctx.canvas, 1.5 * s, 0);
  ctx.globalAlpha = 0.04 * e;
  ctx.drawImage(ctx.canvas, -1.5 * s, 0);
  ctx.restore();

  vignette(ctx, W, H, 0.26);
}

// ── 6. PARTICLE RISE (rising light particles, festive) ───────────
let _particles = null;
function getParticles() {
  if (_particles) return _particles;
  _particles = [];
  for (let i = 0; i < 120; i++) {
    _particles.push({
      x: Math.random(),                 // base x as fraction of W
      speed: 0.55 + Math.random() * 0.9, // rises over 10s
      size: 1 + Math.random() * 3,       // px (× s)
      driftAmp: 0.012 + Math.random() * 0.03, // fraction of W
      driftFreq: 1.5 + Math.random() * 3,
      phase: Math.random() * Math.PI * 2,
      offset: Math.random(),            // initial position in the rise cycle
      mix: Math.random(),               // warm-gold colour mix
    });
  }
  return _particles;
}

function drawParticle(ctx, W, H, t, img) {
  const s = H / 1280;
  ctx.clearRect(0, 0, W, H);
  if (!img || !img.complete) { fillBlack(ctx, W, H); return; }

  // base flyer with a gentle push-in 1.0 → 1.03
  drawCover(ctx, img, W, H, 1.0 + 0.03 * smooth(t));
  // subtle vignette so the bright particles stay visible at the edges
  vignette(ctx, W, H, 0.32);

  const e = envelope(t);
  const ps = getParticles();
  const active = Math.floor(120 * (0.25 + 0.75 * e)); // density follows the envelope
  const TAU = Math.PI * 2;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < active; i++) {
    const p = ps[i];
    const yp = (p.offset + t * p.speed) % 1;          // 0 (bottom) → 1 (top)
    let a = clamp01(yp / 0.12) * clamp01((1 - yp) / 0.22); // fade in/out
    a *= 0.45 + 0.55 * e;
    if (a <= 0.01) continue;
    const x = p.x * W + Math.sin(yp * p.driftFreq * TAU + p.phase) * p.driftAmp * W;
    const y = (1 - yp) * H;
    const r = p.size * s * (0.85 + 0.3 * Math.sin(t * TAU * 2 + p.phase)); // gentle twinkle
    const cg = Math.round(lerp(246, 208, p.mix));     // #fff6d6 → #ffd070
    const cb = Math.round(lerp(214, 112, p.mix));
    ctx.globalAlpha = a * 0.9;
    ctx.shadowColor = `rgba(255,${cg},${cb},0.9)`;
    ctx.shadowBlur = r * 3;
    ctx.fillStyle = `rgb(255,${cg},${cb})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export const STYLES = [
  { id: "glitch",   name: "Glitch",   draw: drawGlitch },
  { id: "neon",     name: "Neon",     draw: drawNeon },
  { id: "reveal",   name: "Reveal",   draw: drawReveal },
  { id: "parallax", name: "Parallax", draw: drawParallax },
  { id: "liquid",   name: "Liquid",   draw: drawLiquid },
  { id: "particle", name: "Particle", draw: drawParticle },
];

export function getStyle(id) {
  return STYLES.find((st) => st.id === id) || STYLES[0];
}
