// Studio-Werkzeug „Schlagworte": Flyer per Sonnet automatisch verschlagworten
// (Stapel, nacheinander, robust), einzeln von Hand nachbessern und den Speicher
// (templates/keywords.json) als Download exportieren (zum Committen = dauerhaft).
// Liest die Template-Liste aus dem öffentlichen /api/templates; schreibt über die
// admin-geschützten Endpunkte /admin/tag-one + /admin/keywords.

import { post, getToken } from "./studioApi.js";
import { notify } from "./studioUi.js";

const $ = (id) => document.getElementById(id);
let items = [];        // [{ file, name, category, thumb, src, keywords }]
let running = false;
let cancelled = false;

async function loadList() {
  const res = await fetch("/api/templates", { cache: "no-store" });
  const data = await res.json();
  items = (data.templates || []).map((t) => ({ ...t, keywords: t.keywords || [] }));
}

function taggedCount() { return items.filter((t) => t.keywords && t.keywords.length).length; }

function setStatus(txt) { const s = $("kwProgress"); if (s) s.textContent = txt; }
function updateHeader() {
  const c = $("kwCount");
  if (c) c.textContent = items.length + " Flyer · " + taggedCount() + " verschlagwortet";
}

// ── Stapel: alle (oder nur untagged) verschlagworten ──
async function tagAll() {
  if (running) return;
  await loadList();
  const force = $("kwForce") && $("kwForce").checked;
  const todo = force ? items.slice() : items.filter((t) => !(t.keywords && t.keywords.length));
  if (!todo.length) { setStatus("Nichts zu tun — alle bereits verschlagwortet."); return; }
  running = true; cancelled = false;
  $("kwTagAll").disabled = true; $("kwCancel").hidden = false;
  let done = 0, fail = 0, empty = 0, firstErr = "";
  for (const t of todo) {
    if (cancelled) break;
    setStatus("Verschlagworte " + (done + 1) + " von " + todo.length + " … (" + t.name + ")");
    try {
      const r = await post("/admin/tag-one", { file: t.file, force });
      const ks = r.keywords || [];
      const it = items.find((x) => x.file === t.file);
      if (it) it.keywords = ks;
      if (!ks.length) empty++;
    } catch (e) { fail++; if (!firstErr) firstErr = e.message; }
    done++;
    updateHeader();
  }
  running = false; $("kwTagAll").disabled = false; $("kwCancel").hidden = true;
  let msg = (cancelled ? "Abgebrochen — " : "Fertig — ") + taggedCount() + " von " + items.length + " verschlagwortet";
  if (fail) msg += " · " + fail + " Fehler" + (firstErr ? " (z. B.: " + firstErr + ")" : "");
  if (empty) msg += " · " + empty + " ohne Ergebnis";
  setStatus(msg);
  render();
}

// ── Einzeln speichern / bearbeiten (Hand-Nachbesserung) ──
async function saveKw(t) {
  try { const r = await post("/admin/keywords", { file: t.file, keywords: t.keywords }); t.keywords = r.keywords || []; updateHeader(); }
  catch (e) { notify("Speichern fehlgeschlagen: " + e.message, "error"); }
}
async function retagOne(t, rerender, btn) {
  btn.disabled = true; const old = btn.textContent; btn.textContent = "…";
  try { const r = await post("/admin/tag-one", { file: t.file, force: true }); t.keywords = r.keywords || []; rerender(); updateHeader(); }
  catch (e) { notify("Verschlagwortung fehlgeschlagen: " + e.message, "error"); }
  btn.disabled = false; btn.textContent = old;
}

function card(t) {
  const el = document.createElement("div"); el.className = "kw-card";
  const img = document.createElement("img"); img.className = "kw-thumb"; img.loading = "lazy"; img.src = t.thumb || t.src; img.alt = "";
  const body = document.createElement("div"); body.className = "kw-body";
  const head = document.createElement("div"); head.className = "kw-head";
  const name = document.createElement("span"); name.className = "kw-name"; name.textContent = t.name;
  const retag = document.createElement("button"); retag.type = "button"; retag.className = "kw-retag"; retag.textContent = "↻"; retag.title = "Neu verschlagworten (Sonnet)";
  head.appendChild(name); head.appendChild(retag);
  const chips = document.createElement("div"); chips.className = "kw-chips";
  const rerender = () => {
    chips.innerHTML = "";
    for (const w of (t.keywords || [])) {
      const c = document.createElement("span"); c.className = "kw-chip"; c.textContent = w;
      const x = document.createElement("button"); x.type = "button"; x.className = "kw-x"; x.textContent = "×";
      x.addEventListener("click", () => { t.keywords = (t.keywords || []).filter((k) => k !== w); rerender(); saveKw(t); });
      c.appendChild(x); chips.appendChild(c);
    }
    const add = document.createElement("input"); add.className = "kw-add"; add.placeholder = "+ Schlagwort";
    add.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return; e.preventDefault();
      const v = (add.value || "").toLowerCase().trim();
      if (v && !(t.keywords || []).includes(v)) { t.keywords = [...(t.keywords || []), v]; rerender(); saveKw(t); }
      add.value = "";
    });
    chips.appendChild(add);
  };
  rerender();
  retag.addEventListener("click", () => retagOne(t, rerender, retag));
  body.appendChild(head); body.appendChild(chips);
  el.appendChild(img); el.appendChild(body);
  return el;
}

