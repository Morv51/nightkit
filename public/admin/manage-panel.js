// Bestandsverwaltung als Studio-Panel. Nutzt das GETEILTE Admin-Token aus
// studioApi.js (sessionStorage), also KEINE zweite Code-Abfrage. Ruft die schon
// vorhandenen /admin/manage/* Endpunkte auf. Ausschliesslich Overlay-Aktionen
// (Ausblenden, Verschieben, Umbenennen), niemals Bytes. Rendert in #panel-manage.
//
// Ist ADMIN_TOOLS aus, liefert /admin/manage/list 404 -> der Tab bleibt verborgen
// und die Studio-Seite sieht aus wie bisher.

import { getToken, clearToken, post } from "./studioApi.js";

const state = { data: { templates: [], categories: [], counts: {} }, sub: "manage", filter: null };
let moveFile = null, renameFrom = null;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const panel = () => document.getElementById("panel-manage");
const q = (sel) => panel().querySelector(sel);

async function fetchList() {
  const res = await fetch("/admin/manage/list", { headers: { "X-Admin-Token": getToken() } });
  if (res.status === 401) { clearToken(); location.reload(); throw Object.assign(new Error("401"), { status: 401 }); }
  if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { status: res.status });
  return res.json();
}

function toast(msg, kind) {
  const t = q("#mngToast"); if (!t) return;
  t.textContent = msg; t.className = "mng-toast show" + (kind ? " " + kind : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = "mng-toast"; }, 2600);
}

// Sichtbare Templates nach effektiver Kategorie (Overlays beruecksichtigt) gruppieren.
function visibleByCat() {
  const by = {};
  for (const t of state.data.templates) if (!t.hidden) (by[t.category] = by[t.category] || []).push(t);
  return by;
}
function catList() { return Object.keys(visibleByCat()).sort((a, b) => a.localeCompare(b, "de")); }

export async function initManage() {
  const tabBtn = document.querySelector('.studio-tab[data-tab="manage"]');
  const p = panel(); if (!p) return;
  let data;
  try { data = await fetchList(); }
  catch (e) {
    if (e.status === 404) return;           // Tool aus -> Tab verborgen lassen (App wie heute)
    if (tabBtn) tabBtn.hidden = false;
    p.innerHTML = '<p class="mng-empty">Bestandsverwaltung konnte nicht geladen werden: ' + esc(e.message) + "</p>";
    return;
  }
  if (tabBtn) tabBtn.hidden = false;         // Tool an -> Tab zeigen
  state.data = data;
  renderShell(p);
  renderAll();
  // Bei ADMIN_TOOLS=1 ist die Bestandsverwaltung der Standard-Tab. studio.js zieht das
  // nach (respektiert #manage-Anker und eine bereits getroffene Nutzerwahl).
  document.dispatchEvent(new CustomEvent("nk-admin-ready"));
}

async function reload() {
  try { state.data = await fetchList(); renderAll(); }
  catch (e) { if (e.status !== 401) toast(e.message, "err"); }
}

