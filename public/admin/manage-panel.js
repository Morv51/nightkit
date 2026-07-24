// Bestandsverwaltung als Studio-Panel. Nutzt das GETEILTE Admin-Token aus
// studioApi.js (sessionStorage), also KEINE zweite Code-Abfrage. Ruft die schon
// vorhandenen /admin/manage/* Endpunkte auf. Ausschliesslich Overlay-Aktionen
// (Ausblenden, Verschieben, Umbenennen), niemals Bytes. Rendert in #panel-manage.
//
// Ist ADMIN_TOOLS aus, liefert /admin/manage/list 404 -> der Tab bleibt verborgen
// und die Studio-Seite sieht aus wie bisher.

import { getToken, clearToken, post } from "./studioApi.js";

// fmtCat: Format-Filter "" (alle) | "916" | "23" | "other" (reine Anzeige-Filterung).
const state = { data: { templates: [], categories: [], counts: {} }, sub: "manage", filter: null, fmtCat: "",
  // Mehrfachauswahl fuer Redesign. Muster aus autoflowRuns.js (selected: Set). Bewusst
  // umschaltbar: im Auswahlmodus faengt der Klick die Kachel ab, sonst blieben Lightbox,
  // Umbenennen und Ziehsortierung nicht erreichbar. Im PAPIERKORB immer aus.
  selecting: false, selected: new Set() };
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
  probeBatch();           // nur einen LAUFENDEN Stapel-Lauf wieder anzeigen (Reconnect)
  ladePreise();           // Richtpreise EINMAL holen, damit der Auswahl-Zaehler live rechnen kann
  wireScrollTop();        // Nach-oben-Knopf (596 Templates ueber 40 Kategorien sind ein weiter Weg)
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
    '  <div class="mng-formatbar" id="mngFormatBar"></div>',
    // Umform-Stapel: eingeklappt, weil er nur noch einen Restbestand betrifft. Titel und
    // Sichtbarkeit setzt syncBatchBox() aus dimsSummary.near23 — die Zahl steht erst nach dem
    // Laden fest, darum nicht hier fest verdrahtet.
    '  <details class="mng-batchbox" id="mngBatchBox" hidden>',
    '    <summary id="mngBatchSummary">2:3-Altbestand umformen</summary>',
    '    <div class="mng-batch-body">',
    '      <button class="rbtn rbtn-danger" id="mngReformat916" type="button">Alle 2:3-nah auf 9:16 umformen und aktiv schalten</button>',
    '      <span class="mng-batch-note">Formt alle aktiven 2:3-nah-Templates per teurem flux-2-pro auf 9:16 um und schaltet sie aktiv. Die 2:3-Originale wandern in den Papierkorb (wiederherstellbar), sie werden nicht gelöscht. Läuft im Hintergrund und kann eine Weile dauern, bitte die Seite offen lassen. Fehlgeschlagene bleiben unverändert aktiv und lassen sich später erneut laufen lassen.</span>',
    '      <div class="mng-batch-result" id="mngReformatResult"></div>',
    '    </div>',
    '  </details>',
    // Redesign. Der Umschalter samt Erklaertext bleibt im Kasten und darf wegscrollen; die
    // Aktionsleiste wird beim Einschalten zu einem EIGENEN sticky Streifen darunter, damit
    // Auswaehlen und Starten beim Scrollen durch die Kategorien erreichbar bleiben.
    '  <div class="mng-selbox" id="mngSelBox">',
    '    <div class="mng-selhead">',
    '      <button class="rbtn" id="mngSelToggle" type="button">Redesign</button>',
    '      <span class="mng-batch-note">Templates antippen, dann per Redesign die Textsetzung neu komponieren lassen. Das Bild, die Komposition und die Farbwelt bleiben. Ergebnisse erscheinen im Reiter Läufe, dort lässt sich jeder Kandidat neben seinem Original ansehen und tauschen.</span>',
    '    </div>',
    '  </div>',
    // Platzhalter: die Leiste liegt FIXIERT und damit ausserhalb des Flusses. Ohne diesen
    // Streifen spraenge der Inhalt beim Einschalten um ihre Hoehe nach oben.
    '  <div id="mngSelBarSlot"></div>',
    // Voll-breit fixiert (kein sticky: der <body> traegt ein overflow-y, dadurch klebte sticky
    // an einem Scrollport, der selbst nie scrollt). Der innere Wrapper hat dieselbe max-width
    // wie der Content (1100, zentriert) — so sitzt die Leiste ohne JS-Breitenmessung ueber der
    // Spalte statt am Fensterrand.
    '  <div class="mng-selbar" id="mngSelBar" hidden>',
    '    <div class="mng-selbar-inner">',
    '      <b id="mngSelN">0 ausgewählt</b>',
    '      <button class="rbtn rbtn-ghost" id="mngSelAll" type="button">Alle in dieser Ansicht</button>',
    '      <button class="rbtn rbtn-ghost" id="mngSelNone" type="button">Auswahl leeren</button>',
    '      <span class="spacer"></span>',
    '      <button class="rbtn rbtn-ghost" id="mngSelPrompts" type="button">Nur Prompts</button>',
    '      <button class="rbtn rbtn-primary" id="mngSelRedesign" type="button">Redesign starten (0)</button>',
    '    </div>',
    '  </div>',
    '  <div class="mng-sel-result" id="mngSelResult"></div>',
    '  <div class="mng-catnav" id="mngCatnav"></div>',
    '  <div id="mngGrid"></div>',
    '</div>',
    '<div id="mngTrashView" hidden>',
    '  <p class="mng-hint">Gelöschte Templates sind hier geparkt und aus Galerie und edit-Flow ausgeblendet. Die Bilddateien bleiben unangetastet und lassen sich jederzeit wiederherstellen.</p>',
    '  <p class="mng-hint mng-trash-split" id="mngTrashHint" hidden></p>',
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
    // Redesign-Start-Dialog mit Familien-Sektion (Bauteil 3). Die Familie ist ein AUFTRAGS-
    // Attribut: alle markierten Vorlagen teilen sie. Leer = familienloser Modus.
    '<div class="mng-modal" id="mngRedesign"><div class="card mng-rd-card">',
    '  <h4>Redesign starten <span id="mngRdN"></span></h4>',
    '  <p class="sub">Alle markierten Vorlagen teilen sich <b>eine</b> Familie (Akzentfarbe + Grundton). Feld leer lassen = familienloser Modus.</p>',
    '  <label>Familien-Text</label>',
    '  <textarea id="mngFamText" rows="5" placeholder="Leer = ohne Familie. Oder aus der Auswahl würfeln / eine gespeicherte laden."></textarea>',
    '  <div class="row mng-rd-fam">',
    '    <button class="rbtn rbtn-ghost" id="mngFamRoll" type="button">Familie aus Auswahl würfeln</button>',
    '    <select id="mngFamLoad"><option value="">Gespeicherte Familie laden …</option></select>',
    '    <button class="rbtn rbtn-ghost" id="mngFamSave" type="button">Speichern unter …</button>',
    '  </div>',
    '  <p class="note" id="mngRdCost"></p>',
    '  <div class="prog" id="mngRdProg"></div>',
    '  <div class="row"><button class="rbtn rbtn-ghost" id="mngRdCancel" type="button">Abbrechen</button>',
    '    <button class="rbtn rbtn-ghost" id="mngRdPreview" type="button">Nur Prompts</button>',
    '    <button class="rbtn rbtn-primary" id="mngRdStart" type="button">Redesign starten</button></div>',
    '</div></div>',
    '<div class="mng-toast" id="mngToast"></div>',
  ].join("");
  wireEvents(p);
}

