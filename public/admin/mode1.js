// Modus 1: Flyer → PROMPT. Reiner PROMPT-GENERATOR (keine Bildgenerierung).
// Upload fertiger Flyer → Vision erkennt Textzonen + Rollen → der bestehende
// Platzhalter-Prompt-Builder erzeugt den perfekten Prompt, den man kopiert und
// selbst in ChatGPT (mit dem Original-Flyer) einfügt. KEINE Ideogram-/GPT-Image-
// Aufrufe mehr in diesem Modus.

import { post } from "./studioApi.js";
import { fileToDataUrl, notify, wireDropzone, wirePaste } from "./studioUi.js";

const $ = (id) => document.getElementById(id);

// Pflicht-Platzhalter (Soll-Liste) — ein Template soll sie alle enthalten.
const MANDATORY = ["HEADLINE", "SUBLINE", "DATUM", "UHRZEIT", "LOCATION",
  "DJ NAME 1", "DJ NAME 2", "DJ NAME 3", "CLUBNAME", "WEBSITE"];
// Dropdown je Zone: Pflichtrollen + "ENTFERNEN" (→ REMOVE-Abschnitt) +
// "BEHALTEN" (→ KEEP-Abschnitt, Text bleibt unverändert erhalten).
const ROLES = [...MANDATORY, "ENTFERNEN", "BEHALTEN"];

const state = {
  current: null,   // hochgeladener Flyer (data-URL) — nur als Vision-Eingabe + Vorschau
  zones: [],
  fontRefIdx: -1,  // Font-Referenz für ergänzte Felder (Index in zones, -1 = automatisch)
};

function setBusy(on, msg) {
  $("m1Busy").hidden = !on;
  if (msg) $("m1BusyMsg").textContent = msg;
}

// Hochgeladenen Flyer als Vorschau-Thumbnail zeigen + als Vision-Eingabe merken.
function showThumb(dataUrl) {
  state.current = dataUrl;
  const t = $("m1Thumb");
  t.src = dataUrl;
  t.hidden = false;
}

async function onFile(file) {
  try {
    const dataUrl = await fileToDataUrl(file);
    $("m1DropLabel").textContent = file.name;
    showThumb(dataUrl);
    notify("Flyer geladen — jetzt Textzonen erkennen", "success");
  } catch (e) {
    notify(e.message, "error");
  }
}

function renderZones() {
  const wrap = $("m1Zones");
  wrap.innerHTML = "";
  state.zones.forEach((z, i) => {
    const row = document.createElement("div");
    row.className = "zone-row";
    // Erkannten Text editierbar machen — die Vision-OCR liest z.B. vertikal
    // gedrehten Text mal falsch; Korrektur fließt direkt in den Prompt.
    const text = document.createElement("input");
    text.type = "text";
    text.className = "zone-text";
    text.value = z.text || "";
    text.title = "Erkannten Text bei Bedarf korrigieren";
    text.placeholder = "(leer)";
    text.addEventListener("input", () => { state.zones[i].text = text.value; scheduleRebuild(); });
    const sel = document.createElement("select");
    sel.className = "zone-role";
    for (const r of ROLES) {
      const o = document.createElement("option");
      o.value = r;
      o.textContent = r === "ENTFERNEN" ? "✕ ENTFERNEN" : r === "BEHALTEN" ? "✓ BEHALTEN" : r;
      if (r === z.role) o.selected = true;
      sel.appendChild(o);
    }
    const markState = () => {
      row.classList.toggle("zone-remove", sel.value === "ENTFERNEN");
      row.classList.toggle("zone-keep", sel.value === "BEHALTEN");
    };
    sel.addEventListener("change", () => { state.zones[i].role = sel.value; markState(); updateMissing(); scheduleRebuild(); });
    markState();
    row.appendChild(text);
    row.appendChild(sel);
    wrap.appendChild(row);
  });
  $("m1ZonesCard").hidden = state.zones.length === 0;
  updateMissing();
}

