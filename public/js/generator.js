import { state } from "./state.js";
import { els, val } from "./dom.js";
import { postGenerate, getJobStatus, proxyUrl } from "./api.js";
import { showErr, clearErr } from "./errors.js";
import { addToHistory } from "./history.js";

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
    templateId: state.currentTemplateId,
    prefix:  val("fPrefix"),
    name:    val("fName"),
    genre:   val("fGenre"),
    day:     val("fDay"),
    date:    val("fDate"),
    dj:      val("fDj"),
    contact: val("fContact"),
    time:    val("fTime"),
    entry:   val("fEntry"),
  };
}

function showResult(proxiedUrl) {
  state.last = proxiedUrl;
  state.lastImg = new Image();
  state.lastImg.crossOrigin = "anonymous";
  state.lastImg.src = proxiedUrl;

  els.resultImg.src = proxiedUrl;
  els.statePreview.style.display = "none";
  els.stateResult.style.display = "block";
  addToHistory(proxiedUrl);
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
    showResult(proxied);
  } catch (e) {
    showErr(e.message || "Fehler.");
  } finally {
    setLoading(false);
  }
}

export function resetToPreview() {
  els.stateResult.style.display = "none";
  els.statePreview.style.display = "block";
  import("./preview.js").then((m) => m.updateLivePreview());
}
