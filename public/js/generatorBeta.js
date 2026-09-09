// BETA-Befuellweg im User-Flow. Eigener Knopf, eigener Ablauf, eigene Abfrage.
// generate() in generator.js und der Weg darunter bleiben unberuehrt; geteilt
// werden nur die Anzeige-Helfer (Bühne, Fortschrittstext, Ergebnis) und das
// Formular-Auslesen, damit beide Wege dasselbe Formular verstehen.
//
// Eigene Abfrage statt pollUntilDone, aus zwei Gruenden:
//   1. Ein Lauf mit zehn Boxen dauert mehrere Minuten — MAX_POLL_MS liegt bei
//      180 s und wuerde vorher abbrechen.
//   2. Der Beta-Job liefert eine Data-URL; proxyUrl() wuerde die zerlegen.

import { els } from "./dom.js";
import { postGenerateBeta, getJobStatus, friendlyMessage } from "./api.js";
import { showStage, readEventForm, showResult } from "./generator.js";
import { toast } from "./toast.js";

const POLL_MS = 3000;
const MAX_MS = 12 * 60 * 1000;   // Luft, falls Aufrufe wiederholt werden muessen

function setBetaButton(laeuft) {
  if (els.genBtnBeta) els.genBtnBeta.disabled = laeuft;
  if (els.genBtn) els.genBtn.disabled = laeuft;          // den alten Weg derweil sperren
  if (!els.genTxtBeta) return;
  if (laeuft) els.genTxtBeta.innerHTML = '<span class="spinner"></span> Beta läuft…';
  else els.genTxtBeta.textContent = "Flyer generieren (Beta)";
}

// Fortschritt aus dem Job in den Ladetext schreiben, damit sichtbar ist, bei
// welcher Box der Lauf steht.
function zeigeFortschritt(f) {
  if (!f || !els.skelMsg) return;
  if (f.phase === "vision") els.skelMsg.textContent = "Platzhalter im Template suchen…";
  else if (f.phase === "raeumen") els.skelMsg.textContent = `Leere Felder entfernen (${f.boxen})…`;
  else if (f.phase === "fuellen") els.skelMsg.textContent = `Feld ${f.schritt} von ${f.gesamt}: ${f.token}`;
}

async function warteAufErgebnis(jobId) {
  const start = Date.now();
  while (true) {
    if (Date.now() - start > MAX_MS) throw new Error("Zeitüberschreitung: der Beta-Lauf dauert zu lange.");
    await new Promise((r) => setTimeout(r, POLL_MS));
    const job = await getJobStatus(jobId);
    if (job.status === "pending") { zeigeFortschritt(job.fortschritt); continue; }
    if (job.status === "error") throw new Error(job.error || "Fehler.");
    if (!job.url) throw new Error("Kein Bild erhalten.");
    // Data-URL, bewusst NICHT durch proxyUrl. warnung traegt ein Teilergebnis.
    return { url: job.url, warnung: job.warnung || "" };
  }
}

export async function generateBeta() {
  const name = document.getElementById("fName");
  const datum = document.getElementById("fDate");
  if (!name || !name.value.trim() || !datum || !datum.value.trim()) {
    if (els.errBox) { els.errBox.textContent = "Bitte Event-Name und Datum ausfüllen."; els.errBox.style.display = "block"; }
    return;
  }
  if (els.errBox) { els.errBox.textContent = ""; els.errBox.style.display = "none"; }

  const vorher = els.stateResult && els.stateResult.style.display !== "none" ? "result" : "preview";
  setBetaButton(true);
  showStage("loading");
  // BEWUSST ohne startProgress(): das schreibt im 2,5-s-Takt in dasselbe
  // Element und wuerde die Box-Anzeige ueberschreiben.
  if (els.skelMsg) els.skelMsg.textContent = "Beta-Lauf startet…";

  try {
    const jobId = await postGenerateBeta(readEventForm());
    const { url, warnung } = await warteAufErgebnis(jobId);
    await showResult(url);
    if (warnung) {
      // Teilergebnis: sichtbar im Fehlerkasten UND als Hinweis, damit niemand
      // den Flyer fuer fertig haelt. Bewusst kein Erfolgs-Ton.
      if (els.errBox) { els.errBox.textContent = warnung; els.errBox.style.display = "block"; }
      toast(warnung, { type: "error" });
    } else {
      toast("Deine Grafik ist fertig (Beta)", { type: "success" });
    }
  } catch (e) {
    showStage(vorher);
    const msg = friendlyMessage(e);
    if (els.errBox) { els.errBox.textContent = msg; els.errBox.style.display = "block"; }
    toast(msg, { type: "error" });
  } finally {
    setBetaButton(false);
  }
}