function renderShell(p) {
  p.innerHTML = [
    '<div class="mng-sub">',
    '  <button class="mng-subbtn active" data-sub="manage" type="button">Verwaltung</button>',
    '  <button class="mng-subbtn" data-sub="trash" type="button">Papierkorb <span id="mngTrashN"></span></button>',
    '  <button class="rbtn rbtn-ghost spacer" id="mngReload" type="button">Aktualisieren</button>',
    '</div>',
    '<div id="mngManageView">',
    '  <div class="mng-catnav" id="mngCatnav"></div>',
    '  <div id="mngGrid"></div>',
    '</div>',
    '<div id="mngTrashView" hidden>',
    '  <p class="mng-hint">Gelöschte Templates sind hier geparkt und aus Galerie und edit-Flow ausgeblendet. Die Bilddateien bleiben unangetastet und lassen sich jederzeit wiederherstellen.</p>',
    '  <div class="mng-grid" id="mngTrashGrid"></div>',
    '  <div class="mng-purge"><b>Endgültig löschen</b> kommt bewusst als getrennter, späterer Schritt. Hier wird nichts unwiderruflich entfernt.',
    '    <button class="rbtn rbtn-danger" type="button" disabled title="Noch nicht aktiv" style="margin-left:8px">Endgültig löschen (später)</button></div>',
    '</div>',
    // Lightbox
    '<div class="mng-lb" id="mngLb"><button class="x" id="mngLbX" type="button">×</button><img id="mngLbImg" alt=""><div class="cap" id="mngLbCap"></div></div>',
    // Verschieben-Modal
    '<div class="mng-modal" id="mngMove"><div class="card">',
    '  <h4>In andere Kategorie verschieben</h4><p class="sub" id="mngMoveSub"></p>',
    '  <label>Bestehende Kategorie</label><select id="mngMoveSelect"></select>',
    '  <p class="or">oder</p><label>Neue Kategorie anlegen</label><input id="mngMoveNew" type="text" maxlength="60" placeholder="z. B. Sommer Open Air">',
    '  <div class="row"><button class="rbtn rbtn-ghost" id="mngMoveCancel" type="button">Abbrechen</button><button class="rbtn rbtn-primary" id="mngMoveSave" type="button">Verschieben</button></div>',
    '</div></div>',
    // Umbenennen-Modal
    '<div class="mng-modal" id="mngRenameM"><div class="card">',
    '  <h4>Kategorie umbenennen</h4><p class="sub" id="mngRenameSub"></p>',
    '  <label>Neuer Name</label><input id="mngRenameInput" type="text" maxlength="60">',
    '  <p class="note">Das Umbenennen betrifft nur die aktuell vorhandenen Templates dieser Kategorie. Kommt später über den Uploader ein neues Template im alten Ordnernamen hinzu, erscheint es zunächst unter dem alten Namen, bis du es ebenfalls zuweist. Du kannst jederzeit zurückbenennen. Keywords und der edit-Flow bleiben unverändert.</p>',
    '  <div class="prog" id="mngRenameProg"></div>',
    '  <div class="row"><button class="rbtn rbtn-ghost" id="mngRenameCancel" type="button">Abbrechen</button><button class="rbtn rbtn-primary" id="mngRenameSave" type="button">Umbenennen</button></div>',
    '</div></div>',
    '<div class="mng-toast" id="mngToast"></div>',
  ].join("");
  wireEvents(p);
}

function tileHTML(t, kind, index) {
  const cat = kind === "trash"
    ? '<div class="ct">Kategorie: ' + esc(t.folderCategory) + "</div>"
    : '<div class="ct">' + (t.overridden ? '<span class="ov">→</span> ' + esc(t.category) : esc(t.category)) + "</div>";
  const acts = kind === "trash"
    ? '<button class="rbtn rbtn-ghost" data-act="restore" data-file="' + esc(t.file) + '">Wiederherstellen</button>'
    : '<button class="rbtn rbtn-ghost" data-act="move" data-file="' + esc(t.file) + '">Verschieben</button>' +
      '<button class="rbtn rbtn-danger" data-act="hide" data-file="' + esc(t.file) + '">Löschen</button>';
  // Order-Leiste nur im Sortier-Modus (Einzelkategorie): Ziehgriff, Positionsfeld, Pfeile.
  const orderBar = kind === "order"
    ? '<div class="mng-orderbar">' +
        '<span class="mng-drag" draggable="true" title="Ziehen zum Umsortieren">⠿</span>' +
        '<input class="mng-pos" type="number" min="1" value="' + index + '" title="Position eingeben, dann Enter">' +
        '<button class="mng-obtn" data-ob="front" type="button" title="An den Anfang">⤒</button>' +
        '<button class="mng-obtn" data-ob="end" type="button" title="Ans Ende">⤓</button>' +
      "</div>"
    : "";
  // Grosse Ansicht via R2-faehige Route (/api/thumb w=720 -> Quelle aus R2 mit Repo-Rueckfall).
  const big = "/api/thumb?w=720&file=" + encodeURIComponent(t.file);
  return '<div class="mng-tile" data-file="' + esc(t.file) + '">' +
    orderBar +
    '<div class="tw" data-big="' + esc(big) + '" data-name="' + esc(t.name) + '"><img loading="lazy" draggable="false" src="' + esc(t.thumb) + '" alt=""></div>' +
    '<div class="m"><div class="nm" title="Klicken zum Umbenennen" data-editname data-file="' + esc(t.file) + '" data-cur="' + esc(t.name) + '">' + esc(t.name) + '</div>' + cat + "</div>" +
    '<div class="acts">' + acts + "</div></div>";
}