function isCoverTile(t, kind) {
  return kind !== "trash" && !!(state.data.categoryCovers && state.data.categoryCovers[t.category] === t.file);
}

function tileHTML(t, kind, index) {
  const cat = kind === "trash"
    ? '<div class="ct">Kategorie: ' + esc(t.folderCategory) + "</div>"
    : '<div class="ct">' + (t.overridden ? '<span class="ov">→</span> ' + esc(t.category) : esc(t.category)) + "</div>";
  const isCover = isCoverTile(t, kind);
  // Aushängeschild-Umschalter: gesetzt -> Zurücksetzen (Standard), sonst setzen.
  const coverBtn = kind === "trash" ? ""
    : isCover
    ? '<button class="rbtn mng-coverbtn is-cover" data-act="cover-reset" data-cat="' + esc(t.category) + '" title="Ist Kategoriebild — klicken für Standard">★ Kategoriebild</button>'
    : '<button class="rbtn rbtn-ghost mng-coverbtn" data-act="cover" data-file="' + esc(t.file) + '" data-cat="' + esc(t.category) + '" title="Als Kategoriebild dieser Kategorie setzen">☆ Kategoriebild</button>';
  const acts = kind === "trash"
    ? '<button class="rbtn rbtn-ghost" data-act="restore" data-file="' + esc(t.file) + '">Wiederherstellen</button>'
    : '<button class="rbtn rbtn-ghost" data-act="move" data-file="' + esc(t.file) + '">Verschieben</button>' +
      '<button class="rbtn rbtn-ghost" data-act="download" data-file="' + esc(t.file) + '" title="Original in voller Auflösung herunterladen">⬇ Original</button>' +
      '<button class="rbtn rbtn-danger" data-act="hide" data-file="' + esc(t.file) + '">Löschen</button>' +
      coverBtn;
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
  const coverBadge = isCover ? '<span class="mng-coverbadge" title="Kategoriebild">★</span>' : "";
  // Format-Kennzeichnung (reine Anzeige): grün = 9:16-nah, orange = 2:3-nah, grau = sonstige.
  const fmtCls = t.dims ? ({ "916": "c916", "23": "c23" }[t.dims.cat] || "cother") : "";
  const fmtLbl = t.dims ? ({ "916": "9:16", "23": "2:3" }[t.dims.cat] || "andere") : "";
  const dimsBadge = t.dims
    ? '<span class="mng-fmtbadge ' + fmtCls + '" title="' + t.dims.w + '×' + t.dims.h + ' · Verhältnis ' + t.dims.ratio + '">' + fmtLbl + "</span>"
    : "";
  const dimsText = t.dims ? '<div class="dim" title="Breite×Höhe · Verhältnis">' + t.dims.w + "×" + t.dims.h + " · " + t.dims.ratio + "</div>" : "";
  // Auswahlmodus: NUR in der Verwaltung, nie im Papierkorb (dort wäre die Auswahl sinnlos,
  // gelöschte Templates sollen nicht ins Redesign wandern).
  const selectable = state.selecting && kind !== "trash";
  const isSel = selectable && state.selected.has(t.file);
  const tick = selectable ? '<span class="mng-tick" aria-hidden="true"></span>' : "";
  // Das Haekchen sitzt IM Bildbereich (.tw), nicht daneben: im Auswahlmodus waehlt genau der
  // Klick aufs Bild aus, die Knopfleiste darunter bleibt normal bedienbar.
  return '<div class="mng-tile' + (isCover ? " is-cover" : "") + (selectable ? " mng-selectable" : "") +
      (isSel ? " is-sel" : "") + '" data-file="' + esc(t.file) + '">' +
    orderBar +
    '<div class="tw" data-big="' + esc(big) + '" data-name="' + esc(t.name) + '">' + tick + coverBadge + dimsBadge + '<img loading="lazy" draggable="false" src="' + esc(t.thumb) + '" alt=""></div>' +
    '<div class="m"><div class="nm" title="Klicken zum Umbenennen" data-editname data-file="' + esc(t.file) + '" data-cur="' + esc(t.name) + '">' + esc(t.name) + '</div>' + cat + dimsText + "</div>" +
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

// Format-Leiste (reine Anzeige): Kategorie-Chips (zugleich Filter UND Zaehler), Neuberechnung.
function renderFormatBar() {
  const bar = q("#mngFormatBar"); if (!bar) return;
  const s = state.data.dimsSummary || { near916: 0, near23: 0, other: 0, unknown: 0, total: 0, target916: 0.5625, low916: 0.53, high916: 0.59, target23: 0.667, low23: 0.63, high23: 0.70 };
  const chip = (key, label, n, cls) =>
    '<button class="mng-fmt-chip ' + cls + (state.fmtCat === key ? " active" : "") + '" data-fmt="' + key + '" type="button">' + label + " <b>" + n + "</b></button>";
  bar.innerHTML =
    '<div class="mng-fmt-row">' +
      '<span class="mng-fmt-lead">Formate:</span>' +
      chip("", "Alle", s.total, "call") +
      chip("916", "9:16-nah", s.near916, "c916") +
      chip("23", "2:3-nah", s.near23, "c23") +
      chip("other", "sonstige", s.other, "cother") +
      (s.unknown ? '<span class="mng-fmt-unk">' + s.unknown + " ungeprüft</span>" : "") +
      '<button class="rbtn rbtn-ghost mng-fmt-recompute" id="mngFmtRecompute" type="button">' + (s.unknown >= s.total && s.total ? "Formate berechnen" : "Formate aktualisieren") + "</button>" +
    "</div>" +
    '<div class="mng-fmt-note">9:16-nah = Verhältnis ' + s.low916 + " bis " + s.high916 + " (Ziel " + s.target916 + "), 2:3-nah = " + s.low23 + " bis " + s.high23 + " (Ziel " + s.target23 + "). Der Bereich dazwischen (" + s.high916 + " bis " + s.low23 + ") und alles andere zählt als sonstige. Reine Anzeige, es wird nichts geändert oder ausgeblendet.</div>";
}

// Format-Filter auf eine Tile-Liste: nur die gewaehlte Kategorie ("" = alle). Ungeprüfte
// (dims=null) fallen bei einem aktiven Filter raus, bis sie berechnet sind.
function fmtFiltered(list) {
  if (!state.fmtCat) return list;
  return list.filter((t) => t.dims && t.dims.cat === state.fmtCat);
}
const FMT_LABEL = { "916": "9:16-nah", "23": "2:3-nah", "other": "sonstige" };

// Sobald ueberhaupt etwas gewaehlt ist, nehmen die ungewaehlten Kacheln optisch zurueck.
// Als Klasse am Raster, damit toggleFile() sie ohne Neuaufbau umschalten kann.
function syncPicking() {
  const an = state.selecting && state.selected.size > 0;
  for (const g of panel().querySelectorAll("#mngGrid .mng-grid")) g.classList.toggle("is-picking", an);
}

function renderGrid() {
  const grid = q("#mngGrid");
  const by = visibleByCat();
  const fcat = state.fmtCat; // aktiver Format-Filter ("" = alle)
  const fLbl = FMT_LABEL[fcat] || "";
  // "Alle": gruppiert wie bisher, keine Sortierung (Umsortieren geht pro Kategorie).
  if (state.filter === null) {
    const cats = catList();
    const blocks = cats.map((c) => ({ c, items: fmtFiltered(by[c]) })).filter((bl) => bl.items.length);
    if (!blocks.length) { grid.innerHTML = '<div class="mng-empty">' + (fcat ? "Keine Templates in „" + fLbl + "“." : "Keine sichtbaren Templates.") + "</div>"; return; }
    grid.innerHTML = blocks.map(({ c, items }) =>
      '<div class="mng-catblock"><h3>' + esc(c) + " · " + items.length + (fcat ? " " + esc(fLbl) : "") + "</h3>" +
      '<div class="mng-grid">' + items.map((t) => tileHTML(t, "manage")).join("") + "</div></div>"
    ).join("");
    syncPicking();
    return;
  }
  // Einzelkategorie: mit Format-Filter ein einfaches (nicht sortierbares) Raster der gefilterten.
  const cat = state.filter;
  let items = by[cat] || [];
  if (fcat) {
    items = fmtFiltered(items);
    grid.innerHTML = items.length
      ? '<div class="mng-grid">' + items.map((t) => tileHTML(t, "manage")).join("") + "</div>"
      : '<div class="mng-empty">Keine Templates in „' + esc(fLbl) + "“ in dieser Kategorie.</div>";
    syncPicking();
    return;
  }
  if (!items.length) { grid.innerHTML = '<div class="mng-empty">Keine sichtbaren Templates.</div>'; return; }
  // Sortier-Ansicht mit Drag and Drop, Positionsfeldern und Zurücksetzen.
  grid.innerHTML =
    '<div class="mng-orderhead"><span class="mng-orderhint">Ziehen zum Umsortieren, oder Positionsfeld und Pfeile nutzen. Position 1 ist oben links, dann zeilenweise. Die Reihenfolge gilt genauso in der User-App.</span>' +
    '<button class="rbtn rbtn-ghost" id="mngOrderReset" type="button">Reihenfolge zurücksetzen</button></div>' +
    '<div class="mng-grid mng-sortable" id="mngSortable" data-cat="' + esc(cat) + '">' +
    items.map((t, i) => tileHTML(t, "order", i + 1)).join("") + "</div>";
  wireSortable();
  syncPicking();
}

// Ein Papierkorb-Eintrag gilt als ERSETZT, wenn im aktiven Bestand eine Datei mit seinem
// Basisnamen plus dem Suffix des jeweiligen Weges liegt: "-916" aus der Umformung
// (reformat916.js) oder "-redesign" aus dem Tausch (swapTemplate.js). Damit laesst sich die
// grosse Zahl im Reiter zerlegen, statt sie unerklaert stehen zu lassen.
function ersetztZerlegung(hidden) {
  const aktiv = new Set(state.data.templates.filter((t) => !t.hidden).map((t) => t.file));
  const basis = (f) => String(f).replace(/\.(jpe?g|png|webp)$/i, "");
  let um = 0, rd = 0;
  for (const t of hidden) {
    const b = basis(t.file);
    if ([...aktiv].some((a) => basis(a) === b + "-916")) um++;
    else if ([...aktiv].some((a) => basis(a) === b + "-redesign")) rd++;
  }
  return { um, rd };
}

function renderTrash() {
  const hidden = state.data.templates.filter((t) => t.hidden);
  q("#mngTrashN").textContent = "(" + hidden.length + ")";
  const { um, rd } = ersetztZerlegung(hidden);
  const hint = q("#mngTrashHint");
  if (hint) {
    const teile = [];
    if (um) teile.push(um + " durch Umformung ersetzt");
    if (rd) teile.push(rd + " durch Redesign ersetzt");
    hint.hidden = !teile.length;
    hint.textContent = teile.length
      ? "Von den " + hidden.length + " Einträgen sind " + teile.join(" und ") +
        " — ihre Nachfolger sind aktiv, die Originale liegen hier nur als Sicherung."
      : "";
  }
  q("#mngTrashGrid").innerHTML = hidden.length
    ? hidden.map((t) => tileHTML(t, "trash")).join("")
    : '<div class="mng-empty">Der Papierkorb ist leer.</div>';
}

// ── Mehrfachauswahl + Redesign ──────────────────────────────────────────────
// Die aktuell SICHTBAREN Templates (Kategorie- und Formatfilter angewandt, ohne Papierkorb).
// Grundmenge fuer "Alle in dieser Ansicht" — es soll nie mehr ausgewaehlt werden, als man sieht.
function visibleFiles() {
  const by = visibleByCat();
  const cats = state.filter === null ? catList() : [state.filter];
  const out = [];
  for (const c of cats) for (const t of fmtFiltered(by[c] || [])) out.push(t.file);
  return out;
}

// Name der aktuell sichtbaren Menge, fuer den "Alle in …"-Knopf. Kategorie- und Formatfilter
// werden von visibleFiles() bereits angewandt; hier wird die Beschriftung nur ehrlich.
function sichtName() {
  const kat = state.filter === null ? "allen Kategorien" : state.filter;
  const fmt = state.fmtCat ? " · " + (FMT_LABEL[state.fmtCat] || state.fmtCat) : "";
  return kat + fmt;
}

function syncSelBar() {
  const box = q("#mngSelBox"), bar = q("#mngSelBar"), tog = q("#mngSelToggle");
  if (!box) return;
  // Kasten und Leiste haben im Papierkorb nichts zu suchen.
  box.hidden = state.sub !== "manage";
  if (tog) { tog.classList.toggle("is-on", state.selecting); tog.textContent = state.selecting ? "Auswahl beenden" : "Redesign"; }
  if (bar) bar.hidden = !state.selecting || state.sub !== "manage";
  const n = state.selected.size;
  // Kosten live, ABER nur wenn die Richtpreise wirklich vorliegen. Ohne sie bleibt der Zaehler
  // nackt — eine geratene Zahl waere schlimmer als keine, der Dialog rechnet ohnehin frisch.
  const nEl = q("#mngSelN");
  if (nEl) {
    const kosten = (n && preisCache !== null) ? ", ca. $" + (n * preisCache).toFixed(2) : "";
    nEl.textContent = n + " ausgewählt" + kosten;
  }
  const alle = q("#mngSelAll");
  if (alle) {
    const m = visibleFiles().length;
    alle.textContent = "Alle in " + sichtName() + " (" + m + ")";
    alle.disabled = m < 1;
  }
  const go = q("#mngSelRedesign");
  if (go) { go.textContent = "Redesign starten (" + n + ")"; go.disabled = n < 1; }
  const pr = q("#mngSelPrompts"); if (pr) pr.disabled = n < 1;
  syncSelBarGeometry();
}

// Die Leiste ist voll-breit fixiert und per CSS einzeilig (nowrap). Hoehe und Breite regelt
// ausschliesslich CSS — bewusst KEINE getBoundingClientRect/offsetHeight-Messung: die haengt an
// Layout, das je nach Umgebung nicht verlaesslich vorliegt. Der Platzhalter bekommt seine feste
// Hoehe (auf die Leiste abgestimmt) ueber eine Klasse, nicht ueber gemessene Pixel.
function syncSelBarGeometry() {
  const slot = q("#mngSelBarSlot"), bar = q("#mngSelBar");
  if (slot && bar) slot.classList.toggle("on", !bar.hidden);
}

function setSelecting(on) {
  state.selecting = !!on;
  if (!state.selecting) { state.selected.clear(); clearPromptCards(); }
  renderGrid();
  syncSelBar();
}

function toggleFile(file) {
  if (state.selected.has(file)) state.selected.delete(file); else state.selected.add(file);
  const tile = q('.mng-tile[data-file="' + CSS.escape(file) + '"]');
  if (tile) tile.classList.toggle("is-sel", state.selected.has(file));
  syncPicking();
  syncSelBar();
}

// Ausgewaehlte als [{ template, name }] — der Anzeigename wandert mit in den Lauf.
function selectedFiles() {
  return [...state.selected].map((f) => {
    const t = state.data.templates.find((x) => x.file === f);
    return { template: f, name: (t && t.name) || f };
  });
}

const selResult = () => q("#mngSelResult");

// ── Prompt-Karten: Kopieren je Karte + alle. Muster aus der Clean-Flow-Vorschau. ──
let lastPrompts = [];              // die Antwort-Eintraege der letzten Vorschau
const copiedCards = new Set();     // welche Karten schon kopiert wurden

function clearPromptCards() {
  lastPrompts = []; copiedCards.clear();
  const box = selResult(); if (box) box.innerHTML = "";
}

function writeClip(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error("no clipboard"));
}

