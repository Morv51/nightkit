import { state } from "./state.js";
import { els, val } from "./dom.js";
import { STYLES, getStyle } from "./videoStyles.js";

const PREVIEW_W = 180, PREVIEW_H = 320;
const EXPORT_W = 1080, EXPORT_H = 1920;
const EXPORT_FPS = 30, EXPORT_SECS = 10;

export function renderStyleButtons() {
  const row = document.querySelector(".style-row");
  if (!row) return;
  row.innerHTML = "";
  for (const s of STYLES) {
    const btn = document.createElement("div");
    btn.className = "style-btn" + (s.id === state.currentVideoStyle ? " active" : "");
    btn.id = "vbtn-" + s.id;
    btn.dataset.styleId = s.id;
    btn.innerHTML =
      '<div class="style-icon">' + s.icon + '</div>' +
      '<div class="style-name">' + s.name + '</div>';
    btn.addEventListener("click", () => selectVideoStyle(s.id));
    row.appendChild(btn);
  }
}

export function selectVideoStyle(id) {
  state.currentVideoStyle = id;
  for (const s of STYLES) {
    const btn = document.getElementById("vbtn-" + s.id);
    if (btn) btn.classList.toggle("active", s.id === id);
  }
}

export function toggleVideo() {
  state.videoPanelOpen = !state.videoPanelOpen;
  els.videoBody.classList.toggle("collapsed", !state.videoPanelOpen);
  els.videoChevron.textContent = state.videoPanelOpen ? "▾" : "▸";
}

export function previewVideo() {
  if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
  els.previewWrap.style.display = "flex";
  const canvas = els.videoCanvas;
  canvas.width = PREVIEW_W;
  canvas.height = PREVIEW_H;
  const ctx = canvas.getContext("2d");
  const dur = 10000;
  const startT = Date.now();

  function frame() {
    const t = ((Date.now() - startT) % dur) / dur;
    const style = getStyle(state.currentVideoStyle);
    style.draw(ctx, PREVIEW_W, PREVIEW_H, t, state.lastImg);
    state.animFrameId = requestAnimationFrame(frame);
  }
  frame();
}

function ensureVideoEncoder() {
  if (!window.VideoEncoder || !window.VideoFrame || typeof Mp4Muxer === "undefined") {
    throw new Error("Bitte Chrome 94+ oder Safari 16+ verwenden.");
  }
}

export async function exportVideo() {
  if (!state.last) {
    els.videoStatus.textContent = "Bitte zuerst Flyer generieren.";
    return;
  }

  try { ensureVideoEncoder(); }
  catch (e) { els.videoStatus.textContent = "⚠ " + e.message; return; }

  if (state.animFrameId) cancelAnimationFrame(state.animFrameId);

  const status = els.videoStatus;
  const btn = els.exportBtn;
  btn.disabled = true;

  const canvas = els.videoCanvas;
  canvas.width = EXPORT_W;
  canvas.height = EXPORT_H;
  els.previewWrap.style.display = "flex";
  const ctx = canvas.getContext("2d");

  try {
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: { codec: "avc", width: EXPORT_W, height: EXPORT_H },
      fastStart: "in-memory",
    });

    let encErr = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error:  (e) => { encErr = e; },
    });
    encoder.configure({
      codec: "avc1.640029",
      width: EXPORT_W, height: EXPORT_H,
      bitrate: 4000000, framerate: EXPORT_FPS,
    });

    const totalFrames = EXPORT_FPS * EXPORT_SECS;
    const style = getStyle(state.currentVideoStyle);

    for (let i = 0; i < totalFrames; i++) {
      if (encErr) throw encErr;
      style.draw(ctx, EXPORT_W, EXPORT_H, i / totalFrames, state.lastImg);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i / EXPORT_FPS * 1000000) });
      encoder.encode(frame, { keyFrame: i % EXPORT_FPS === 0 });
      frame.close();
      if (i % 15 === 0) {
        status.textContent = "MP4 erstellen… " + Math.round(i / totalFrames * 100) + "%";
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await encoder.flush();
    encoder.close();
    if (encErr) throw encErr;
    muxer.finalize();

    const base = (val("fName") || "flyer").replace(/\s+/g, "-").toLowerCase();
    const fname = base + "-" + state.currentVideoStyle;
    const blob = new Blob([target.buffer], { type: "video/mp4" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname + ".mp4";
    a.click();

    status.textContent = "✓ Video fertig";
    btn.disabled = false;
    previewVideo();
  } catch (e) {
    status.textContent = "⚠ Video-Fehler: " + (e.message || e);
    btn.disabled = false;
  }
}
