// Prompting Tool, 3. Werkzeug: Varianten-Prompts. Ein Referenzflyer -> 10 fertige
// Text-Prompts via Sonnet (EIN Aufruf, KEINE Bilderzeugung). Nutzt die geteilten
// Studio-Helfer (studioUi) und das gemeinsame Admin-Token (studioApi). Ändert kein
// bestehendes Werkzeug; hängt sich nur an das eigene Panel #panel-variants.

import { fileToDataUrl, wireDropzone, wirePaste, notify, installErrorSurface } from "./studioUi.js";
import { post } from "./studioApi.js";

const $ = (id) => document.getElementById(id);
let dataUrl = null;
let busy = false;
let currentPrompts = [];

export function initVariants() {
  installErrorSurface(); // bislang stille Fehler ab jetzt sichtbar (v. a. iOS)
  const panel = $("panel-variants");
  if (!panel || panel.dataset.wired) return; // nur einmal verdrahten
  panel.dataset.wired = "1";

  const onFile = async (file) => {
    const st = $("vpStatus");
    if (!file) { if (st) st.textContent = "Keine Datei erhalten — bitte erneut wählen."; return; }
    // SOFORT sichtbar, sobald eine Datei ankommt — so ist auf iOS erkennbar, ob die
    // Auswahl ueberhaupt im Code ankommt (change gefeuert) oder ob das Einlesen haengt.
    if (st) st.textContent = "Verarbeite " + (file.name || "Bild") + " (" + Math.round((file.size || 0) / 1024) + " KB) …";
    try {
      dataUrl = await fileToDataUrl(file);
      const thumb = $("vpThumb");
      thumb.src = dataUrl; thumb.hidden = false;
      $("vpDropLabel").textContent = "Anderes Bild wählen (tippen, ziehen oder einfügen)";
      $("vpGo").disabled = false;
      if (st) st.textContent = "Bild geladen ✓ — bereit für „10 Prompts erzeugen“.";
    } catch (e) {
      const msg = (e && e.message) || "Bild konnte nicht gelesen werden";
      if (st) st.textContent = "Upload-Fehler: " + msg;
      notify(msg, "error");
    }
  };

  wireDropzone($("vpDrop"), onFile);
  wirePaste(panel, onFile);
  // change-Handler mit value-Reset: erlaubt, dieselbe Datei erneut zu wählen (iOS
  // feuert change sonst nicht ein zweites Mal).
  $("vpFile").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    onFile(f || null);
    e.target.value = "";
  });
  $("vpGo").addEventListener("click", generate);
  panel.addEventListener("click", onResultClick);
}

async function generate() {
  if (busy) return;
  if (!dataUrl) { notify("Erst einen Flyer wählen", "info"); return; }
  busy = true;
  const go = $("vpGo"), status = $("vpStatus");
  go.disabled = true; go.textContent = "Erzeuge 10 Prompts …";
  status.textContent = "Ein Sonnet-Aufruf, das dauert einen Moment.";
  $("vpResults").innerHTML = "";
  try {
    const r = await post("/admin/variant-prompts", { image: dataUrl });
    const prompts = Array.isArray(r.prompts) ? r.prompts : [];
    if (!prompts.length) { status.textContent = "Keine Prompts erhalten. Bitte erneut auslösen."; return; }
    renderPrompts(prompts, !!r.incomplete);
    status.textContent = prompts.length + " Prompts" + (r.incomplete ? " (unvollständig, du kannst erneut auslösen)" : " fertig");
  } catch (e) {
    if (e.message === "401") return; // studioApi.post hat schon zum Gate geleitet
    status.textContent = "Fehlgeschlagen: " + (e.message || "unbekannt") + " — bitte erneut auslösen.";
    notify("Prompt-Erzeugung fehlgeschlagen", "error");
  } finally {
    busy = false; go.disabled = false; go.textContent = "10 Prompts erzeugen";
  }
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function renderPrompts(prompts, incomplete) {
  currentPrompts = prompts;
  const head =
    '<div class="vp-head"><span class="vp-count">' + prompts.length + " Varianten-Prompts</span>" +
    '<button class="rbtn rbtn-ghost" id="vpCopyAll" type="button">Alle kopieren</button></div>' +
    (incomplete ? '<div class="vp-warn">Es kamen weniger als 10 Prompts zurück. Du kannst oben erneut auslösen.</div>' : "");
  const blocks = prompts.map((p, i) =>
    '<div class="vp-block"><div class="vp-block-head"><span class="vp-num">Variante ' + (i + 1) + "</span>" +
    '<span class="vp-done">✓ kopiert</span>' +
    '<button class="rbtn rbtn-ghost vp-copy" data-i="' + i + '" type="button">Kopieren</button></div>' +
    '<div class="vp-text">' + esc(p) + "</div></div>").join("");
  $("vpResults").innerHTML = head + '<div class="vp-list">' + blocks + "</div>";
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) { notify("Kopieren nicht möglich", "error"); return false; }
}

// Kurzes Klick-Feedback am Button (Text wechselt kurz), Original einmalig gemerkt.
function flash(btn) {
  if (!btn) return;
  if (!btn.dataset.orig) btn.dataset.orig = btn.textContent;
  btn.textContent = "Kopiert ✓";
  clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = btn.dataset.orig; }, 1200);
}

async function onResultClick(e) {
  const all = e.target.closest("#vpCopyAll");
  if (all) {
    const ok = await copyText(currentPrompts.map((p, i) => "Variante " + (i + 1) + ":\n" + p).join("\n\n---\n\n"));
    if (!ok) return;
    flash(all);
    // "Alle kopieren" markiert alle Blöcke als kopiert (nur diese Ansicht).
    $("vpResults").querySelectorAll(".vp-block").forEach((b) => b.classList.add("vp-copied"));
    return;
  }
  const c = e.target.closest(".vp-copy");
  if (c) {
    const ok = await copyText(currentPrompts[+c.dataset.i] || "");
    if (!ok) return;
    flash(c);
    const block = c.closest(".vp-block");
    if (block) block.classList.add("vp-copied"); // bleibende Markierung, erneut kopieren bleibt möglich
    return;
  }
}