function markCopied(i) {
  copiedCards.add(i);
  const card = q('.mng-selcard[data-i="' + i + '"]');
  if (card) {
    card.classList.add("is-copied");
    const b = card.querySelector(".mng-selcard-copy");
    if (b) { b.textContent = "✓ Kopiert"; b.classList.add("is-copied"); }
  }
  const el = q("#mngSelCopyCount");
  if (el) {
    const total = lastPrompts.filter((x) => x.prompt).length;
    el.textContent = copiedCards.size + " von " + total + " kopiert";
    el.classList.toggle("is-all", copiedCards.size > 0 && copiedCards.size === total);
  }
}

function copyOnePrompt(i) {
  const it = lastPrompts[i]; if (!it || !it.prompt) return;
  writeClip(it.prompt).then(() => { markCopied(i); toast("Prompt kopiert", "good"); })
    .catch(() => toast("Kopieren nicht möglich", "err"));
}

function copyAllPrompts() {
  const mit = lastPrompts.map((it, i) => ({ it, i })).filter((x) => x.it.prompt);
  if (!mit.length) return;
  const text = mit.map(({ it }) => "=== " + it.name + " ===\n" + it.prompt).join("\n\n\n");
  writeClip(text).then(() => {
    mit.forEach(({ i }) => markCopied(i));
    toast(mit.length + " Prompts kopiert", "good");
  }).catch(() => toast("Kopieren nicht möglich", "err"));
}