function renderCatnav() {
  const by = visibleByCat();
  const cats = catList();
  const total = state.data.templates.filter((t) => !t.hidden).length;
  let html = '<button class="mng-cat' + (state.filter === null ? " active" : "") + '" data-cat="__all__" type="button">Alle <span class="n">' + total + "</span></button>";
  for (const c of cats) {
    html += '<span class="mng-cat' + (state.filter === c ? " active" : "") + '" data-cat="' + esc(c) + '" role="button" tabindex="0">' +
      esc(c) + ' <span class="n">' + by[c].length + '</span>' +
      '<button class="pen" data-rename="' + esc(c) + '" type="button" title="Kategorie umbenennen">✎</button></span>';
  }
  q("#mngCatnav").innerHTML = html;
}

function renderGrid() {
  const grid = q("#mngGrid");
  const by = visibleByCat();
  // "Alle": gruppiert wie bisher, keine Sortierung (Umsortieren geht pro Kategorie).
  if (state.filter === null) {
    const cats = catList();
    if (!cats.length) { grid.innerHTML = '<div class="mng-empty">Keine sichtbaren Templates.</div>'; return; }
    grid.innerHTML = cats.map((c) =>
      '<div class="mng-catblock"><h3>' + esc(c) + " · " + by[c].length + "</h3>" +
      '<div class="mng-grid">' + by[c].map((t) => tileHTML(t, "manage")).join("") + "</div></div>"
    ).join("");
    return;
  }
  // Einzelkategorie: Sortier-Ansicht mit Drag and Drop, Positionsfeldern und Zurücksetzen.
  const cat = state.filter;
  const items = by[cat] || [];
  if (!items.length) { grid.innerHTML = '<div class="mng-empty">Keine sichtbaren Templates.</div>'; return; }
  grid.innerHTML =
    '<div class="mng-orderhead"><span class="mng-orderhint">Ziehen zum Umsortieren, oder Positionsfeld und Pfeile nutzen. Position 1 ist oben links, dann zeilenweise. Die Reihenfolge gilt genauso in der User-App.</span>' +
    '<button class="rbtn rbtn-ghost" id="mngOrderReset" type="button">Reihenfolge zurücksetzen</button></div>' +
    '<div class="mng-grid mng-sortable" id="mngSortable" data-cat="' + esc(cat) + '">' +
    items.map((t, i) => tileHTML(t, "order", i + 1)).join("") + "</div>";
  wireSortable();
}

function renderTrash() {
  const hidden = state.data.templates.filter((t) => t.hidden);
  q("#mngTrashN").textContent = "(" + hidden.length + ")";
  q("#mngTrashGrid").innerHTML = hidden.length
    ? hidden.map((t) => tileHTML(t, "trash")).join("")
    : '<div class="mng-empty">Der Papierkorb ist leer.</div>';
}

function renderAll() {
  renderCatnav();
  renderGrid();
  renderTrash();
  q("#mngManageView").hidden = state.sub !== "manage";
  q("#mngTrashView").hidden = state.sub !== "trash";
  for (const b of panel().querySelectorAll(".mng-subbtn")) b.classList.toggle("active", b.dataset.sub === state.sub);
}

