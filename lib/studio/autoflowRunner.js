"use strict";

// Serverseitiger Auto-Flow-Orchestrator. Treibt den Lauf IM NODE-PROZESS an (nicht mehr im
// Browser): Analyse -> Varianten-Prompts -> Generierung -> fal-Outpaint -> jedes Bild sofort
// in R2. Zustand durabel in run.json (Status je Template + Gesamtstatus + Heartbeat). Nutzt
// die GESPIEGELTEN Inhaltsfunktionen (autoflowGen) -> inhaltlich identisch zum bisherigen
// browsergetriebenen Weg. Fortsetzbar: bereits fertige Bilder (in R2) werden uebersprungen
// (kein Doppelzahlen), bereits berechnete Prompts ebenfalls.

const store = require("./autoflowStore");
const gen = require("./autoflowGen");
const cleanFlow = require("./cleanFlow"); // Clean-Flow: fester, kurzer Prompt statt Analyse
const templateSource = require("../templateSource"); // Redesign: Eingang aus dem BESTAND statt Upload

const active = new Map(); // runId -> { cancel: bool }  (nur solange DIESER Prozess den Lauf treibt)
const P = "[AUTOFLOW-RUN]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };
const nowIso = () => new Date().toISOString();

// Bild-Typ aus der Dateiendung (wie reformat916.ctypeOf) — fuer den Bestands-Eingang.
function ctypeOf(file) {
  const f = String(file).toLowerCase();
  return f.endsWith(".png") ? "image/png" : f.endsWith(".webp") ? "image/webp" : "image/jpeg";
}

function isBlocked(msg) {
  return /safety|moderation|content.?polic|rejected|blocked|\[sexual\]|not allowed|violat/i.test(msg || "");
}

// ── Handzuordnung aus dem Prompting Tool (optional, ZUSAETZLICHER Eingang) ──
// Kommt aus dem Browser, also nur die Felder uebernehmen, die der Prompt-Bauer liest, und
// nichts anderes in die run.json lassen. Nichts Brauchbares dabei -> null, und der Lauf faehrt
// exakt den bisherigen Weg.
function cleanZones(z) {
  if (!Array.isArray(z)) return null;
  const out = [];
  for (const x of z) {
    if (!x || typeof x !== "object") continue;
    const text = typeof x.text === "string" ? x.text : "";
    const role = typeof x.role === "string" ? x.role : "";
    if (!text.trim() || !role.trim()) continue;
    out.push({ text, role, font: x.font && typeof x.font === "object" ? x.font : null });
  }
  return out.length ? out : null;
}

// Font-Referenz fuer die ergaenzten Felder (mode1 refForPrompt): { text, font } oder null.
function cleanRef(r) {
  if (!r || typeof r !== "object") return null;
  const text = typeof r.text === "string" ? r.text : "";
  if (!text.trim()) return null;
  return { text, font: r.font && typeof r.font === "object" ? r.font : null };
}