function renderPromptCards(items) {
  const box = selResult(); if (!box) return;
  lastPrompts = items || []; copiedCards.clear();
  const mit = lastPrompts.filter((x) => x.prompt).length;
  const kopf = mit
    ? '<div class="mng-selres-head"><b>Prompt-Vorschau</b> <span class="mng-selres-n" id="mngSelCopyCount">0 von ' + mit + " kopiert</span>" +
      (mit > 1 ? '<button class="rbtn rbtn-ghost" id="mngSelCopyAll" type="button">Alle kopieren</button>' : "") + "</div>"
    : "";
  box.innerHTML = kopf + lastPrompts.map((it, i) => {
    if (it.error) return '<div class="mng-selcard"><div class="mng-selcard-h">' + esc(it.name) + '</div><div class="mng-empty">' + esc(it.error) + "</div></div>";
    // core-Vorschau: Karten-Kombination + Familie + Platzhalter sichtbar machen.
    const meta = it.layoutKey
      ? '<div class="mng-selcard-meta">Layout: <b>' + esc(it.layoutKey) + '</b> · Medium: <b>' + esc(it.mediumKey) + "</b> · Familie: " +
        (it.familyUsed ? '<b class="ok">gesetzt</b>' : '<b class="warn">Platzhalter</b>') +
        (it.placeholders ? '<br>Platzhalter: ' + esc(it.placeholders) : "") + "</div>"
      : "";
    return '<div class="mng-selcard" data-i="' + i + '">' +
      '<div class="mng-selcard-h">' + esc(it.name) +
        ' <span class="mng-selcard-n">' + (it.prompt || "").length + " Zeichen</span>" +
        '<button class="rbtn rbtn-ghost mng-selcard-copy" type="button" data-i="' + i + '">Kopieren</button></div>' +
      meta +
      (it.raw ? '<details class="mng-selraw"><summary>Rohe Sonnet-Antwort</summary><pre>' + esc(it.raw) + "</pre></details>" : "") +
      "<pre>" + esc(it.prompt) + "</pre></div>";
  }).join("");
}