// ── Aktionen ──
async function doHide(file) {
  const t = state.data.templates.find((x) => x.file === file);
  if (!confirm('Template "' + (t ? t.name : file) + '" in den Papierkorb verschieben?\n(Die Datei bleibt erhalten, jederzeit wiederherstellbar.)')) return;
  try { await post("/admin/manage/hide", { file }); toast("In den Papierkorb verschoben", "good"); await reload(); }
  catch (e) { if (e.message !== "401") toast(e.message, "err"); }
}
async function doRestore(file) {
  try { await post("/admin/manage/restore", { file }); toast("Wiederhergestellt", "good"); await reload(); }
  catch (e) { if (e.message !== "401") toast(e.message, "err"); }
}

function openMove(file) {
  const t = state.data.templates.find((x) => x.file === file); if (!t) return;
  moveFile = file;
  q("#mngMoveSub").textContent = t.name + "  (aktuell: " + t.category + ")";
  const cats = catList();
  q("#mngMoveSelect").innerHTML = cats.map((c) => '<option value="' + esc(c) + '"' + (c === t.category ? " selected" : "") + ">" + esc(c) + "</option>").join("");
  q("#mngMoveNew").value = "";
  q("#mngMove").classList.add("show");
  setTimeout(() => q("#mngMoveNew").focus(), 30);
}
async function saveMove() {
  if (!moveFile) return;
  const category = q("#mngMoveNew").value.trim() || q("#mngMoveSelect").value;
  if (!category) { toast("Bitte Kategorie wählen oder eingeben", "err"); return; }
  try { await post("/admin/manage/move", { file: moveFile, category }); q("#mngMove").classList.remove("show"); toast("Verschoben nach " + category, "good"); await reload(); }
  catch (e) { if (e.message !== "401") toast(e.message, "err"); }
}

function openRename(cat) {
  renameFrom = cat;
  q("#mngRenameSub").textContent = '"' + cat + '" umbenennen';
  q("#mngRenameInput").value = cat;
  q("#mngRenameProg").textContent = "";
  q("#mngRenameM").classList.add("show");
  setTimeout(() => { const i = q("#mngRenameInput"); i.focus(); i.select(); }, 30);
}
async function saveRename() {
  if (!renameFrom) return;
  const to = q("#mngRenameInput").value.trim();
  if (!to || to === renameFrom) { q("#mngRenameM").classList.remove("show"); return; }
  // Alle Templates (sichtbar UND im Papierkorb) mit effektiver Kategorie = renameFrom.
  const affected = state.data.templates.filter((t) => t.category === renameFrom);
  const save = q("#mngRenameSave"), cancel = q("#mngRenameCancel"), prog = q("#mngRenameProg");
  save.disabled = cancel.disabled = true;
  let done = 0;
  try {
    for (const t of affected) {
      await post("/admin/manage/move", { file: t.file, category: to });
      done++; prog.textContent = done + " / " + affected.length + " zugewiesen";
    }
    q("#mngRenameM").classList.remove("show");
    toast('"' + renameFrom + '" → "' + to + '" (' + done + " Templates)", "good");
    await reload();
  } catch (e) {
    prog.textContent = "Abgebrochen nach " + done + " von " + affected.length + " (" + (e.message || "Fehler") + ")";
    if (e.message !== "401") toast("Umbenennen unvollständig: " + e.message, "err");
    await reload();
  } finally { save.disabled = cancel.disabled = false; }
}

function openLightbox(big, name) {
  q("#mngLbImg").src = big; q("#mngLbCap").textContent = name || "";
  q("#mngLb").classList.add("show");
}
function closeLightbox() { q("#mngLb").classList.remove("show"); q("#mngLbImg").src = ""; }

