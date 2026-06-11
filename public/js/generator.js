import { state } from "./state.js";
import { els, val } from "./dom.js";
import { postGenerate, getJobStatus, proxyUrl } from "./api.js";
import { showErr, clearErr } from "./errors.js";
import { addToHistory } from "./history.js";
import { compositeLogo } from "./composite.js";
import { resetCorrectState } from "./correct.js";
import { setMaster } from "./formats.js";
import { toast } from "./toast.js";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 180 * 1000;

// Rotierender Fortschrittstext im Lade-Overlay; die letzte Meldung bleibt
// stehen (kein Zurückspringen zur ersten bei längeren Generierungen).
const PROGRESS_MSGS = ["Template wird vorbereitet…", "KI platziert deine Texte…", "Feinschliff…"];
let progressTimer = null;

function setLoading(loading) {
  const title = document.querySelector(".ov-title");
  if (loading) {
    els.genTxt.innerHTML = '<span class="spinner"></span>';
    els.genBtn.disabled = true;
    els.ov.classList.add("on");
    els.ovTimer.textContent = "";
    let i = 0;
    if (title) title.textContent = PROGRESS_MSGS[0];
    clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      i = Math.min(i + 1, PROGRESS_MSGS.length - 1);
      if (title) title.textContent = PROGRESS_MSGS[i];
      if (i === PROGRESS_MSGS.length - 1) clearInterval(progressTimer);
    }, 3500);
  } else {
    clearInterval(progressTimer);
    if (title) title.textContent = "Flyer wird generiert…";
    els.genTxt.textContent = "Flyer generieren";
    els.genBtn.disabled = false;
    els.ov.classList.remove("on");
    els.ovTimer.textContent = "";
  }
}

function readEventForm() {
  return {
    engine:  state.engine, // 'v3' | 'v4' — Server wählt den Generierungs-Pfad
    template: state.currentTemplateFile,
    prefix:  val("fPrefix"),
    name:    val("fName"),
    day:     val("fDay"),
    date:    val("fDate"),
    dj:      val("fDj"),
    contact: val("fContact"),
    time:    val("fTime"),
    club:     val("fClub"),
    location: val("fLocation"),
  };
}

async function showResult(proxiedUrl, engineUsed) {
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

  resetCorrectState(); // neuer Flyer → Korrektur-Verlauf des alten verwerfen
  setMaster(displayUrl); // setzt Master + Anzeige, verwirft gecachte Formate

  els.statePreview.style.display = "none";
  els.stateResult.style.display = "grid"; // .result-split is a grid; triggers the entrance animations
  addToHistory(displayUrl);

  // Vergleichshilfe: dezent anzeigen, mit welcher Engine generiert wurde.
  const tag = document.getElementById("engineTag");
  if (tag && engineUsed) {
    tag.textContent = "via " + engineUsed.toUpperCase();
    tag.style.display = "block";
  }
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

  // Engine beim Absenden festhalten — der Toggle könnte während der
  // Generierung umgeschaltet werden.
  const engineUsed = state.engine;

  try {
    const jobId = await postGenerate(readEventForm());
    const proxied = await pollUntilDone(jobId);
    await showResult(proxied, engineUsed);
  } catch (e) {
    showErr(e.message || "Fehler.");
    toast(e.message || "Generierung fehlgeschlagen.", {
      type: "error",
      action: { label: "Erneut versuchen", onClick: generate },
    });
  } finally {
    setLoading(false);
  }
}

export function resetToPreview(e) {
  if (e && e.preventDefault) e.preventDefault();
  resetCorrectState();
  els.stateResult.style.display = "none";
  els.statePreview.style.display = "flex";
  import("./preview.js").then((m) => m.updateLivePreview());
}