// "Nur Prompts": der komplett gebaute Bildprompt je Kandidat, VOR bezahlten Läufen. Im core-Modus
// reine Assemblierung (kostenlos): eingesetzte Familie, Layout-/Medium-Karte, Platzhalter-Liste.
// familyText kommt aus dem Redesign-Dialog; ohne ihn zeigt der Server einen markierten Platzhalter.
async function doRedesignPreview(familyText) {
  const files = selectedFiles();
  if (!files.length) return;
  const box = selResult(); if (box) box.innerHTML = '<div class="mng-empty">Baue Prompts …</div>';
  const btn = q("#mngSelPrompts"); if (btn) btn.disabled = true;
  let r;
  try { r = await adminPost("/admin/redesign/preview", { files, familyText: familyText || "" }); }
  catch (e) { if (box) box.innerHTML = '<div class="mng-empty">Vorschau fehlgeschlagen.</div>'; if (btn) btn.disabled = false; return; }
  if (btn) btn.disabled = false;
  if (r.http === 401) { toast("Sitzung abgelaufen, bitte neu entsperren", "err"); return; }
  if (r.http !== 200 || !r.data || !r.data.items) {
    if (box) box.innerHTML = '<div class="mng-empty">Vorschau fehlgeschlagen: ' + esc((r.data && r.data.error) || ("HTTP " + r.http)) + "</div>";
    return;
  }
  renderPromptCards(r.data.items);
}

// Geschaetzte Kosten je Vorlage: ein Sonnet-Aufruf (Regie) + ein Bild. Die Richtpreise kommen
// LIVE aus dem Nutzungs-Dashboard (dort editierbar). EINMAL beim Oeffnen geholt und gecacht,
// damit der Zaehler sie live zeigen kann. Schlaegt der Abruf fehl, bleibt preisCache null und
// der Zaehler zeigt KEINE Kosten — eine geratene Zahl waere schlimmer als keine. Der
// Bestaetigungs-Dialog rechnet ohnehin mit den Standardwerten weiter.
// Redesign v2 (core): je Vorlage ein Bild + ein Gate-Aufruf (KEINE Sonnet-Regie mehr). Das
// Familie-Würfeln ist ein einmaliger Zusatz-Aufruf.
const PREIS_FALLBACK = { claude_redesigngate: 0.02, claude_familyspecs: 0.02, openai_gptimage: 0.08 };
let preisCache = null;      // Kosten je Vorlage (Bild + Gate)
let famPreisCache = null;   // Kosten Familie würfeln

async function ladePreise() {
  try {
    const res = await fetch("/admin/usage/data", { headers: { "X-Admin-Token": getToken() } });
    const d = await res.json();
    const rows = (d && d.rows) || [];
    const p = (k) => { const r = rows.find((x) => x.key === k); return (r && typeof r.price === "number") ? r.price : PREIS_FALLBACK[k]; };
    preisCache = p("openai_gptimage") + p("claude_redesigngate");
    famPreisCache = p("claude_familyspecs");
  } catch (_) { preisCache = null; famPreisCache = null; }
  syncSelBar();
}

function preisJeVorlage() {
  return preisCache !== null ? preisCache
    : PREIS_FALLBACK.openai_gptimage + PREIS_FALLBACK.claude_redesigngate;
}
function preisFamilie() {
  return famPreisCache !== null ? famPreisCache : PREIS_FALLBACK.claude_familyspecs;
}

// ── Redesign-Start-Dialog (Bauteil 3): Familien-Sektion + Kostenausweis, dann Start. Die
//    Familie ist ein Auftrags-Attribut; alle markierten Vorlagen teilen sie. ──
let familienCache = []; // gespeicherte Presets [{name, family_text, accent, tone}]

async function ladeFamilien() {
  try {
    const res = await fetch("/admin/redesign/families", { headers: { "X-Admin-Token": getToken() } });
    const d = await res.json();
    familienCache = (d && d.families) || [];
  } catch (_) { familienCache = []; }
  const sel = q("#mngFamLoad");
  if (sel) sel.innerHTML = '<option value="">Gespeicherte Familie laden …</option>' +
    familienCache.map((f, i) => '<option value="' + i + '">' + esc(f.name) + "</option>").join("");
}

