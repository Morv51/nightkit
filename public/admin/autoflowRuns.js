// "Letzte Laeufe": zeigt die dauerhaft in R2 gespeicherten Auto-Flow-Ergebnisse (nur
// ADMIN_TOOLS=1, sonst bleibt der Reiter verborgen). REIN ANZEIGEND plus Loeschen pro Lauf.
// Aendert nichts am Auto-Flow-Ablauf. Bilder liegen unter templates/_autoflow/<runId>/<nr>.png.

import { getToken } from "./studioApi.js";
import { notify } from "./studioUi.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

// index "1-haupt" / "1-v3" -> lesbares Label
function labelFor(index) {
  const m = String(index).match(/^(\d+)-(haupt|v(\d+))$/);
  if (!m) return index;
  const kind = m[2] === "haupt" ? "Hauptflyer" : "Variante " + m[3];
  return kind + " · Flyer " + m[1];
}

function render(runs) {
  const root = $("afRunsRoot");
  if (!root) return;
  if (!runs || !runs.length) {
    root.innerHTML = '<div class="afr-empty">Noch keine gespeicherten Läufe. Sobald du in Auto-Flow 1, 2 oder 3 generierst, erscheinen die fertigen Bilder hier, auch nach Neuladen oder von einem anderen Gerät aus.</div>';
    return;
  }
  root.innerHTML = runs.map((r) => {
    const imgs = (r.images || []).map((im) =>
      '<a class="afr-thumb" href="' + esc(im.full) + '" target="_blank" rel="noopener" title="' + esc(labelFor(im.index)) + ' — Vollbild öffnen">' +
        '<img loading="lazy" src="' + esc(im.thumb) + '" alt=""><span>' + esc(labelFor(im.index)) + "</span>" +
      "</a>").join("");
    return '<div class="afr-run">' +
      '<div class="afr-head">' +
        '<div class="afr-meta"><b>Auto-Flow ' + esc(r.flow || "?") + "</b> · " + esc(fmtTime(r.createdAt)) +
          (r.mode ? " · " + esc(r.mode) : "") + (r.sourceName ? " · Quelle: " + esc(r.sourceName) : "") +
          " · " + (r.images ? r.images.length : 0) + " Bilder</div>" +
        '<button class="rbtn rbtn-danger afr-del" type="button" data-run="' + esc(r.runId) + '">Lauf löschen</button>' +
      "</div>" +
      '<div class="afr-grid">' + imgs + "</div>" +
    "</div>";
  }).join("");
}

async function load() {
  const root = $("afRunsRoot");
  if (root) root.innerHTML = '<div class="afr-empty">Lade …</div>';
  let r;
  try { r = await api("/admin/autoflow/runs", {}); }
  catch (e) { if (root) root.innerHTML = '<div class="afr-empty">Konnte nicht laden: ' + esc(e.message || "Netzwerkfehler") + "</div>"; return true; }
  if (r.http === 404) return false; // ADMIN_TOOLS aus -> Reiter verborgen lassen
  if (r.http === 401) { if (root) root.innerHTML = '<div class="afr-empty">Sitzung abgelaufen. Bitte Seite neu laden und Code 99 erneut eingeben.</div>'; return true; }
  if (r.http !== 200 || !r.data || r.data.ok === false) {
    if (root) root.innerHTML = '<div class="afr-empty">Speicher nicht verfügbar: ' + esc((r.data && r.data.error) || ("HTTP " + r.http)) + "</div>";
    return true;
  }
  render(r.data.runs || []);
  return true;
}

async function del(runId) {
  if (!runId) return;
  if (!confirm("Diesen Auto-Flow-Lauf endgültig löschen?\nDie gespeicherten Bilder dieses Laufs werden aus R2 entfernt.")) return;
  const r = await api("/admin/autoflow/delete", { runId });
  if (r.http === 200 && r.data && r.data.ok) { notify("Lauf gelöscht", "success"); load(); }
  else notify("Löschen fehlgeschlagen: " + ((r.data && r.data.error) || ("HTTP " + r.http)), "error");
}

export function initAutoflowRuns() {
  const root = $("afRunsRoot");
  if (!root) return;
  // Klicks (Löschen) delegiert.
  root.addEventListener("click", (e) => {
    const d = e.target.closest(".afr-del");
    if (d) { e.preventDefault(); del(d.dataset.run); }
  });
  const reload = $("afRunsReload");
  if (reload) reload.addEventListener("click", load);
  // Beim Öffnen des Reiters neu laden.
  const tabBtn = document.querySelector('.studio-tab[data-tab="afruns"]');
  if (tabBtn) tabBtn.addEventListener("click", load);
  // Initial laden; nur bei Erreichbarkeit (ADMIN_TOOLS=1) den Reiter zeigen.
  load().then((reachable) => { if (reachable && tabBtn) tabBtn.hidden = false; });
}
