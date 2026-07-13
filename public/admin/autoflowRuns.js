// "Letzte Laeufe": zeigt die serverseitig laufenden UND fertigen Auto-Flow-Laeufe (nur
// ADMIN_TOOLS=1). Fragt NUR den Serverstatus ab (treibt den Lauf NICHT an) und zeigt
// Fortschritt + Bilder. Abbrechen, Fortsetzen und Loeschen pro Lauf, von jedem Geraet.

import { getToken } from "./studioApi.js";
import { notify } from "./studioUi.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let pollTimer = null;

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": getToken() },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = (await res.json()) || {}; } catch (_) {}
  return { http: res.status, data };
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  } catch (_) { return iso; }
}

function labelFor(index) {
  const m = String(index).match(/^(\d+)-(haupt|v(\d+))$/);
  if (!m) return index;
  const kind = m[2] === "haupt" ? "Hauptflyer" : "Variante " + m[3];
  return kind + " · Flyer " + m[1];
}

const STATUS_LABEL = { running: "läuft", done: "fertig", cancelled: "abgebrochen", error: "Fehler", gespeichert: "gespeichert", interrupted: "unterbrochen" };

function render(runs) {
  const root = $("afRunsRoot");
  if (!root) return;
  if (!runs || !runs.length) {
    root.innerHTML = '<div class="afr-empty">Noch keine Läufe. Starte in Auto-Flow 1, 2 oder 3, dann läuft der Auftrag auf dem Server weiter, auch wenn du den Tab schließt, und erscheint hier mit Fortschritt und Bildern.</div>';
    return;
  }
  root.innerHTML = runs.map((r) => {
    const total = r.total || 0, done = r.done || 0, failed = r.failed || 0;
    const running = r.status === "running";
    const incomplete = total > 0 && done < total;
    const pct = total ? Math.round((done / total) * 100) : ((r.images && r.images.length) ? 100 : 0);
    const stLabel = STATUS_LABEL[r.status] || r.status || "";
    const imgs = (r.images || []).map((im) =>
      '<a class="afr-thumb" href="' + esc(im.full) + '" target="_blank" rel="noopener" title="' + esc(labelFor(im.index)) + ' — Vollbild öffnen">' +
        '<img loading="lazy" src="' + esc(im.thumb) + '" alt=""><span>' + esc(labelFor(im.index)) + "</span></a>").join("");
    const progress = total
      ? '<div class="afr-prog"><span style="width:' + pct + '%"></span></div>' +
        '<div class="afr-progtext">' + done + " von " + total + " fertig" + (failed ? ", " + failed + " fehlgeschlagen" : "") + (running ? " · läuft …" : "") + "</div>"
      : "";
    let btns = "";
    if (running) btns += '<button class="rbtn rbtn-ghost afr-cancel" type="button" data-run="' + esc(r.runId) + '">Abbrechen</button>';
    if (incomplete) btns += '<button class="rbtn rbtn-ghost afr-resume" type="button" data-run="' + esc(r.runId) + '">Fortsetzen</button>';
    btns += '<button class="rbtn rbtn-danger afr-del" type="button" data-run="' + esc(r.runId) + '">Löschen</button>';
    return '<div class="afr-run">' +
      '<div class="afr-head">' +
        '<div class="afr-meta"><b>Auto-Flow ' + esc(r.flow || "?") + "</b> · " + esc(fmtTime(r.createdAt)) +
          (r.mode ? " · " + esc(r.mode) : "") + (r.sourceName ? " · " + esc(r.sourceName) : "") +
          ' <span class="afr-badge afr-st-' + esc(r.status || "") + '">' + esc(stLabel) + "</span></div>" +
        '<div class="afr-btns">' + btns + "</div>" +
      "</div>" + progress +
      '<div class="afr-grid">' + imgs + "</div>" +
    "</div>";
  }).join("");
}

async function load() {
  const root = $("afRunsRoot");
  if (root && !root.querySelector(".afr-run")) root.innerHTML = '<div class="afr-empty">Lade …</div>';
  let r;
  try { r = await api("/admin/autoflow/runs", {}); }
  catch (e) { if (root) root.innerHTML = '<div class="afr-empty">Konnte nicht laden: ' + esc(e.message || "Netzwerkfehler") + "</div>"; return true; }
  if (r.http === 404) return false; // ADMIN_TOOLS aus -> Reiter verborgen lassen
  if (r.http === 401) { if (root) root.innerHTML = '<div class="afr-empty">Sitzung abgelaufen. Bitte Seite neu laden und Code 99 erneut eingeben.</div>'; return true; }
  if (r.http !== 200 || !r.data || r.data.ok === false) {
    if (root) root.innerHTML = '<div class="afr-empty">Speicher nicht verfügbar: ' + esc((r.data && r.data.error) || ("HTTP " + r.http)) + "</div>";
    return true;
  }
  const runs = r.data.runs || [];
  render(runs);
  // Solange etwas laeuft und der Reiter sichtbar ist, automatisch nachladen.
  clearTimeout(pollTimer);
  const panel = $("panel-afruns");
  const visible = panel && panel.offsetParent !== null;
  if (runs.some((x) => x.status === "running") && visible) pollTimer = setTimeout(load, 4000);
  return true;
}

async function cancel(runId) {
  if (!runId) return;
  if (!confirm("Diesen laufenden Auto-Flow abbrechen?\nDie bereits fertigen Bilder bleiben erhalten.")) return;
  const r = await api("/admin/autoflow/cancel", { runId });
  if (r.http === 200) { notify("Abbruch angefordert", "info"); load(); }
  else notify("Abbrechen fehlgeschlagen: " + ((r.data && r.data.error) || ("HTTP " + r.http)), "error");
}

async function resume(runId) {
  if (!runId) return;
  const r = await api("/admin/autoflow/resume", { runId });
  if (r.http === 200) { notify("Lauf wird fortgesetzt", "success"); load(); }
  else notify("Fortsetzen fehlgeschlagen: " + ((r.data && r.data.error) || ("HTTP " + r.http)), "error");
}

async function delRun(runId) {
  if (!runId) return;
  if (!confirm("Diesen Lauf endgültig löschen?\nAlle gespeicherten Bilder dieses Laufs werden aus R2 entfernt.")) return;
  const r = await api("/admin/autoflow/delete", { runId });
  if (r.http === 200 && r.data && r.data.ok) { notify("Lauf gelöscht", "success"); load(); }
  else notify("Löschen fehlgeschlagen: " + ((r.data && r.data.error) || ("HTTP " + r.http)), "error");
}

export function initAutoflowRuns() {
  const root = $("afRunsRoot");
  if (!root) return;
  root.addEventListener("click", (e) => {
    const del = e.target.closest(".afr-del"); if (del) { e.preventDefault(); return delRun(del.dataset.run); }
    const c = e.target.closest(".afr-cancel"); if (c) { e.preventDefault(); return cancel(c.dataset.run); }
    const rs = e.target.closest(".afr-resume"); if (rs) { e.preventDefault(); return resume(rs.dataset.run); }
  });
  const reload = $("afRunsReload");
  if (reload) reload.addEventListener("click", load);
  const tabBtn = document.querySelector('.studio-tab[data-tab="afruns"]');
  if (tabBtn) tabBtn.addEventListener("click", load);
  load().then((reachable) => { if (reachable && tabBtn) tabBtn.hidden = false; });
}