// ── Sortieren innerhalb einer Kategorie (Drag and Drop + Positionsfelder) ──
let dragEl = null;
let saveTimer = null;

function wireSortable() {
  const grid = q("#mngSortable");
  if (!grid) return;
  const resetBtn = q("#mngOrderReset");
  if (resetBtn) resetBtn.addEventListener("click", () => resetOrder(grid.dataset.cat));
  grid.addEventListener("dragstart", (e) => {
    const h = e.target.closest(".mng-drag");
    if (!h) { e.preventDefault(); return; }        // nur am Ziehgriff starten
    dragEl = h.closest(".mng-tile");
    dragEl.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", dragEl.dataset.file); } catch (_) {}
    try { e.dataTransfer.setDragImage(dragEl, 24, 24); } catch (_) {}
  });
  grid.addEventListener("dragover", (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const after = getDragAfter(grid, e.clientX, e.clientY);
    if (after == null) grid.appendChild(dragEl);
    else if (after !== dragEl) grid.insertBefore(dragEl, after);
  });
  grid.addEventListener("dragend", () => {
    if (!dragEl) return;
    dragEl.classList.remove("dragging");
    dragEl = null;
    renumber(grid);
    scheduleSave(grid);
  });
}

// Nachbar-Kachel, VOR die eingefügt wird (nächste in Leserichtung nach dem Cursor).
function getDragAfter(grid, x, y) {
  const tiles = [...grid.querySelectorAll(".mng-tile:not(.dragging)")];
  let best = null, bestDist = Infinity;
  for (const tile of tiles) {
    const b = tile.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const after = (cy > y + 1) || (Math.abs(cy - y) <= b.height / 2 && cx > x);
    if (!after) continue;
    const d = Math.hypot(cx - x, cy - y);
    if (d < bestDist) { bestDist = d; best = tile; }
  }
  return best;
}

// Positionsfelder 1..n neu setzen (ausser das gerade fokussierte, damit Tippen nicht stört).
function renumber(grid) {
  [...grid.querySelectorAll(".mng-tile")].forEach((tile, i) => {
    const inp = tile.querySelector(".mng-pos");
    if (inp && document.activeElement !== inp) inp.value = String(i + 1);
  });
}

// Gebündeltes Speichern: nach kurzer Pause EINMAL schreiben (nicht bei jedem Mini-Schritt).
function scheduleSave(grid) {
  grid.classList.add("mng-dirty");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const cat = grid.dataset.cat;
    const paths = [...grid.querySelectorAll(".mng-tile")].map((t) => t.dataset.file);
    saveOrderNow(cat, paths, grid);
  }, 700);
}

async function saveOrderNow(cat, paths, grid) {
  try {
    await post("/admin/manage/order", { category: cat, order: paths });
    grid.classList.remove("mng-dirty", "mng-error");
    toast("Reihenfolge gespeichert", "good");
    await reload(); // frische Daten; die Anzeige-Reihenfolge bleibt identisch
  } catch (e) {
    if (e.message === "401") return;
    grid.classList.add("mng-error");
    toast("Reihenfolge NICHT gespeichert: " + e.message, "err"); // Ansicht bleibt erhalten
  }
}

async function resetOrder(cat) {
  if (!confirm('Manuelle Reihenfolge für „' + cat + '" zurücksetzen?\nDanach gilt wieder die Standardsortierung.')) return;
  try { await post("/admin/manage/order/reset", { category: cat }); toast("Reihenfolge zurückgesetzt", "good"); await reload(); }
  catch (e) { if (e.message !== "401") toast(e.message, "err"); }
}

// Eine Kachel gezielt an eine Position setzen (Positionsfeld) oder an Anfang/Ende (Pfeile).
function moveTileTo(grid, tile, target) {
  const others = [...grid.querySelectorAll(".mng-tile")].filter((t) => t !== tile);
  let n = parseInt(target, 10);
  if (isNaN(n) || n < 1) n = 1;
  if (n > others.length + 1) n = others.length + 1;
  const ref = others[n - 1] || null;
  grid.insertBefore(tile, ref);
  renumber(grid);
  scheduleSave(grid);
}