// Neuen Lauf anlegen: Eingabebilder + Plan nach R2, sofort Lauf-ID zurueck, Orchestrierung im
// Hintergrund starten. spec: { flow, mode, loose, textOnly, variants, model, refType, regelwerk,
// files:[{ name, dataUrl, zones?, infoRef? }] }. zones/infoRef sind der ZUSAETZLICHE Eingang aus
// dem Prompting Tool (geprueftes Rollen-Mapping); fehlen sie, laeuft alles wie bisher.
async function startRun(spec) {
  const flow = String(spec.flow || "?");
  const files = Array.isArray(spec.files) ? spec.files : [];
  if (!files.length) throw new Error("Keine Dateien");
  const variants = Math.max(0, Math.min(24, parseInt(spec.variants, 10) || 0));
  const stamp = nowIso().replace(/[:.]/g, "-");
  const runId = "af" + flow + "-" + stamp + "-" + Math.random().toString(36).slice(2, 6);
  const createdAt = nowIso();

  const stateFiles = [], tiles = [];
  for (let i = 0; i < files.length; i++) {
    const fnum = i + 1;
    // ZWEI Eingaenge: wie bisher eine Data-URL vom Rechner ODER (Redesign) ein Template-Pfad
    // aus dem Bestand, serverseitig ueber templateSource geholt. Ab putInput ist beides gleich.
    const srcTemplate = typeof files[i].template === "string" ? files[i].template.trim() : "";
    let pic;
    if (srcTemplate) {
      const buf = await templateSource.getTemplateFile(srcTemplate);
      if (!buf || !buf.length) throw new Error("Template nicht lesbar: " + srcTemplate);
      pic = { buffer: buf, mediaType: ctypeOf(srcTemplate) };
    } else {
      pic = gen.parseDataUrl(files[i].dataUrl);
    }
    if (!pic) throw new Error("Ungueltiges Bild (Datei " + fnum + ")");
    const { ext } = await store.putInput(runId, fnum, pic.buffer, pic.mediaType);
    stateFiles.push({
      fnum, name: String(files[i].name || ("flyer" + fnum)), srcExt: ext, dna: null,
      // Quell-Pfad des Bestands-Templates (nur Redesign, sonst ""). OHNE ihn gibt es nach einem
      // Lauf ueber N Vorlagen keine Zuordnung Kandidat -> Original.
      srcTemplate,
      mainPrompt: "", variantPrompts: [], analyzeError: null,
      // Geprueftes Rollen-Mapping (oder null = bisheriger Weg). Gehoert in den Zustand, damit
      // Fortsetzen und Wiederanlauf denselben Prompt bauen wie der erste Versuch.
      handZones: cleanZones(files[i].zones), infoRef: cleanRef(files[i].infoRef),
    });
    // Clean-Flow-Varianten: KEIN Hauptflyer, direkt N Varianten-Kacheln. Sonst wie bisher
    // (Hauptkachel + optionale Varianten). cleanVariant nur, wenn Clean-Flow UND variants > 0.
    const cleanVariant = !!spec.cleanFlow && variants > 0;
    if (!cleanVariant) tiles.push({ fnum, index: fnum + "-haupt", kind: "main", num: 0, status: "pending", reason: "" });
    for (let k = 1; k <= variants; k++) tiles.push({ fnum, index: fnum + "-v" + k, kind: "variant", num: k, status: "pending", reason: "" });
  }
  const state = {
    runId, flow, mode: String(spec.mode || ""), createdAt, updatedAt: createdAt,
    status: "running", cancelRequested: false,
    loose: !!spec.loose, textOnly: !!spec.textOnly, variants, model: spec.model || "sonnet", refType: spec.refType || "single",
    // A/B-Schalter: gehoert in den Zustand, damit ein Fortsetzen denselben Modus faehrt und
    // die Laufliste zeigt, welcher Lauf mit Regelwerk gefahren wurde.
    regelwerk: !!spec.regelwerk,
    // Ebenso fuer den zweiten A/B-Vergleich: lief der Lauf mit Handzuordnung oder mit der
    // Auto-Analyse? Nur fuer die Anzeige — massgeblich ist handZones je Datei.
    hand: stateFiles.some((f) => f.handZones),
    // Clean-Flow: fester, kurzer Prompt statt Analyse/Regelwerk. Nur Clean-Flow setzt das;
    // bestehende Flows senden es nie und laufen damit zeichengleich weiter.
    cleanFlow: !!spec.cleanFlow,
    // Clean-Flow-Varianten: hat der Flyer ein Hauptmotiv? Voreinstellung true (Mit Hauptmotiv);
    // nur wenn ausdruecklich false uebergeben -> Ohne-Hauptmotiv-Satz. Gehoert in den Zustand,
    // damit Fortsetzen/Wiederanlauf denselben Prompt bauen.
    cleanSubject: spec.cleanSubject !== false,
    // Clean-Flow-Artwork: Eingabe ist ein Foto (kein Flyer) -> Artwork-Prompt + Kontrast-Farbwelten.
    cleanArtwork: !!spec.cleanArtwork,
    // Clean-Flow-Redesign: Eingabe ist ein FERTIGES Template aus dem Bestand -> nur die
    // Textsetzung wird neu gemacht. Immer genau ein Kandidat je Vorlage (variants = 1).
    cleanRedesign: !!spec.cleanRedesign,
    files: stateFiles, tiles,
  };
  await store.putState(runId, state);
  orchestrate(runId).catch((e) => log("Orchestrate-Fehler " + runId + ": " + (e && e.message ? e.message : e)));
  return { runId };
}

// Redesign-Stapel: je Datei reihum EINE Stilrichtung aus der kuratierten Liste als Sonnet-
// Vorgabe — Mechanik gegen die Stil-Wiederholung im Stapel, die Streuung ist garantiert statt
// erbeten. Offset aus dem Lauf-Zeitstempel, sonst beginnt jeder Stapel mit derselben Richtung.
// createdAt liegt im persistierten Zustand: ein fortgesetzter Lauf behaelt dieselbe Zuordnung.
function redesignDirection(state, file) {
  const dirs = gen.REDESIGN_DIRECTIONS;
  if (!Array.isArray(dirs) || !dirs.length) return "";
  const off = Math.abs(Date.parse(state.createdAt) || 0) % dirs.length;
  const fnum = Number(file.fnum) || 1;
  return dirs[(off + (fnum - 1)) % dirs.length];
}

