// Video effect registry. Adding a style: append an entry. The button
// row, the preview, and the export all read from this list — no other
// file needs to change.

function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

function drawHorror(ctx, W, H, t, img) {
  const breathe = 1 + 0.008 * Math.sin(t * Math.PI * 2);
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.scale(breathe, breathe); ctx.translate(-W / 2, -H / 2);
  if (img && img.complete) ctx.drawImage(img, 0, 0, W, H);
  else { ctx.fillStyle = "#1a0000"; ctx.fillRect(0, 0, W, H); }
  ctx.restore();

  for (let i = 0; i < H; i += 4) {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, i, W, 1);
  }

  const aberr = 3 + 8 * Math.pow(Math.sin(t * Math.PI * 3), 8);
  if (img && img.complete) {
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.12;
    ctx.drawImage(img, -aberr, 0, W, H);
    ctx.globalAlpha = 0.08;
    ctx.drawImage(img, aberr, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  const glitchPhases = [0.15, 0.42, 0.68, 0.87];
  for (const phase of glitchPhases) {
    const dt = ((t - phase + 1) % 1);
    if (dt < 0.06) {
      const intensity = 1 - dt / 0.06;
      const numStripes = Math.floor(intensity * 12) + 3;
      for (let g = 0; g < numStripes; g++) {
        const gy = (Math.random() * H) | 0;
        const gh = (Math.random() * 20 + 2) | 0;
        const gx = (Math.random() * 40 - 20) | 0;
        if (img && img.complete) ctx.drawImage(img, gx, gy, W, gh, 0, gy, W, gh);
        ctx.fillStyle = "rgba(" + (Math.random() > 0.5 ? "200,0,0" : "0,0,200") + ",0.3)";
        ctx.fillRect(0, gy, W, gh);
      }
      if (dt < 0.015) {
        ctx.fillStyle = "rgba(180,0,0," + (0.7 * (1 - dt / 0.015)) + ")";
        ctx.fillRect(0, 0, W, H);
      }
    }
  }

  const numDrips = 5;
  for (let d = 0; d < numDrips; d++) {
    const dPhase = (d / numDrips);
    const dT = ((t + dPhase) % 1);
    const dX = W * (0.1 + d * 0.18 + Math.sin(d * 3) * 0.05);
    const dLen = H * 0.3 * easeInOut(Math.min(1, dT * 3));
    const dY = H * (0.02 + (d % 3) * 0.05);
    const grad = ctx.createLinearGradient(dX, dY, dX, dY + dLen);
    grad.addColorStop(0,   "rgba(160,0,0,0.9)");
    grad.addColorStop(0.7, "rgba(120,0,0,0.6)");
    grad.addColorStop(1,   "rgba(80,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(dX, dY + dLen * 0.5, 3, dLen * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (dLen > 10) {
      ctx.beginPath();
      ctx.arc(dX, dY + dLen, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(140,0,0,0.85)";
      ctx.fill();
    }
  }

  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.8);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

function drawPulse(ctx, W, H, t, img) {
  const zoom = 1 + 0.03 * Math.sin(t * Math.PI * 2);
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -H / 2);
  if (img && img.complete) ctx.drawImage(img, 0, 0, W, H);
  else { ctx.fillStyle = "#08080f"; ctx.fillRect(0, 0, W, H); }
  ctx.restore();

  const beamT = (t * 2) % 1;
  const beamX = W * (beamT - 0.1);
  const beamGrad = ctx.createLinearGradient(beamX - W * 0.08, 0, beamX + W * 0.08, 0);
  beamGrad.addColorStop(0,   "rgba(200,160,255,0)");
  beamGrad.addColorStop(0.5, "rgba(200,160,255,0.18)");
  beamGrad.addColorStop(1,   "rgba(200,160,255,0)");
  ctx.fillStyle = beamGrad;
  ctx.fillRect(0, 0, W, H);

  const streakY = H * 0.35 + H * 0.1 * Math.sin(t * Math.PI * 4);
  const streakGrad = ctx.createLinearGradient(0, streakY - 2, 0, streakY + 2);
  streakGrad.addColorStop(0,   "rgba(180,120,255,0)");
  streakGrad.addColorStop(0.5, "rgba(180,120,255,0.35)");
  streakGrad.addColorStop(1,   "rgba(180,120,255,0)");
  ctx.fillStyle = streakGrad;
  ctx.fillRect(0, streakY - 2, W, 4);

  const numP = 30;
  for (let p = 0; p < numP; p++) {
    const pPhase = p / numP;
    const pT = ((t + pPhase) % 1);
    const px = W * (0.1 + Math.sin(pPhase * 17) * 0.8);
    const py = H * (1 - pT);
    const pAlpha = Math.sin(pT * Math.PI) * 0.7;
    const pSize = 1.5 + Math.sin(pPhase * 7) * 1.5;
    ctx.beginPath();
    ctx.arc(px, py, pSize, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(180,120,255," + pAlpha + ")";
    ctx.fill();
  }

  const pulseAlpha = 0.08 + 0.07 * Math.sin(t * Math.PI * 6);
  ctx.fillStyle = "rgba(100,50,220," + pulseAlpha + ")";
  ctx.fillRect(0, 0, W, H);

  const vigAlpha = 0.3 + 0.15 * Math.sin(t * Math.PI * 2);
  const vig2 = ctx.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H * 0.75);
  vig2.addColorStop(0, "rgba(0,0,0,0)");
  vig2.addColorStop(1, "rgba(0,0,20," + vigAlpha + ")");
  ctx.fillStyle = vig2;
  ctx.fillRect(0, 0, W, H);

  const edgeGlow = 0.15 + 0.12 * Math.sin(t * Math.PI * 4);
  ctx.strokeStyle = "rgba(150,80,255," + edgeGlow + ")";
  ctx.lineWidth = 8;
  ctx.strokeRect(0, 0, W, H);
}

function drawReveal(ctx, W, H, t, img) {
  const kbScale = 1.04 + 0.04 * Math.sin(t * Math.PI);
  const kbX = W * 0.02 * Math.sin(t * Math.PI * 0.7);
  const kbY = H * 0.02 * Math.sin(t * Math.PI * 0.5);
  ctx.save();
  ctx.translate(W / 2 + kbX, H / 2 + kbY); ctx.scale(kbScale, kbScale); ctx.translate(-W / 2, -H / 2);
  if (img && img.complete) ctx.drawImage(img, 0, 0, W, H);
  else { ctx.fillStyle = "#08080f"; ctx.fillRect(0, 0, W, H); }
  ctx.restore();

  const llT = ((t * 0.7) % 1);
  const llAlpha = Math.sin(llT * Math.PI) * 0.25;
  const ll = ctx.createRadialGradient(0, 0, 0, W * 0.3, H * 0.2, W * 0.7);
  ll.addColorStop(0,   "rgba(255,220,150," + llAlpha + ")");
  ll.addColorStop(0.4, "rgba(255,180,80,"  + (llAlpha * 0.4) + ")");
  ll.addColorStop(1,   "rgba(255,100,0,0)");
  ctx.fillStyle = ll;
  ctx.fillRect(0, 0, W, H);

  const ll2T = ((t * 0.7 + 0.5) % 1);
  const ll2Alpha = Math.sin(ll2T * Math.PI) * 0.2;
  const ll2 = ctx.createRadialGradient(W, H, 0, W * 0.7, H * 0.8, W * 0.7);
  ll2.addColorStop(0, "rgba(200,100,255," + ll2Alpha + ")");
  ll2.addColorStop(1, "rgba(200,100,255,0)");
  ctx.fillStyle = ll2;
  ctx.fillRect(0, 0, W, H);

  const flareT = ((t + 0.3) % 1);
  const flareY = H * (0.3 + 0.1 * Math.sin(t * Math.PI));
  const flareAlpha = Math.sin(flareT * Math.PI) * 0.12;
  const flareGrad = ctx.createLinearGradient(0, flareY, W, flareY);
  flareGrad.addColorStop(0,   "rgba(255,220,150,0)");
  flareGrad.addColorStop(0.5, "rgba(255,220,150," + flareAlpha + ")");
  flareGrad.addColorStop(1,   "rgba(255,220,150,0)");
  ctx.fillStyle = flareGrad;
  ctx.fillRect(0, flareY - 1, W, 2);

  for (let gr = 0; gr < 800; gr++) {
    const gx = (Math.random() * W) | 0;
    const gy = (Math.random() * H) | 0;
    ctx.fillStyle = "rgba(255,255,255," + (Math.random() * 0.04) + ")";
    ctx.fillRect(gx, gy, 1, 1);
  }

  const barH = H * 0.04;
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(0, 0, W, barH);
  ctx.fillRect(0, H - barH, W, barH);

  const vig3 = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
  vig3.addColorStop(0, "rgba(0,0,0,0)");
  vig3.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vig3;
  ctx.fillRect(0, 0, W, H);
}

export const STYLES = [
  { id: "horror", name: "Glitch", icon: "⚡", draw: drawHorror },
  { id: "pulse",  name: "Neon",   icon: "🔮", draw: drawPulse  },
  { id: "reveal", name: "Reveal", icon: "✨", draw: drawReveal },
];

export function getStyle(id) {
  return STYLES.find((s) => s.id === id) || STYLES[0];
}