// Soll-Abgleich: welche Pflicht-Platzhalter sind noch keiner Zone zugewiesen?
// Die werden im Prompt aktiv ergänzt — hier sichtbar gemacht.
function updateMissing() {
  const el = $("m1Missing");
  if (!el) return;
  const assigned = new Set(state.zones.map((z) => z.role).filter((r) => MANDATORY.includes(r)));
  const missing = MANDATORY.filter((r) => !assigned.has(r));
  el.innerHTML = "";
  if (!state.zones.length) { el.hidden = true; return; }
  el.hidden = false;
  if (!missing.length) {
    el.innerHTML = '<span class="miss-ok">✓ alle Pflicht-Platzhalter abgedeckt</span>';
    return;
  }
  const head = document.createElement("span");
  head.className = "miss-head";
  head.textContent = `wird ergänzt (${missing.length}):`;
  el.appendChild(head);
  for (const r of missing) {
    const chip = document.createElement("span");
    chip.className = "miss-chip";
    chip.textContent = r;
    el.appendChild(chip);
  }
}

async function analyze() {
  if (!state.current) return notify("Erst einen Flyer hochladen", "error");
  const btn = $("m1Analyze");
  btn.disabled = true;
  setBusy(true, "Erkenne Textzonen …");
  try {
    const { zones, prompt } = await post("/admin/analyze", {
      mode: "flyer",
      image: state.current,
      model: $("m1Model").value,
    });
    // font für die Font-Referenz behalten. Nicht-Pflichtrollen (OTHER, Credits)
    // als ENTFERNEN vorbelegen — im Dropdown änderbar.
    state.zones = (zones || []).map((z) => ({
      text: z.text || "",
      role: MANDATORY.includes(z.role) ? z.role : "ENTFERNEN",
      font: z.font && typeof z.font === "object" ? z.font : null,
    }));
    state.fontRefIdx = -1;
    renderZones();
    populateFontRef();
    $("m1Prompt").value = prompt || ""; // Fallback; gleich aus echtem Stand neu bauen
    autoGrow();
    $("m1Rebuild").hidden = false;
    // Prompt aus dem tatsächlichen Zonen-Stand (inkl. auto-ENTFERNEN) erzeugen,
    // damit der REMOVE-Abschnitt und die richtigen Rollen sofort drin sind.
    rebuildPrompt({ silent: true });
    notify(`${state.zones.length} Textzonen erkannt`, "success");
  } catch (e) {
    notify(e.message, "error");
  } finally {
    btn.disabled = false;
    setBusy(false);
  }
}

// Font-Referenz: gewählte Zone als Stil-Anker {text, font} (oder null).
function refForPrompt() {
  const z = state.fontRefIdx >= 0 ? state.zones[state.fontRefIdx] : null;
  return z ? { text: z.text, font: z.font } : null;
}

// Dropdown „Font-Referenz für ergänzte Felder" mit den erkannten Zonen füllen.
function populateFontRef() {
  const sel = $("m1RefInfo"), box = $("m1FontRef");
  if (!sel || !box) return;
  sel.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "-1"; auto.textContent = "automatisch (Sekundär-Stil)";
  sel.appendChild(auto);
  state.zones.forEach((z, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    const hint = z.font ? " · " + [z.font.style, z.font.casing].filter(Boolean).join("/") : "";
    o.textContent = (z.text || "(leer)").slice(0, 28) + hint;
    sel.appendChild(o);
  });
  sel.value = String(state.fontRefIdx);
  box.hidden = state.zones.length === 0;
}

let rebuildSeq = 0;       // Race-Schutz: nur die jeweils LETZTE Antwort gilt
let rebuildTimer = null;  // Debounce für schnelle Mehrfach-Auswahlen