async function persist(state) {
  state.updatedAt = nowIso();
  try { await store.putState(state.runId, state); } catch (e) { log("putState fehlgeschlagen: " + (e && e.message ? e.message : e)); }
}

function cancelledNow(runId, state) {
  const rec = active.get(runId);
  return !!((rec && rec.cancel) || (state && state.cancelRequested));
}

// Den Lauf abarbeiten. Idempotent/fortsetzbar: laeuft einen bestehenden Zustand weiter,
// ueberspringt bereits fertige Bilder (in R2) und bereits berechnete Prompts.
async function orchestrate(runId) {
  if (active.has(runId)) return; // in DIESEM Prozess schon in Arbeit
  active.set(runId, { cancel: false });
  try {
    const state = await store.getState(runId);
    if (!state || state.status !== "running") return;
    if (state.cancelRequested) return finalize(runId, state, "cancelled");

    // Regelwerk EINMAL je Lauf laden (nur bei eingeschaltetem A/B-Schalter). Nicht in den
    // Zustand schreiben — es gehoert nicht in die run.json und wird beim Fortsetzen neu geholt.
    const ruleset = state.regelwerk ? await gen.loadRuleset() : null;
    if (state.regelwerk && !ruleset) log("Regelwerk eingeschaltet, aber keins ladbar — Lauf " + runId + " faehrt ohne");

    for (const file of state.files) {
      if (cancelledNow(runId, state)) return finalize(runId, state, "cancelled");
      const fileTiles = state.tiles.filter((t) => t.fnum === file.fnum);

      // 1) Analyse + Prompts (nur falls noch nicht vorhanden -> kein Doppelzahlen bei Fortsetzen).
      //    Bei Clean-Flow-Varianten gibt es keinen mainPrompt; dort dienen die variantPrompts als
      //    Sentinel, damit der Sonnet-Aufruf beim Fortsetzen nicht wiederholt wird.
      if (!file.mainPrompt && !(file.variantPrompts && file.variantPrompts.length)) {
        // ── Clean-Flow: keine Analyse, kein Regelwerk. Nachbau -> fester Prompt. Varianten ->
        //    EIN Sonnet-Aufruf aus dem Bild, N kurze Varianten-Prompts. Danach laeuft alles wie
        //    gewohnt (editImage + R2). ──
        if (state.cleanFlow) {
          if (state.variants > 0) {
            try {
              const input = await store.getInput(runId, file.fnum, file.srcExt);
              const base = {
                imageBase64: input.buffer.toString("base64"), mediaType: input.contentType,
                count: state.variants, model: state.model,
              };
              // Artwork und Redesign haben je einen EIGENEN Sonnet-Aufruf (komplette Regie).
              // Der Rohtext wird bewusst VERWORFEN — er gehoert nicht in den Lauf-Zustand, der
              // nach R2 persistiert wird; nur die Vorschau zeigt ihn.
              file.variantPrompts = state.cleanRedesign
                ? (await gen.cleanRedesign({ ...base, direction: redesignDirection(state, file) })).prompts
                : state.cleanArtwork
                ? (await gen.cleanArtworks(base)).prompts
                : await gen.cleanVariants({ ...base, subject: state.cleanSubject !== false });
              if (!file.variantPrompts.length) throw new Error("Keine Varianten-Vorgaben erhalten");
              await persist(state);
            } catch (e) {
              file.analyzeError = e.message;
              for (const t of fileTiles) if (t.status === "pending") { t.status = "error"; t.reason = "Varianten: " + e.message; }
              await persist(state);
              continue;
            }
          } else {
            file.mainPrompt = cleanFlow.CLEAN_PROMPT;
            await persist(state);
          }
        } else try {
          // Auto-Flow 2 (beide Pfade): erweiterte Typo-Analyse + wörtliche Übernahme je Textrolle.
          const typo = String(state.flow) === "2";
          const input = await store.getInput(runId, file.fnum, file.srcExt);
          const a = await gen.analyze({
            imageBase64: input.buffer.toString("base64"), mediaType: input.contentType,
            model: state.model, loose: state.loose, typo, ruleset,
            // Gesetzt -> Handprompt statt Auto-Analyse-Prompt. Null -> alles wie bisher.
            handZones: file.handZones, infoRef: file.infoRef,
          });
          file.dna = a.dna; file.mainPrompt = a.mainPrompt;
          if (state.variants > 0) {
            try { file.variantPrompts = await gen.variantPrompts({
              dna: a.dna, count: state.variants, model: state.model, loose: state.loose, typo, ruleset,
              // Handpfad: Varianten ueber denselben Handprompt-Bauer wie der Hauptflyer.
              handZones: file.handZones, infoRef: file.infoRef,
            }); }
            catch (e) { log("Varianten-Prompts fehlgeschlagen (Datei " + file.fnum + "): " + e.message); file.variantPrompts = []; }
          }
          await persist(state);
        } catch (e) {
          file.analyzeError = e.message;
          for (const t of fileTiles) if (t.status === "pending") { t.status = "error"; t.reason = "Analyse: " + e.message; }
          await persist(state);
          continue; // naechste Datei
        }
      }

      // 2) Bilder erzeugen (Hauptflyer + Varianten)
      let input = null;
      for (const t of fileTiles) {
        if (t.status === "done") continue;
        if (cancelledNow(runId, state)) return finalize(runId, state, "cancelled");
        // Fortsetzen: existiert das Bild schon in R2, als fertig markieren (kein Neu-Erzeugen)
        if (await store.imageExists(runId, t.index)) { t.status = "done"; await persist(state); continue; }
        const prompt = t.kind === "main" ? file.mainPrompt : (file.variantPrompts[t.num - 1] && file.variantPrompts[t.num - 1].prompt);
        if (!prompt) { t.status = "error"; t.reason = "Kein Prompt"; await persist(state); continue; }
        t.status = "running"; await persist(state);
        try {
          if (!state.textOnly && !input) input = await store.getInput(runId, file.fnum, file.srcExt);
          const image = await gen.generateFinalImage({
            prompt, textOnly: state.textOnly,
            imageBuffer: state.textOnly ? null : input.buffer,
            imageType: state.textOnly ? null : input.contentType,
          });
          const outPic = gen.parseDataUrl(image);
          if (!outPic) throw new Error("Kein Ergebnisbild");
          await store.putResultImage(runId, t.index, outPic.buffer);
          t.status = "done"; await persist(state);
        } catch (e) {
          t.status = isBlocked(e.message) ? "blocked" : "error"; t.reason = e.message;
          await persist(state);
        }
      }
    }
    return finalize(runId, state, cancelledNow(runId, state) ? "cancelled" : "done");
  } finally {
    active.delete(runId);
  }
}