function wireEvents(p) {
  q("#mngReload").addEventListener("click", reload);
  p.addEventListener("click", (e) => {
    const sub = e.target.closest(".mng-subbtn");
    if (sub) { state.sub = sub.dataset.sub; renderAll(); return; }
    const pen = e.target.closest(".pen");
    if (pen) { e.stopPropagation(); openRename(pen.dataset.rename); return; }
    const catEl = e.target.closest(".mng-cat");
    if (catEl) { state.filter = catEl.dataset.cat === "__all__" ? null : catEl.dataset.cat; renderCatnav(); renderGrid(); return; }
    const tw = e.target.closest(".tw");
    if (tw) { openLightbox(tw.dataset.big, tw.dataset.name); return; }
    const nm = e.target.closest("[data-editname]");
    if (nm) { openNameEdit(nm.dataset.file, nm.dataset.cur); return; }
    const ob = e.target.closest("[data-ob]");
    if (ob) {
      const grid = q("#mngSortable"), tile = ob.closest(".mng-tile");
      if (grid && tile) moveTileTo(grid, tile, ob.dataset.ob === "front" ? 1 : 999999);
      return;
    }
    const act = e.target.closest("button[data-act]");
    if (act) {
      const file = act.dataset.file;
      if (act.dataset.act === "hide") doHide(file);
      else if (act.dataset.act === "restore") doRestore(file);
      else if (act.dataset.act === "move") openMove(file);
      return;
    }
  });
  // Positionsfeld: bei Änderung (Blur) die Kachel an die getippte Position setzen.
  p.addEventListener("change", (e) => {
    const inp = e.target.closest(".mng-pos");
    if (!inp) return;
    const grid = q("#mngSortable"), tile = inp.closest(".mng-tile");
    if (grid && tile) moveTileTo(grid, tile, inp.value);
  });
  p.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const inp = e.target.closest(".mng-pos"); if (inp) { e.preventDefault(); inp.blur(); } }
  });
  // Modals / Lightbox schliessen
  q("#mngMoveCancel").addEventListener("click", () => q("#mngMove").classList.remove("show"));
  q("#mngMoveSave").addEventListener("click", saveMove);
  q("#mngMove").addEventListener("click", (e) => { if (e.target === q("#mngMove")) q("#mngMove").classList.remove("show"); });
  q("#mngRenameCancel").addEventListener("click", () => q("#mngRenameM").classList.remove("show"));
  q("#mngRenameSave").addEventListener("click", saveRename);
  q("#mngRenameM").addEventListener("click", (e) => { if (e.target === q("#mngRenameM")) q("#mngRenameM").classList.remove("show"); });
  q("#mngLbX").addEventListener("click", closeLightbox);
  q("#mngLb").addEventListener("click", (e) => { if (e.target === q("#mngLb")) closeLightbox(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeLightbox(); q("#mngMove").classList.remove("show"); q("#mngRenameM").classList.remove("show"); } });
  // Nach einem Upload (anderes Panel) die Verwaltung neu laden, damit neue Templates erscheinen.
  document.addEventListener("nk-templates-changed", reload);
}

// Anzeigenamen per Klick ändern (schreibt ins Anzeigename-Overlay; Pfad/Keywords/
// edit-Flow bleiben unberührt). Leerer Name -> zurück zu templates.json/Dateiname.
async function openNameEdit(file, cur) {
  const nn = prompt("Anzeigename ändern:", cur || "");
  if (nn === null || nn === cur) return;
  try { await post("/admin/manage/name", { file, name: nn }); toast("Name gespeichert", "good"); await reload(); }
  catch (e) { if (e.message !== "401") toast(e.message, "err"); }
}
