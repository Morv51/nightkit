// Mehrere Clubs am Konto ("Ablage A").
//
// Ein Club besteht aus Clubname, Location und Website. Gespeichert wird die
// Liste in Supabase unter auth.users.user_metadata.nk_clubs — kein neuer
// Server-Endpunkt, keine eigene Tabelle, keine RLS-Policy. Der Anon-Client im
// Browser darf sein eigenes user_metadata schreiben.
//
// WICHTIG: Der Club-Wechsel schreibt ausschliesslich in die drei vorhandenen
// Formularfelder #fClub, #fLocation und #fContact. readEventForm() in
// generator.js liest weiterhin nur diese Felder — der Generier-Pfad weiss von
// diesem Modul nichts.

import { $, on } from "./dom.js";

const META_KEY = "nk_clubs";

// Defensive Grenzen: user_metadata reist im JWT mit, also klein halten.
const MAX_CLUBS = 20;
const MAX_LEN = 120;

const state = {
  list: [],     // [{ name, location, website }]
  active: -1,   // Index in list, -1 = keiner
};

// ── Supabase ─────────────────────────────────────────────────────

// init() wartet auf initClubs(). Damit eine langsame oder gestoerte
// Supabase-Antwort nicht die ganze App aufhaelt, bekommt das Lesen der Session
// eine Frist. Laeuft sie ab, startet die App ohne Club statt gar nicht.
const SESSION_FRIST_MS = 4000;

function mitFrist(promise, ms) {
  return Promise.race([
    promise,
    new Promise((r) => setTimeout(() => r(null), ms)),
  ]);
}

// Aktuelle Session. Bevorzugt den Client (frisch nach updateUser), faellt auf
// die in app.html gestartete Session-Promise zurueck.
async function currentUser() {
  try {
    const sb = window.sb;
    if (sb && sb.auth) {
      const { data } = await sb.auth.getSession();
      const u = data && data.session && data.session.user;
      if (u) return u;
    }
  } catch (e) { /* unten weiter */ }
  try {
    const s = await (window.__nkSession || Promise.resolve(null));
    return (s && s.user) || null;
  } catch (e) {
    return null;
  }
}

// Liest den eigenen Schluessel und normalisiert ihn. Alles Unerwartete
// (fehlend, falscher Typ, kaputtes JSON) ergibt eine leere Liste statt eines
// Fehlers — ein Konto ohne Clubs ist der Normalfall, kein Sonderfall.
function readStore(meta) {
  const raw = meta && meta[META_KEY];
  if (!raw || typeof raw !== "object") return { list: [], active: -1 };
  const list = Array.isArray(raw.list) ? raw.list : [];
  const clean = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const name = String(c.name || "").trim().slice(0, MAX_LEN);
    if (!name) continue;
    clean.push({
      name,
      location: String(c.location || "").trim().slice(0, MAX_LEN),
      website: String(c.website || "").trim().slice(0, MAX_LEN),
    });
    if (clean.length >= MAX_CLUBS) break;
  }
  let active = Number.isInteger(raw.active) ? raw.active : -1;
  if (active < 0 || active >= clean.length) active = clean.length ? 0 : -1;
  return { list: clean, active };
}

// Schreibt NUR den eigenen Schluessel. Das vorhandene user_metadata wird
// vorher gelesen und mitgeschickt, damit fremde Felder auch dann erhalten
// bleiben, wenn der Server die Metadaten ersetzen statt mischen sollte.
// Wirft bei Misserfolg — der Aufrufer macht den Fehler sichtbar.
async function writeStore() {
  const sb = window.sb;
  if (!sb || !sb.auth) throw new Error("Keine Verbindung zum Konto.");
  const user = await currentUser();
  const meta = (user && user.user_metadata) || {};
  const data = Object.assign({}, meta);
  data[META_KEY] = { list: state.list, active: state.active };
  const { error } = await sb.auth.updateUser({ data });
  if (error) throw new Error(error.message || "Speichern fehlgeschlagen.");
}

// ── Formularfelder ───────────────────────────────────────────────

function setField(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value || "";
}

// Uebertraegt einen Club in die drei Felder. Sie bleiben ganz normale
// Eingabefelder und koennen danach frei geaendert werden.
function applyToForm(club) {
  if (!club) return;
  setField("fClub", club.name);
  setField("fLocation", club.location);
  setField("fContact", club.website);
}

function activeClub() {
  return state.active >= 0 ? state.list[state.active] : null;
}

// ── Zeile ueber dem Formular ─────────────────────────────────────

function renderRow() {
  const name = $("clubCurrentName");
  const meta = $("clubCurrentMeta");
  const sw = $("clubSwitch");
  const c = activeClub();
  if (name) name.textContent = c ? c.name : "Kein Club gespeichert";
  if (meta) {
    const teile = c ? [c.location, c.website].filter(Boolean) : [];
    meta.textContent = teile.join(" · ");
    meta.hidden = teile.length === 0;
  }
  if (sw) sw.textContent = state.list.length ? "Wechseln" : "Anlegen";
}

// ── Overlay ──────────────────────────────────────────────────────

function zeigeFehler(text) {
  const box = $("clubErr");
  if (!box) return;
  box.textContent = text || "";
  box.hidden = !text;
}