function render() {
  const wrap = $("kwList"); if (!wrap) return;
  const cat = $("kwCat") ? $("kwCat").value : "__all";
  const onlyUntagged = $("kwUntagged") && $("kwUntagged").checked;
  const q = ($("kwSearch") ? $("kwSearch").value : "").toLowerCase().trim();
  let list = items;
  if (cat !== "__all") list = list.filter((t) => t.category === cat);
  if (onlyUntagged) list = list.filter((t) => !(t.keywords && t.keywords.length));
  if (q) list = list.filter((t) => (t.name || "").toLowerCase().includes(q) || (t.keywords || []).some((k) => k.includes(q)));
  wrap.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const t of list.slice(0, 400)) frag.appendChild(card(t)); // Deckel für Performance
  wrap.appendChild(frag);
  const shown = $("kwShown"); if (shown) shown.textContent = list.length + " angezeigt" + (list.length > 400 ? " (erste 400)" : "");
}

async function download() {
  try {
    const res = await fetch("/admin/keywords/export", { headers: { "X-Admin-Token": getToken() } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "keywords.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { notify("Export fehlgeschlagen: " + e.message, "error"); }
}

// Diagnose: EINEN Flyer taggen und sichtbar zeigen, was das Modell liefert UND ob
// es in der Bibliothek ankommt (persistiert). Ein Klick → eindeutiges Ergebnis.
async function testOne() {
  const out = $("kwTestOut"); if (!out) return;
  out.hidden = false; out.textContent = "Teste … (kann ein paar Sekunden dauern)";
  const t = items.find((x) => !(x.keywords && x.keywords.length)) || items[0];
  if (!t) { out.textContent = "Keine Flyer geladen."; return; }
  try {
    const r = await post("/admin/tag-one", { file: t.file, force: true });
    let saved = [];
    try {
      const chk = await (await fetch("/api/templates", { cache: "no-store" })).json();
      saved = ((chk.templates || []).find((x) => x.file === t.file) || {}).keywords || [];
    } catch {}
    const it = items.find((x) => x.file === t.file); if (it) it.keywords = saved;
    updateHeader(); render();
    out.textContent =
      "Flyer: " + t.name + "\n" +
      "Modell-Antwort: " + JSON.stringify(r.keywords || []) + "\n" +
      "In der Bibliothek gespeichert: " + JSON.stringify(saved) + "\n" +
      (saved.length
        ? "→ ✓ Funktioniert! Jetzt „Alle verschlagworten“ starten."
        : (r.keywords && r.keywords.length
            ? "→ ⚠ Modell liefert Schlagworte, aber sie werden NICHT gespeichert (Schreibrechte/Pfad)."
            : "→ ⚠ Modell liefert KEINE Schlagworte."));
  } catch (e) {
    out.textContent = "Flyer: " + t.name + "\n✗ FEHLER: " + e.message;
  }
}

export async function initKeywords() {
  const panel = $("panel-keywords"); if (!panel) return;
  try { await loadList(); } catch (e) { setStatus("Liste konnte nicht geladen werden: " + e.message); return; }
  // Kategorie-Dropdown füllen
  const sel = $("kwCat");
  if (sel) {
    const cats = [...new Set(items.map((t) => t.category))].sort();
    sel.innerHTML = '<option value="__all">Alle Kategorien</option>' + cats.map((c) => '<option></option>').join("");
    [...sel.options].forEach((o, i) => { if (i > 0) { o.value = cats[i - 1]; o.textContent = cats[i - 1]; } });
    sel.addEventListener("change", render);
  }
  if ($("kwUntagged")) $("kwUntagged").addEventListener("change", render);
  if ($("kwSearch")) $("kwSearch").addEventListener("input", render);
  if ($("kwTagAll")) $("kwTagAll").addEventListener("click", tagAll);
  if ($("kwCancel")) $("kwCancel").addEventListener("click", () => { if (running) { cancelled = true; setStatus("Abbrechen …"); } });
  if ($("kwDownload")) $("kwDownload").addEventListener("click", download);
  if ($("kwTest")) $("kwTest").addEventListener("click", testOne);
  updateHeader();
  render();
}
