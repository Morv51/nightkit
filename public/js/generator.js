import { state } from "./state.js";
import { els, val } from "./dom.js";
import { postGenerate, getJobStatus, proxyUrl, friendlyMessage } from "./api.js";
import { showErr, clearErr } from "./errors.js";
import { addToHistory } from "./history.js";
import { compositeLogo } from "./composite.js";
import { resetCorrectState } from "./correct.js";
import { setMaster, resetFormatsState } from "./formats.js";
import { resetVideo } from "./video.js";
import { resetCaption } from "./caption.js";
import { exitBeforeMode, setBeforeImage } from "./compare.js";
import { toast } from "./toast.js";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 180 * 1000;

// Rotierende Fortschrittstexte im Skeleton; die letzte Meldung bleibt stehen
// (kein Zurückspringen zur ersten bei längeren Generierungen).
const PROGRESS_MSGS = [
  "Template wird vorbereitet…",
  "KI platziert deine Texte…",
  "Feinschliff…",
  "Fast fertig…",
];
let progressTimer = null;

function startProgress() {
  let i = 0;
  if (els.skelMsg) els.skelMsg.textContent = PROGRESS_MSGS[0];
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    i = Math.min(i + 1, PROGRESS_MSGS.length - 1);
    if (els.skelMsg) els.skelMsg.textContent = PROGRESS_MSGS[i];
    if (i === PROGRESS_MSGS.length - 1) clearInterval(progressTimer);
  }, 2500);
}

function stopProgress() {
  clearInterval(progressTimer);
}

// Switch the stage between its three states without destroying their content,
// so a failed call can restore exactly what was there before.
function showStage(which) {
  const isResult = which === "result";
  els.statePreview.style.display = which === "preview" ? "flex" : "none";
  els.stateLoading.style.display = which === "loading" ? "flex" : "none";
  els.stateResult.style.display  = isResult ? "flex" : "none";
  // Sidebar: Aktionen nur im Result-State, sonst der ruhige Empty-Hinweis.
  if (els.sideActions) els.sideActions.style.display = isResult ? "flex" : "none";
  if (els.sideEmpty)   els.sideEmpty.style.display   = isResult ? "none" : "flex";
}

function setGenButton(loading) {
  els.genBtn.disabled = loading;
  if (loading) els.genTxt.innerHTML = '<span class="spinner"></span> Wird erstellt…';
  else els.genTxt.textContent = "Flyer generieren";
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
    club:     val("fClub"),
    location: val("fLocation"),
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

  resetCorrectState(); // neuer Flyer → Korrektur-Verlauf des alten verwerfen
  setMaster(displayUrl); // setzt Master + Anzeige, verwirft gecachte Formate

  exitBeforeMode();          // immer im "Nachher"-Zustand (fertiger Flyer) starten
  setBeforeImage();          // Template-Vorlage fürs Vorher/Nachher-Overlay setzen
  resetVideo();              // alte Bühnen-Video-Animation des Vorgängers stoppen
  showStage("result"); // zeigt Flyer (Hauptbühne) + Aktionen (Sidebar)
  addToHistory(displayUrl);
}

async function pollUntilDone(jobId) {
  const start = Date.now();
  while (true) {
    if (Date.now() - start > MAX_POLL_MS) {
      throw new Error("Timeout: Generierung dauert zu lange.");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

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
  // Remember what was on the stage so a failure restores it instead of
  // leaving a blank/broken stage behind.
  const prevStage = els.stateResult.style.display !== "none" ? "result" : "preview";
  setGenButton(true);
  showStage("loading");
  startProgress();

  try {
    const jobId = await postGenerate(readEventForm());
    const proxied = await pollUntilDone(jobId);
    await showResult(proxied);
    toast("Deine Grafik ist fertig", { type: "success" });
  } catch (e) {
    showStage(prevStage);
    const msg = friendlyMessage(e);
    showErr(msg);
    toast(msg, {
      type: "error",
      action: { label: "Erneut versuchen", onClick: generate },
    });
  } finally {
    stopProgress();
    setGenButton(false);
  }
}

// Vollständiger Reset zurück in den leeren Template-Vorschau-State. Genutzt
// vom "Neues Template wählen"-Link UND vom Template-Wechsel nach einer
// Generierung — so bleibt nichts vom alten Flyer hängen (Bild, Erfolgs-Badge,
// Format-Häkchen, Video, Caption, Vorher/Nachher). Formularfelder und das
// hochgeladene Logo bleiben bewusst erhalten.
export function resetToPreview(e) {
  if (e && e.preventDefault) e.preventDefault();
  exitBeforeMode();      // Vorher/Nachher zurück auf den fertigen Flyer
  resetCorrectState();   // Korrektur-Verlauf verwerfen
  resetVideo();          // laufende Animation stoppen, Video-Bereich leeren
  resetCaption();        // Caption-Box leeren
  resetFormatsState();   // gecachte Formate + Kachel-Häkchen + Beta-Toggles weg
  // Generiertes Bild aus State + Vorschau entfernen.
  state.master = null; state.masterImg = null;
  state.last = null;   state.lastImg = null;
  if (els.resultImg) els.resultImg.removeAttribute("src");
  showStage("preview");
  import("./preview.js").then((m) => m.updateLivePreview());
}