async function openRedesignDialog() {
  const files = selectedFiles();
  if (!files.length) return;
  q("#mngRdN").textContent = "(" + files.length + ")";
  q("#mngRdStart").textContent = "Redesign starten (" + files.length + ")";
  const per = preisJeVorlage();
  const ges = (files.length * per).toFixed(2), rr = (2 * per).toFixed(2), fam = preisFamilie().toFixed(2);
  q("#mngRdCost").textContent =
    files.length + (files.length === 1 ? " Vorlage" : " Vorlagen") + ", je Vorlage ein Bild + ein Gate-Aufruf (~$" + per.toFixed(2) +
    "), gesamt rund $" + ges + ". Bei zu wenigen Treffern würfelt der Lauf bis zu 2 nach (bis +$" + rr +
    "). „Familie würfeln“ kostet einmalig ~$" + fam + ". Im Bestand ändert sich nichts — getauscht wird später im Reiter Läufe.";
  q("#mngRdProg").textContent = "";
  await ladeFamilien();
  q("#mngRedesign").classList.add("show");
}

async function familieWuerfeln() {
  const files = selectedFiles(); if (!files.length) return;
  const btn = q("#mngFamRoll"); if (btn) btn.disabled = true;
  q("#mngRdProg").textContent = "Würfle Familie aus den ersten Bildern der Auswahl …";
  try {
    const r = await adminPost("/admin/redesign/family-roll", { files });
    if (r.http === 200 && r.data && r.data.family_text) {
      q("#mngFamText").value = r.data.family_text;
      q("#mngRdProg").textContent = "Familie: " + (r.data.accent || "?") + " · " + (r.data.tone || "?");
    } else q("#mngRdProg").textContent = "Würfeln fehlgeschlagen: " + ((r.data && r.data.error) || ("HTTP " + r.http));
  } catch (_) { q("#mngRdProg").textContent = "Würfeln fehlgeschlagen."; }
  if (btn) btn.disabled = false;
}

async function familieSpeichern() {
  const txt = q("#mngFamText").value.trim();
  if (!txt) { toast("Kein Familien-Text zum Speichern", "err"); return; }
  const name = (window.prompt("Familie speichern unter welchem Namen?") || "").trim();
  if (!name) return;
  const r = await adminPost("/admin/redesign/family-save", { name, family_text: txt });
  if (r.http === 200) { toast("Familie „" + name + "“ gespeichert", "good"); await ladeFamilien(); }
  else toast("Speichern fehlgeschlagen: " + ((r.data && r.data.error) || ("HTTP " + r.http)), "err");
}

async function doRedesignStartConfirmed() {
  const files = selectedFiles();
  if (!files.length) return;
  const familyText = q("#mngFamText").value.trim();
  const btn = q("#mngRdStart"); if (btn) btn.disabled = true;
  q("#mngRdProg").textContent = "Starte …";
  let r;
  try {
    r = await adminPost("/admin/autoflow/start", {
      flow: "clean", cleanFlow: true, redesign: true,
      mode: files.length + (files.length === 1 ? " Redesign" : " Redesigns"),
      loose: false, textOnly: false, regelwerk: false,
      variants: 1, // fest: genau EIN Kandidat je Vorlage
      refType: "single", files, familyText,
    });
  } catch (e) { if (btn) btn.disabled = false; q("#mngRdProg").textContent = "Start fehlgeschlagen."; return; }
  if (btn) btn.disabled = false;
  if (r.http !== 200 || !r.data || !r.data.runId) { q("#mngRdProg").textContent = "Start fehlgeschlagen: " + ((r.data && r.data.error) || ("HTTP " + r.http)); return; }
  q("#mngRedesign").classList.remove("show");
  toast("Redesign gestartet. Ergebnis im Reiter Läufe.", "good");
  setSelecting(false);
  const tab = document.querySelector('.studio-tab[data-tab="afruns"]');
  if (tab) tab.click();
}

// Der Umform-Stapel betrifft nur noch einen Restbestand. Er steht darum eingeklappt und
// verschwindet ganz, sobald nichts mehr umzuformen ist. Die Zahl kommt aus dimsSummary und
// steht erst nach dem Laden fest — daher hier und nicht in renderShell.
function syncBatchBox() {
  const box = q("#mngBatchBox"); if (!box) return;
  const s = state.data.dimsSummary || {};
  const n = typeof s.near23 === "number" ? s.near23 : 0;
  box.hidden = n < 1;
  if (n < 1) box.open = false;
  const sum = q("#mngBatchSummary");
  if (sum) sum.textContent = "2:3-Altbestand umformen (" + n + ")";
}