async function finalize(runId, state, status) {
  if (status === "cancelled") {
    for (const t of state.tiles) if (t.status === "pending" || t.status === "running") { t.status = "cancelled"; t.reason = "Abgebrochen"; }
  }
  state.status = status;
  await persist(state);
  log("Lauf " + runId + " -> " + status);
}

async function cancelRun(runId) {
  const rec = active.get(runId); if (rec) rec.cancel = true;
  const state = await store.getState(runId);
  if (!state) throw new Error("Lauf nicht gefunden");
  if (state.status === "running") { state.cancelRequested = true; await persist(state); }
  return { ok: true, status: state.status };
}

// Manuelles Fortsetzen eines (z. B. als unterbrochen dastehenden) Laufs.
async function resumeRun(runId) {
  const state = await store.getState(runId);
  if (!state) throw new Error("Lauf nicht gefunden");
  if (state.status === "done") return { ok: true, status: "done" };
  state.status = "running"; state.cancelRequested = false;
  await store.putState(runId, state);
  orchestrate(runId).catch(() => {});
  return { ok: true, status: "running" };
}

// Beim Serverstart: unterbrochene (status "running") Laeufe automatisch fortsetzen. Nicht
// blockierend, faengt alles ab. Nur sinnvoll bei ADMIN_TOOLS=1 + R2 (Aufrufer prueft das).
async function recoverRunning() {
  try {
    const r = await store.listRuns();
    if (!r || !r.ok) return;
    const running = (r.runs || []).filter((x) => x.status === "running");
    if (!running.length) return;
    log("Wiederanlauf: " + running.length + " unterbrochene(r) Lauf/Laeufe werden fortgesetzt");
    for (const x of running) orchestrate(x.runId).catch(() => {});
  } catch (e) { log("recoverRunning: " + (e && e.message ? e.message : e)); }
}

module.exports = { startRun, cancelRun, resumeRun, recoverRunning, orchestrate };
