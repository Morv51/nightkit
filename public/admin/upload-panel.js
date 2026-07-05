// Uploader als Studio-Panel. Legt NUR neue Templates an (bestehende unberuehrt).
// Nutzt das geteilte Admin-Token aus studioApi.js (keine zweite Code-Abfrage) und
// den Endpunkt POST /admin/upload. Verarbeitet Mehrfach-Uploads NACHEINANDER, mit
// klarem Status je Datei; ein Fehlschlag bricht den Gesamt-Upload nicht ab.
//
// Ist ADMIN_TOOLS aus, liefert /admin/manage/list 404 -> Tab bleibt verborgen.

import { getToken, clearToken, post } from "./studioApi.js";

const WARN_AT = 20; // ab so vielen Dateien nachfragen
let categories = [];
let files = []; // ausgewaehlte Dateien
let running = false;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const panel = () => document.getElementById("panel-upload");
const q = (sel) => panel().querySelector(sel);

async function fetchCategories() {
  const res = await fetch("/admin/manage/list", { headers: { "X-Admin-Token": getToken() } });
  if (res.status === 401) { clearToken(); location.reload(); throw Object.assign(new Error("401"), { status: 401 }); }
  if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { status: res.status });
  const data = await res.json();
  return data.categories || [];
}

export async function initUpload() {
  const tabBtn = document.querySelector('.studio-tab[data-tab="upload"]');
  const p = panel(); if (!p) return;
  try { categories = await fetchCategories(); }
  catch (e) {
    if (e.status === 404) return; // Tool aus -> Tab verborgen lassen
    if (tabBtn) tabBtn.hidden = false;
    p.innerHTML = '<p class="mng-empty">Upload konnte nicht geladen werden: ' + esc(e.message) + "</p>";
    return;
  }
  if (tabBtn) tabBtn.hidden = false;
  renderShell(p);
}

function renderShell(p) {
  p.innerHTML = [
    '<div class="up-wrap">',
    '  <div class="up-note">Lädt neue Flyer als Templates in R2 hoch: eindeutiger technischer Name, WebP-Thumbnail, optional automatische Verschlagwortung (Sonnet). Bestehende Templates werden nicht angefasst. Neue erscheinen sofort in der Bestandsverwaltung und der App.</div>',
    '  <div class="up-card">',
    '    <label class="up-label">1 · Bilddateien wählen (jpg, jpeg, png, webp, mehrere möglich)</label>',
    '    <input type="file" id="upFiles" accept="image/png,image/jpeg,image/webp" multiple>',
    '    <div class="up-filelist" id="upFileList"></div>',
    '  </div>',
    '  <div class="up-card">',
    '    <label class="up-label">2 · Zielkategorie</label>',
    '    <div class="up-row">',
    '      <select id="upCat"></select>',
    '      <span class="up-or">oder neu</span>',
    '      <input type="text" id="upNewCat" maxlength="60" placeholder="Neue Kategorie">',
    '    </div>',
    '    <label class="up-check"><input type="checkbox" id="upAutoTag" checked> Tags automatisch erzeugen (ein Sonnet-Aufruf pro Flyer)</label>',
    '  </div>',
    '  <div class="up-actions">',
    '    <button class="rbtn rbtn-primary" id="upStart" type="button" disabled>Hochladen</button>',
    '    <span class="up-summary" id="upSummary"></span>',
    '  </div>',
    '  <div class="up-results" id="upResults"></div>',
    '</div>',
    '<div class="mng-toast" id="upToast"></div>',
  ].join("");
  q("#upCat").innerHTML = '<option value="">Bestehende wählen …</option>' + categories.map((c) => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("");
  wire();
}

function toast(msg, kind) {
  const t = q("#upToast"); if (!t) return;
  t.textContent = msg; t.className = "mng-toast show" + (kind ? " " + kind : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = "mng-toast"; }, 2800);
}

function chosenCategory() {
  const neu = q("#upNewCat").value.trim();
  return neu || q("#upCat").value;
}
function refreshStartState() {
  const ok = files.length > 0 && !!chosenCategory() && !running;
  q("#upStart").disabled = !ok;
  const n = files.length;
  q("#upSummary").textContent = n ? (n + (n === 1 ? " Datei" : " Dateien") + (q("#upAutoTag").checked ? " · " + n + " Sonnet-Aufruf" + (n === 1 ? "" : "e") : " · ohne Tags")) : "";
}

function renderFileList() {
  q("#upFileList").innerHTML = files.length
    ? files.map((f, i) => '<div class="up-file" data-i="' + i + '"><span class="nm">' + esc(f.name) + '</span><span class="st" id="upSt' + i + '"></span></div>').join("")
    : '<div class="up-hint">Noch keine Dateien gewählt.</div>';
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Datei nicht lesbar"));
    r.readAsDataURL(file);
  });
}

function setStatus(i, text, kind) {
  const el = q("#upSt" + i); if (!el) return;
  el.textContent = text; el.className = "st" + (kind ? " " + kind : "");
}

async function start() {
  if (running || !files.length) return;
  const category = chosenCategory();
  if (!category) { toast("Bitte Kategorie wählen oder eingeben", "err"); return; }
  if (files.length > WARN_AT && !confirm(files.length + " Dateien auf einmal" + (q("#upAutoTag").checked ? " (das sind " + files.length + " Sonnet-Aufrufe)" : "") + ".\nFortfahren?")) return;

  running = true; refreshStartState();
  const autoTag = q("#upAutoTag").checked;
  let done = 0, failed = 0, added = [];
  for (let i = 0; i < files.length; i++) {
    setStatus(i, "wird hochgeladen …");
    try {
      const dataUrl = await readAsDataURL(files[i]);
      const r = await post("/admin/upload", { category, image: dataUrl, autoTag });
      done++; added.push(r);
      const tg = r.tagged ? ("Tags: " + (r.tags ? r.tags.length : 0)) : (r.tagError ? "ohne Tags (" + r.tagError + ")" : "ohne Tags");
      setStatus(i, "fertig · " + r.name + " · " + tg, r.tagError ? "warn" : "good");
    } catch (e) {
      failed++;
      if (e.message === "401") return; // Session weg -> Gate (post() reloaded bereits)
      setStatus(i, "Fehler: " + (e.message || "unbekannt"), "err");
    }
  }
  running = false; refreshStartState();
  q("#upResults").innerHTML = '<div class="up-done">Fertig: ' + done + ' hochgeladen' +
    (failed ? ', ' + failed + ' fehlgeschlagen' : '') +
    '. Die neuen Templates sind jetzt in der <b>Bestandsverwaltung</b> und der App, Kategorie ' + esc(category) + '.</div>';
  toast(done + " hochgeladen" + (failed ? ", " + failed + " Fehler" : ""), failed ? "warn" : "good");
  // Kategorie könnte neu sein -> Dropdown aktualisieren; Bestandsverwaltung refreshen.
  if (added.length) {
    try { categories = await fetchCategories(); q("#upCat").innerHTML = '<option value="">Bestehende wählen …</option>' + categories.map((c) => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join(""); } catch (_) {}
    document.dispatchEvent(new CustomEvent("nk-templates-changed"));
  }
}

function wire() {
  q("#upFiles").addEventListener("change", (e) => {
    files = Array.from(e.target.files || []);
    renderFileList(); refreshStartState();
  });
  q("#upCat").addEventListener("change", refreshStartState);
  q("#upNewCat").addEventListener("input", refreshStartState);
  q("#upAutoTag").addEventListener("change", refreshStartState);
  q("#upStart").addEventListener("click", start);
  renderFileList();
}
