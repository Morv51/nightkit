import { state } from "./state.js";
import { els, val } from "./dom.js";
import { STYLES, getStyle } from "./videoStyles.js";

const EXPORT_FPS = 30, EXPORT_SECS = 10;
const MAX_W = 1080, MAX_H = 1920; // H.264 level cap

// Exact flyer pixel size, capped to the encoder limit and rounded to even
// (H.264 requires even dimensions). Falls back to 1080x1920 if not loaded yet.
// Video always renders the 9:16 MASTER, regardless of which export format is
// currently displayed in the preview.
function flyerSize() {
  const img = state.masterImg;
  let W = (img && img.naturalWidth) || MAX_W;
  let H = (img && img.naturalHeight) || MAX_H;
  if (W > MAX_W || H > MAX_H) {
    const r = Math.min(MAX_W / W, MAX_H / H);
    W = Math.round(W * r);
    H = Math.round(H * r);
  }
  return { W: W - (W % 2), H: H - (H % 2) };
}

// Bühnen-Preview-Größe (gleiches 9:16 wie der Flyer). Moderat hoch für eine
// scharfe Vorschau auf der Hauptbühne, aber gedeckelt fürs flüssige rAF.
function previewSize() {
  const { W, H } = flyerSize();
  const ph = Math.min(640, H);
  return { W: Math.round((ph * W) / H), H: ph };
}

export function renderStyleButtons() {
  const row = document.querySelector(".style-row");
  if (!row) return;
  row.innerHTML = "";
  for (const s of STYLES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill" + (s.id === state.currentVideoStyle ? " active" : "");
    btn.id = "vbtn-" + s.id;
    btn.dataset.styleId = s.id;
    btn.textContent = s.name;
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

// Video-Bereich zurücksetzen (Template-Wechsel / neue Vorlage): Bühnen-Video
// verlassen, Status + Button zurück.
export function resetVideo() {
  exitStageVideo();
  if (els.videoStatus) els.videoStatus.textContent = "";
  if (els.exportBtn) els.exportBtn.disabled = false;
}

// Bühnen-Video verlassen → zurück zum Flyer (Crossfade per CSS-Klasse).
export function exitStageVideo() {
  if (state.animFrameId) { cancelAnimationFrame(state.animFrameId); state.animFrameId = null; }
  const frame = document.getElementById("flyerFrame");
  if (frame) frame.classList.remove("video-active");
}

// Video-Preview läuft DIREKT auf der Hauptbühne: der Flyer wird per Crossfade
// (Klasse video-active am Flyer-Rahmen) durch das Canvas ersetzt, der "Zurück
// zum Flyer"-Button erscheint. rAF-Loop = automatischer Loop.
export function previewVideo() {
  if (!state.masterImg || !els.stageVideo) return;
  if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
  const { W, H } = previewSize();
  const canvas = els.stageVideo;
  canvas.width = W;
  canvas.height = H;
  const frame = document.getElementById("flyerFrame");
  if (frame) frame.classList.add("video-active");
  const ctx = canvas.getContext("2d");
  const dur = 10000;
  const startT = Date.now();

  function tick() {
    const t = ((Date.now() - startT) % dur) / dur;
    getStyle(state.currentVideoStyle).draw(ctx, W, H, t, state.masterImg);
    state.animFrameId = requestAnimationFrame(tick);
  }
  tick();
}

function ensureVideoEncoder() {
  if (!window.VideoEncoder || !window.VideoFrame || typeof Mp4Muxer === "undefined") {
    throw new Error("Bitte Chrome 94+ oder Safari 16+ verwenden.");
  }
}

export async function exportVideo() {
  if (!state.master) {
    els.videoStatus.textContent = "Bitte zuerst Flyer generieren.";
    return;
  }

  try { ensureVideoEncoder(); }
  catch (e) { els.videoStatus.textContent = "⚠ " + e.message; return; }

  if (state.animFrameId) cancelAnimationFrame(state.animFrameId);

  const status = els.videoStatus;
  const btn = els.exportBtn;
  btn.disabled = true;

  const { W, H } = flyerSize();
  const canvas = els.stageVideo;
  canvas.width = W;
  canvas.height = H;
  document.getElementById("flyerFrame")?.classList.add("video-active"); // Encoding sichtbar auf der Bühne
  const ctx = canvas.getContext("2d");

  try {
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: { codec: "avc", width: W, height: H },
      fastStart: "in-memory",
    });

    let encErr = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error:  (e) => { encErr = e; },
    });
    encoder.configure({
      codec: "avc1.640029",
      width: W, height: H,
      bitrate: 4000000, framerate: EXPORT_FPS,
    });

    const totalFrames = EXPORT_FPS * EXPORT_SECS;
    const style = getStyle(state.currentVideoStyle);

    for (let i = 0; i < totalFrames; i++) {
      if (encErr) throw encErr;
      style.draw(ctx, W, H, i / totalFrames, state.masterImg);
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
