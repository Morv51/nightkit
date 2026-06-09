import { state } from "./state.js";
import { els, val } from "./dom.js";
import { postGenerate, getJobStatus, proxyUrl } from "./api.js";
import { showErr, clearErr } from "./errors.js";
import { addToHistory } from "./history.js";
import { compositeLogo } from "./composite.js";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 180 * 1000;

function setLoading(loading) {
  if (loading) {
    els.genTxt.innerHTML = '<span class="spinner"></span>';
    els.genBtn.disabled = true;
    els.ov.classList.add("on");
    els.ovTimer.textContent = "";
  } else {
    els.genTxt.textContent = "Flyer generieren";
    els.genBtn.disabled = false;
    els.ov.classList.remove("on");
    els.ovTimer.textContent = "";
  }
}

function readEventForm() {
  return {
    template: state.currentTemplateFile,
    prefix:  val("fPrefix"),
    name:    val("fName"),
    day:     val("fDay"),
    date:    val("fDate"),
    dj:      val("fDj"),
    contact: val("fContact"),
    time:    val("fTime"),
  };
}

async function showResult(proxiedUrl) {
  // Burn the uploaded logo into the result so it shows in the flyer and in
  // every export (download, copy, video). Falls back to the plain image if
  // compositing fails for any reason.
  let displayUrl = proxiedUrl;
  if (state.logoUrl) {
    try {
      displayUrl = await compositeLogo(proxiedUrl, state.logoUrl);
    } catch (e) {
      console.error("Logo konnte nicht einkomponiert werden:", e);
      displayUrl = proxiedUrl;
    }
  }

  state.last = displayUrl;
  state.lastImg = new Image();
  state.lastImg.crossOrigin = "anonymous";
  state.lastImg.src = displayUrl;

  els.resultImg.src = displayUrl;
  els.statePreview.style.display = "none";
  els.stateResult.style.display = "grid"; // .result-split is a grid; triggers the entrance animations
  addToHistory(displayUrl);
}

async function pollUntilDone(jobId) {
  const start = Date.now();
  while (true) {
    if (Date.now() - start > MAX_POLL_MS) {
      throw new Error("Timeout: Generierung dauert zu lange.");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const secs = Math.round((Date.now() - start) / 1000);
    if (els.ovTimer) els.ovTimer.textContent = secs + "s";

    const job = await getJobStatus(jobId);
    if (job.status === "pending") continue;
    if (job.status === "error") throw new Error(job.error || "Fehler.");
    if (!job.url) throw new Error("Kein Bild erhalten.");
    return proxyUrl(job.url);
  }
}

export async function generate() {
  if (!val("fName") || !val("fDate")) {
    showErr("Bitte Event-Name und Datum ausfüllen.");
    return;
  }
  clearErr();
  setLoading(true);

  try {
    const jobId = await postGenerate(readEventForm());
    const proxied = await pollUntilDone(jobId);
    await showResult(proxied);
  } catch (e) {
    showErr(e.message || "Fehler.");
  } finally {
    setLoading(false);
  }
}

export function resetToPreview(e) {
  if (e && e.preventDefault) e.preventDefault();
  els.stateResult.style.display = "none";
  els.statePreview.style.display = "flex";
  import("./preview.js").then((m) => m.updateLivePreview());
}