function openModal() {
  const m = $("clubModal");
  if (!m) return;
  zeigeFehler("");
  renderList();
  vorbefuellen();
  m.classList.add("open");
  const f = $("clubNewName");
  if (f) setTimeout(() => f.focus(), 60);
}

function closeModal() {
  const m = $("clubModal");
  if (m) m.classList.remove("open");
}

// Das Anlegen-Formular startet mit dem, was schon im Hauptformular steht —
// wer seinen Club gerade eingetippt hat, muss ihn nicht zweimal tippen.
function vorbefuellen() {
  const q = (id) => { const e = $(id); return e ? e.value.trim() : ""; };
  setField("clubNewName", q("fClub"));
  setField("clubNewLocation", q("fLocation"));
  setField("clubNewWebsite", q("fContact"));
}

// Liste als DOM-Knoten, nicht als innerHTML: Clubnamen sind Nutzertext.
function renderList() {
  const wrap = $("clubList");
  if (!wrap) return;
  wrap.textContent = "";
  if (!state.list.length) {
    const leer = document.createElement("div");
    leer.className = "club-empty";
    leer.textContent = "Noch kein Club gespeichert. Leg unten deinen ersten an.";
    wrap.appendChild(leer);
    return;
  }
  state.list.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "club-item" + (i === state.active ? " active" : "");

    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "club-item-pick";

    const n = document.createElement("span");
    n.className = "club-item-name";
    n.textContent = c.name;
    pick.appendChild(n);

    const teile = [c.location, c.website].filter(Boolean);
    if (teile.length) {
      const s = document.createElement("span");
      s.className = "club-item-meta";
      s.textContent = teile.join(" · ");
      pick.appendChild(s);
    }
    on(pick, "click", () => waehle(i));
    row.appendChild(pick);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "club-item-del";
    del.setAttribute("aria-label", "Club loeschen");
    del.textContent = "✕";
    on(del, "click", () => loesche(i));
    row.appendChild(del);

    wrap.appendChild(row);
  });
}

// ── Aktionen ─────────────────────────────────────────────────────

// Wechseln: Felder sofort fuellen (der sichtbare Nutzen), dann speichern.
// Erst wenn das Speichern durch ist, schliesst das Overlay. Schlaegt es fehl,
// bleibt es offen und sagt genau das — kein stilles Scheitern.
async function waehle(i) {
  if (i < 0 || i >= state.list.length) return;
  const vorher = state.active;
  state.active = i;
  applyToForm(state.list[i]);
  renderRow();
  renderList();
  zeigeFehler("");
  try {
    await writeStore();
    closeModal();
  } catch (e) {
    state.active = vorher;
    renderRow();
    renderList();
    zeigeFehler(
      "Der Club wurde ins Formular uebernommen, aber nicht am Konto " +
      "gespeichert: " + e.message
    );
  }
}

async function loesche(i) {
  if (i < 0 || i >= state.list.length) return;
  const sicherung = { list: state.list.slice(), active: state.active };
  state.list.splice(i, 1);
  if (state.active === i) state.active = state.list.length ? 0 : -1;
  else if (state.active > i) state.active -= 1;
  renderList();
  renderRow();
  zeigeFehler("");
  try {
    await writeStore();
  } catch (e) {
    state.list = sicherung.list;
    state.active = sicherung.active;
    renderList();
    renderRow();
    zeigeFehler("Loeschen fehlgeschlagen: " + e.message);
  }
}

async function anlegen() {
  const q = (id) => { const e = $(id); return e ? e.value.trim().slice(0, MAX_LEN) : ""; };
  const name = q("clubNewName");
  if (!name) {
    zeigeFehler("Bitte einen Clubnamen eingeben.");
    const f = $("clubNewName");
    if (f) f.focus();
    return;
  }
  if (state.list.length >= MAX_CLUBS) {
    zeigeFehler("Mehr als " + MAX_CLUBS + " Clubs sind nicht moeglich. Loesch zuerst einen.");
    return;
  }
  const club = { name, location: q("clubNewLocation"), website: q("clubNewWebsite") };
  const sicherung = { list: state.list.slice(), active: state.active };
  state.list.push(club);
  state.active = state.list.length - 1;
  applyToForm(club);
  renderList();
  renderRow();
  zeigeFehler("");
  try {
    await writeStore();
    closeModal();
  } catch (e) {
    state.list = sicherung.list;
    state.active = sicherung.active;
    renderList();
    renderRow();
    zeigeFehler("Speichern fehlgeschlagen: " + e.message);
  }
}

// ── Start ────────────────────────────────────────────────────────

// Laeuft in main.js VOR initMoreFields(): der aktive Club fuellt die drei
// Felder, und moreFields sieht sie befuellt und klappt "Weitere Details" auf.
export async function initClubs() {
  const sw = $("clubSwitch");
  if (sw) on(sw, "click", openModal);
  on($("clubModalClose"), "click", closeModal);
  on($("clubModalBackdrop"), "click", closeModal);
  on($("clubNewSave"), "click", anlegen);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const m = $("clubModal");
    if (m && m.classList.contains("open")) closeModal();
  });

  let user = null;
  try {
    user = await mitFrist(currentUser(), SESSION_FRIST_MS);
  } catch (e) { /* ohne Konto bleibt die Liste leer */ }
  const store = readStore(user && user.user_metadata);
  state.list = store.list;
  state.active = store.active;

  const c = activeClub();
  if (c) applyToForm(c);
  renderRow();
}