function renderAll() {
  renderFormatBar();
  syncBatchBox();
  renderCatnav();
  renderGrid();
  renderTrash();
  syncSelBar();
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
// Sinnvoller Dateiname: Anzeigename (sonst technischer Basisname) + echte Bildendung.
function downloadName(t) {
  const ext = ((t.file || "").split(".").pop() || "jpg").toLowerCase();
  const base = (t.name && t.name.trim()) || (t.file || "template").split("/").pop().replace(/\.[^.]+$/, "");
  const safe = base.replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "template";
  return safe + "." + ext;
}
// Original in VOLLER Auflösung herunterladen über die vorhandene R2-fähige Route
// (/api/template-image, gleiche Route wie Vorschau/Lightbox). Same-origin + download-
// Attribut erzwingt das SPEICHERN (kein Öffnen im Tab) und setzt den Dateinamen. Nur
// das reine Bild, keine Metadaten, kein ZIP. Ändert die Anzeige-Nutzung der Route nicht.
function doDownload(file) {
  const t = state.data.templates.find((x) => x.file === file);
  if (!t) return;
  const a = document.createElement("a");
  a.href = "/api/template-image?file=" + encodeURIComponent(file);
  a.download = downloadName(t);
  document.body.appendChild(a); a.click(); a.remove();
}
// Aushängeschild (Kategoriebild) setzen bzw. auf Standard zurücksetzen.
async function doSetCover(file, category) {
  try { await post("/admin/manage/cover", { file, category }); toast("Als Kategoriebild gesetzt", "good"); await reload(); }
  catch (e) { if (e.message !== "401") toast(e.message, "err"); }
}
async function doResetCover(category) {
  try { await post("/admin/manage/cover/reset", { category }); toast("Kategoriebild zurückgesetzt (Standard)", "good"); await reload(); }
  catch (e) { if (e.message !== "401") toast(e.message, "err"); }
}
// Format-/Masse-Cache berechnen bzw. aktualisieren (rein additive Analyse, aendert nichts).
async function doRecomputeDims() {
  const btn = q("#mngFmtRecompute");
  const label = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Berechne Formate …"; }
  try {
    const r = await post("/admin/manage/dimensions/recompute", {});
    const msg = (r.computed || 0) + " berechnet" + (r.failed ? ", " + r.failed + " fehlgeschlagen" : "") +
      (r.persisted === false ? " (nicht dauerhaft gespeichert, R2 fehlt)" : " und gespeichert");
    toast(msg, r.persisted === false ? "warn" : "good");
    await reload();
  } catch (e) { if (e.message !== "401") toast(e.message, "err"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

// ── Stapel-Umformung aller aktiven 2:3-nah-Templates auf 9:16 (aktiv schalten, Originale in
// den Papierkorb). Eigener Aufruf mit HTTP-Status (kein stilles Neuladen). Lauf im Hintergrund,
// Fortschritt per Status-Abfrage. ──
async function adminPost(path, bodyObj) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": getToken() },
    body: JSON.stringify(bodyObj || {}),
  });
  let data = {};
  try { data = (await res.json()) || {}; } catch (_) {}
  return { http: res.status, data };
}

const reformatBox = () => q("#mngReformatResult");

function renderBatch(st) {
  const box = reformatBox(); if (!box) return;
  if (!st || st.status === "idle") { box.innerHTML = ""; return; }
  const total = st.total || 0, done = st.done || 0, swapped = st.swapped || 0, failed = st.failed || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const bar = '<div class="mng-batch-bar"><span style="width:' + pct + '%"></span></div>';
  if (st.status === "running") {
    box.innerHTML =
      '<div class="mng-batch-head">Umformung läuft: ' + done + " von " + total + " fertig (" + swapped + " getauscht, " + failed + " fehlgeschlagen).</div>" +
      bar + (st.current ? '<div class="mng-batch-cur">Aktuell: ' + esc(st.current) + "</div>" : "");
    return;
  }
  const fails = (st.results || []).filter((r) => r && !r.ok);
  let html = '<div class="mng-batch-head">Fertig: ' + swapped + " getauscht, " + failed + " fehlgeschlagen (von " + total + ")." +
    (st.estCost ? " Geschätzte Kosten rund $" + st.estCost + "." : "") + "</div>";
  if (st.sanitized > 0) html += '<div class="mng-batch-cur">Davon ' + st.sanitized + " erst nach verlustfreier Neukodierung der Eingabe angenommen.</div>";
  if (st.error) html += '<div class="err">' + esc(st.error) + "</div>";
  if (swapped > 0) html += '<div class="mng-batch-ok">Die getauschten 2:3-Originale liegen jetzt im Papierkorb (Reiter „Papierkorb") und sind wiederherstellbar.</div>';
  if (fails.length) {
    html += '<div class="mng-batch-failhead">Fehlgeschlagen (bleiben unverändert aktiv, später erneut startbar):</div><ul class="mng-batch-faillist">';
    for (const f of fails.slice(0, 200)) html += "<li>" + esc(f.name || f.file) + ": " + esc(f.reason || "unbekannt") + "</li>";
    html += "</ul>";
  }
  box.innerHTML = html;
}

async function pollBatch() {
  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    let st;
    try { st = await adminPost("/admin/reformat-916", { mode: "status" }); }
    catch (e) { continue; } // transienter Netzfehler -> weiter versuchen
    if (st.http === 401) { if (reformatBox()) reformatBox().innerHTML = '<span class="err">Sitzung abgelaufen. Bitte Seite neu laden und Code 99 erneut eingeben.</span>'; const b = q("#mngReformat916"); if (b) b.disabled = false; return; }
    if (st.http !== 200) continue;
    renderBatch(st.data);
    if (st.data.status !== "running") { const b = q("#mngReformat916"); if (b) b.disabled = false; return; }
  }
}

async function doReformatBatch() {
  const btn = q("#mngReformat916");
  let prev;
  try { prev = await adminPost("/admin/reformat-916", { mode: "preview" }); }
  catch (e) { toast("Vorschau fehlgeschlagen", "err"); return; }
  if (prev.http === 401) { toast("Sitzung abgelaufen, bitte neu entsperren", "err"); return; }
  const total = (prev.data && prev.data.total) || 0;
  const cost = (prev.data && prev.data.estCost) || 0;
  if (!total) { toast("Keine aktiven 2:3-nah-Templates gefunden"); return; }
  const go = confirm(
    "Jetzt " + total + " Templates (2:3-nah) per teurem Modell auf 9:16 umformen und aktiv schalten?\n\n" +
    "Geschätzte Kosten rund $" + cost + ".\n" +
    "Die 2:3-Originale wandern in den Papierkorb (wiederherstellbar), sie werden NICHT gelöscht.\n" +
    "Fehlgeschlagene bleiben unverändert aktiv.\n\n" +
    "Der Lauf läuft im Hintergrund. Bitte die Seite offen lassen."
  );
  if (!go) return;
  if (btn) btn.disabled = true;
  let s;
  try { s = await adminPost("/admin/reformat-916", { mode: "run" }); }
  catch (e) { if (btn) btn.disabled = false; toast("Start fehlgeschlagen", "err"); return; }
  if (s.http === 401) { if (btn) btn.disabled = false; if (reformatBox()) reformatBox().innerHTML = '<span class="err">Sitzung abgelaufen. Bitte Seite neu laden und Code 99 erneut eingeben.</span>'; return; }
  if (s.http !== 200) { if (btn) btn.disabled = false; if (reformatBox()) reformatBox().innerHTML = '<span class="err">Start fehlgeschlagen: HTTP ' + s.http + "</span>"; return; }
  toast("Umformung gestartet", "good");
  renderBatch({ status: "running", total: (s.data && s.data.total) || total, done: 0, swapped: 0, failed: 0 });
  pollBatch();
}