// Prompt aus dem AKTUELLEN Stand (Rollen + ENTFERNEN + Font-Referenz + fehlende
// Platzhalter) neu bauen. silent = leise (kein Toast) für Live-Updates.
async function rebuildPrompt({ silent = false } = {}) {
  if (!state.zones.length) return;
  const seq = ++rebuildSeq;
  try {
    const { prompt } = await post("/admin/build-placeholder-prompt", {
      zones: state.zones,
      infoRef: refForPrompt(),
    });
    if (seq !== rebuildSeq) return; // veraltete Antwort verwerfen
    $("m1Prompt").value = prompt;
    autoGrow();
    flashPrompt();
    if (!silent) notify("Prompt aktualisiert (Rollen + Font-Referenz)", "success");
  } catch (e) {
    if (seq === rebuildSeq) notify(e.message, "error");
  }
}

// Jede UI-Auswahl stößt den Neuaufbau leise an — gebündelt, damit schnelle
// Klicks den Server nicht fluten; die letzte Auswahl gewinnt.
function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { rebuildTimer = null; rebuildPrompt({ silent: true }); }, 220);
}

// Kurzes Aufblitzen des Prompt-Feldes, damit die Live-Aktualisierung sichtbar ist.
function flashPrompt() {
  const el = $("m1Prompt");
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth; // Reflow → Animation neu starten
  el.classList.add("flash");
}

// Prompt-Feld auf seinen Inhalt wachsen lassen — der ganze Prompt bleibt sichtbar,
// ohne inneres Mini-Scrollen (die Studio-Seite scrollt stattdessen).
function autoGrow() {
  const el = $("m1Prompt");
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.max(el.scrollHeight + 2, 320) + "px";
}

// ── Kopieren in die Zwischenablage ─────────────────────────────────────────
const COPY_LABEL = "📋 Prompt kopieren";

function flashCopied() {
  const b = $("m1Copy");
  b.textContent = "✓ Kopiert!";
  b.classList.add("copied");
  setTimeout(() => { b.textContent = COPY_LABEL; b.classList.remove("copied"); }, 1600);
}

function fallbackCopy(done) {
  const ta = $("m1Prompt");
  ta.focus(); ta.select();
  try { document.execCommand("copy"); done(); ta.setSelectionRange(0, 0); }
  catch { notify("Kopieren nicht möglich — bitte Text manuell markieren (Cmd/Ctrl+A, dann Cmd/Ctrl+C)", "error"); }
}

function copyPrompt() {
  const text = $("m1Prompt").value;
  if (!text.trim()) return notify("Noch kein Prompt — erst Textzonen erkennen", "info");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flashCopied).catch(() => fallbackCopy(flashCopied));
  } else {
    fallbackCopy(flashCopied);
  }
}

export function initMode1() {
  const file = $("m1File");
  // WICHTIG (iOS Safari): #m1Drop ist ein <label>, das den Input umschliesst — der
  // Klick/Tipp oeffnet den Dialog schon ueber die native Label-Assoziation. Ein
  // ZUSAETZLICHES file.click() erzeugte einen Doppel-Trigger, den iOS verwirft
  // (Dialog oeffnet, aber die Auswahl kommt nie als change an -> Upload haengt still).
  // Darum KEIN file.click() mehr — exakt wie die funktionierenden Auto-Flows.
  file.addEventListener("change", () => { if (file.files[0]) onFile(file.files[0]); file.value = ""; });
  // Upload ohne Dialog: Drag&Drop + Paste (Klick laeuft ueber die Label-Assoziation).
  wireDropzone($("m1Drop"), onFile);
  wirePaste($("panel-mode1"), onFile);

  $("m1Analyze").addEventListener("click", analyze);
  $("m1Rebuild").addEventListener("click", rebuildPrompt);
  $("m1Copy").addEventListener("click", copyPrompt);
  // Manuelle Prompt-Änderungen: Höhe mitwachsen lassen.
  $("m1Prompt").addEventListener("input", autoGrow);

  // Font-Referenz für ergänzte Felder: Auswahl → Prompt live neu bauen.
  $("m1RefInfo").addEventListener("change", (e) => { state.fontRefIdx = Number(e.target.value); scheduleRebuild(); });
}