// Beim Öffnen der Verwaltung: läuft schon ein Stapel-Lauf oder ist einer fertig? Dann anzeigen.
async function probeBatch() {
  let st;
  try { st = await adminPost("/admin/reformat-916", { mode: "status" }); } catch (_) { return; }
  if (!st || st.http !== 200 || !st.data) return;
  // Nur einen LAUFENDEN Lauf wieder anzeigen (Reconnect). Ein bereits fertiger Lauf wird beim
  // Oeffnen NICHT erneut gezeigt, damit keine alte Fehlerliste dauerhaft stehenbleibt.
  if (st.data.status === "running") { const b = q("#mngReformat916"); if (b) b.disabled = true; renderBatch(st.data); pollBatch(); }
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
    const fchip = e.target.closest(".mng-fmt-chip[data-fmt]");
    if (fchip) { state.fmtCat = fchip.dataset.fmt; renderFormatBar(); renderGrid(); return; }
    if (e.target.closest("#mngFmtRecompute")) { doRecomputeDims(); return; }
    if (e.target.closest("#mngReformat916")) { doReformatBatch(); return; }
    // ── Auswahlmodus: Knöpfe der Leiste, dann der Kachel-Klick.
    if (e.target.closest("#mngSelToggle")) { setSelecting(!state.selecting); return; }
    if (e.target.closest("#mngSelAll")) { for (const f of visibleFiles()) state.selected.add(f); renderGrid(); syncSelBar(); return; }
    if (e.target.closest("#mngSelNone")) { state.selected.clear(); renderGrid(); syncSelBar(); return; }
    if (e.target.closest("#mngSelPrompts")) { doRedesignPreview(""); return; }
    if (e.target.closest("#mngSelRedesign")) { openRedesignDialog(); return; }
    if (e.target.closest("#mngSelCopyAll")) { copyAllPrompts(); return; }
    const cp = e.target.closest(".mng-selcard-copy");
    if (cp) { copyOnePrompt(Number(cp.dataset.i)); return; }
    // Der Fang gilt NUR fuer den Bildbereich (.tw). Frueher fing er die ganze Kachel ab, damit
    // waren ⬇ Original, Verschieben und Löschen im Auswahlmodus blockiert. Die Lightbox darunter
    // wird im Auswahlmodus uebersprungen, sonst oeffnete derselbe Klick zusaetzlich die Großansicht.
    if (state.selecting && state.sub === "manage") {
      const bild = e.target.closest(".mng-tile.mng-selectable .tw");
      if (bild) {
        e.preventDefault(); e.stopPropagation();
        const tile = bild.closest(".mng-tile");
        if (tile) toggleFile(tile.dataset.file);
        return;
      }
    }
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
      else if (act.dataset.act === "download") doDownload(file);
      else if (act.dataset.act === "cover") doSetCover(file, act.dataset.cat);
      else if (act.dataset.act === "cover-reset") doResetCover(act.dataset.cat);
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
  // Redesign-Dialog (Bauteil 3)
  q("#mngRdCancel").addEventListener("click", () => q("#mngRedesign").classList.remove("show"));
  q("#mngRedesign").addEventListener("click", (e) => { if (e.target === q("#mngRedesign")) q("#mngRedesign").classList.remove("show"); });
  q("#mngRdPreview").addEventListener("click", () => { const fam = q("#mngFamText").value; q("#mngRedesign").classList.remove("show"); doRedesignPreview(fam); });
  q("#mngRdStart").addEventListener("click", doRedesignStartConfirmed);
  q("#mngFamRoll").addEventListener("click", familieWuerfeln);
  q("#mngFamSave").addEventListener("click", familieSpeichern);
  q("#mngFamLoad").addEventListener("change", (e) => {
    const i = e.target.value; if (i === "") return;
    const f = familienCache[Number(i)]; if (f) q("#mngFamText").value = f.family_text || "";
  });
  q("#mngRenameM").addEventListener("click", (e) => { if (e.target === q("#mngRenameM")) q("#mngRenameM").classList.remove("show"); });
  q("#mngLbX").addEventListener("click", closeLightbox);
  q("#mngLb").addEventListener("click", (e) => { if (e.target === q("#mngLb")) closeLightbox(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeLightbox(); q("#mngMove").classList.remove("show"); q("#mngRenameM").classList.remove("show"); } });
  // Nach einem Upload (anderes Panel) die Verwaltung neu laden, damit neue Templates erscheinen.
  document.addEventListener("nk-templates-changed", reload);
}

// ── Nach-oben-Knopf. Bewusst KEIN zweites klebendes Element am oberen Rand: er kostet keine
// Hoehe, hilft auch ausserhalb des Auswahlmodus und erscheint erst, wenn er gebraucht wird.
// Der Knopf haengt am Dokument, nicht am Panel — er soll auch neben dem Raster erreichbar sein.
// Scroll-Ereignisse erreichen im Studio NICHT das window (gemessen: null Ereignisse) — der
// <body> traegt ein overflow-y, gescrollt wird das Wurzelelement. Darum wird in der
// CAPTURE-Phase am document gelauscht und die Position an document.scrollingElement gelesen.
const scrollTop = () => (document.scrollingElement || document.documentElement).scrollTop || 0;

function wireScrollTop() {
  if (document.getElementById("mngTopBtn")) return;
  const b = document.createElement("button");
  b.id = "mngTopBtn"; b.type = "button"; b.className = "mng-topbtn"; b.hidden = true;
  b.title = "Nach oben"; b.textContent = "↑";
  b.addEventListener("click", () => {
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollTo) se.scrollTo({ top: 0, behavior: "smooth" }); else se.scrollTop = 0;
  });
  document.body.appendChild(b);
  const sync = () => {
    const p = panel();
    const sichtbar = !!p && !p.hidden && p.offsetParent !== null;
    b.hidden = !sichtbar || scrollTop() < 600;
    syncSelBarGeometry();
  };
  document.addEventListener("scroll", sync, { capture: true, passive: true });
  window.addEventListener("resize", sync, { passive: true });
  sync();
}

// Anzeigenamen per Klick ändern (schreibt ins Anzeigename-Overlay; Pfad/Keywords/
// edit-Flow bleiben unberührt). Leerer Name -> zurück zu templates.json/Dateiname.
async function openNameEdit(file, cur) {
  const nn = prompt("Anzeigename ändern:", cur || "");
  if (nn === null || nn === cur) return;
  try { await post("/admin/manage/name", { file, name: nn }); toast("Name gespeichert", "good"); await reload(); }
  catch (e) { if (e.message !== "401") toast(e.message, "err"); }
}
