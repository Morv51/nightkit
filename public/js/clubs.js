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
//
// Ein Club kann ausserdem ein Logo tragen. In user_metadata steht davon nur
// der Name; die Bytes liegen in R2 (siehe lib/clubLogos.js). Beim Wechseln und
// beim Laden werden sie mit Token geholt und als Blob-URL an setLogo gegeben —
// ab da ist alles wie nach einem Datei-Upload: Overlay, Ziehen, Skalieren,
// Komponieren. Die Logo-POSITION bleibt unberuehrt in localStorage pro
// Template (logo.js), sie haengt nicht am Club.

import { $, on } from "./dom.js";
import { setLogo, clearLogo } from "./logo.js";
import { postClubLogo, fetchClubLogoBlob } from "./api.js";
import { wandleAlleFelder } from "./caseFields.js";
// Nur lesend, fuer die Frage "liegt gerade ein Logo auf der Buehne?".
import { state as appState } from "./state.js";

const META_KEY = "nk_clubs";

// Defensive Grenzen: user_metadata reist im JWT mit, also klein halten.
const MAX_CLUBS = 20;
const MAX_LEN = 120;

const state = {
  list: [],          // [{ name, location, website, logo }]
  active: -1,        // Index in list, -1 = keiner
  logoAnsicht: "",   // Blob-URL des geladenen Logos, nur fuer die Vorschau im Streifen
  logoFehler: "",    // letzte Meldung aus dem Logo-Weg, sichtbar im Streifen
  // Die zuletzt geholten Bytes, samt Namen. Damit kostet das Wiedereinsetzen
  // nach einem X -- ueber den Knopf oder einen Templatewechsel -- keinen
  // weiteren Abruf. Ein anderer Name laesst den Puffer verfallen.
  logoBlob: null,
  logoBlobName: "",
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
    const logo = String(c.logo || "").trim();
    clean.push({
      name,
      location: String(c.location || "").trim().slice(0, MAX_LEN),
      website: String(c.website || "").trim().slice(0, MAX_LEN),
      // Nur der Name; unbekannte Formen werden verworfen statt mitgeschleppt.
      logo: /^[0-9a-f]{32}\.(png|jpg|webp)$/.test(logo) ? logo : "",
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
  // Programmatisch gesetzte Werte loesen kein input-Ereignis aus. Ohne diesen
  // Anstoss stuenden die Clubdaten anders im Feld, als sie auf dem Flyer
  // landen.
  wandleAlleFelder();
}

function activeClub() {
  return state.active >= 0 ? state.list[state.active] : null;
}

// ── Logo des Clubs ───────────────────────────────────────────────

// Holt die Bytes mit Token, macht daraus einen Blob-URL und reicht ihn an
// setLogo — ab hier ist der Zustand identisch zu einem Datei-Upload. Ohne Logo
// wird zurueckgesetzt. Scheitert das Laden, bleibt es nicht stumm: der Streifen
// im Overlay sagt es.
function verwerfeAnsicht() {
  if (state.logoAnsicht) {
    try { URL.revokeObjectURL(state.logoAnsicht); } catch (e) { /* egal */ }
    state.logoAnsicht = "";
  }
}

async function applyClubLogo(club) {
  if (!club || !club.logo) {
    clearLogo();
    verwerfeAnsicht();
    state.logoFehler = "";
    renderLogoLeiste();
    return;
  }
  try {
    let blob = state.logoBlobName === club.logo ? state.logoBlob : null;
    if (!blob) {
      blob = await fetchClubLogoBlob(club.logo);
      state.logoBlob = blob;
      state.logoBlobName = club.logo;
    }
    // ZWEI unabhaengige URLs aus EINEM Abruf: eine fuer die Buehne, eine fuer
    // die Vorschau im Overlay. Sonst macht der X-Griff (clearLogo widerruft die
    // Buehnen-URL) auch die Vorschau kaputt.
    setLogo(URL.createObjectURL(blob));   // ab hier wie nach einem Datei-Upload
    verwerfeAnsicht();
    state.logoAnsicht = URL.createObjectURL(blob);
    state.logoFehler = "";
  } catch (e) {
    clearLogo();
    verwerfeAnsicht();
    state.logoBlob = null;
    state.logoBlobName = "";
    state.logoFehler = "Das Logo konnte nicht geladen werden.";
    console.error("Club-Logo nicht ladbar:", e);
  }
  renderLogoLeiste();
}

// Der EINE Weg, ein hinterlegtes Clublogo wieder auf die Buehne zu holen --
// benutzt vom Knopf im Formular und vom Templatewechsel. Kein zweiter
// Abrufpfad: es laeuft durch dasselbe applyClubLogo wie der Clubwechsel.
//
// Nur wenn die Buehne LEER ist. Liegt schon eines dort, bleibt es unberuehrt;
// sonst wuerde ein Templatewechsel ein handisch hochgeladenes Logo
// stillschweigend ersetzen.
export function clubLogoEinfuegen() {
  if (appState.logoUrl) return;
  const c = activeClub();
  if (!c || !c.logo) return;
  applyClubLogo(c);
}

// Der Knopf erscheint nur, wenn ein Club mit hinterlegtem Logo aktiv ist und
// gerade keines auf der Buehne liegt.
function renderEinfuegenKnopf() {
  const k = $("clubLogoInsert");
  if (!k) return;
  const c = activeClub();
  k.hidden = !(c && c.logo && !appState.logoUrl);
}

// Laedt die Datei hoch und haengt den Namen an den aktiven Club.
// Erste Pruefung im Browser, damit der Nutzer die Meldung sofort sieht. Der
// Server prueft dasselbe noch einmal (Groesse, Typ, Signatur) und hat das
// letzte Wort -- diese Pruefung ist Bequemlichkeit, nicht die Absicherung.
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPEN = ["image/png", "image/jpeg", "image/webp"];

function pruefeLogoDatei(datei) {
  if (datei.size > MAX_LOGO_BYTES) return "Die Datei ist groesser als 2 MB.";
  if (!LOGO_TYPEN.includes(datei.type)) return "Nur PNG, JPEG oder WebP sind moeglich.";
  return "";
}

async function logoHochladen(datei) {
  const c = activeClub();
  if (!c) { zeigeFehler("Waehle zuerst einen Club."); return; }
  const fehler = pruefeLogoDatei(datei);
  if (fehler) { zeigeFehler(fehler); return; }
  const vorher = c.logo;
  zeigeFehler("");
  setzeLogoBeschaeftigt(true);
  try {
    c.logo = await postClubLogo(datei);
    // Die Bytes liegen schon vor -- gleich puffern, dann holt applyClubLogo
    // sie nicht noch einmal.
    state.logoBlob = datei;
    state.logoBlobName = c.logo;
    await writeStore();
    await applyClubLogo(c);
  } catch (e) {
    c.logo = vorher;
    zeigeFehler("Das Logo konnte nicht gespeichert werden: " + e.message);
  } finally {
    setzeLogoBeschaeftigt(false);
    renderLogoLeiste();
  }
}

// Entfernt nur die Verknuepfung; die Bytes bleiben in R2 liegen.
async function logoEntfernen() {
  const c = activeClub();
  if (!c || !c.logo) return;
  const vorher = c.logo;
  c.logo = "";
  zeigeFehler("");
  try {
    await writeStore();
    await applyClubLogo(c);
  } catch (e) {
    c.logo = vorher;
    zeigeFehler("Das Logo konnte nicht entfernt werden: " + e.message);
  }
  renderLogoLeiste();
}

function setzeLogoBeschaeftigt(an) {
  const w = $("clubLogoPick");
  const e = $("clubLogoDrop");
  if (w) w.disabled = an;
  if (e) e.disabled = an;
  const s = $("clubLogoState");
  if (s && an) s.textContent = "Wird hochgeladen…";
}

// Der Streifen zeigt das Logo des AKTIVEN Clubs.
function renderLogoLeiste() {
  const box = $("clubLogoRow");
  const zustand = $("clubLogoState");
  const bild = $("clubLogoThumb");
  const waehl = $("clubLogoPick");
  const weg = $("clubLogoDrop");
  if (!box || !zustand) return;
  const c = activeClub();
  box.hidden = !c;
  if (!c) return;
  const hat = !!c.logo;
  if (bild) {
    const url = hat ? state.logoAnsicht : "";
    if (url) { bild.src = url; bild.hidden = false; } else { bild.removeAttribute("src"); bild.hidden = true; }
  }
  zustand.textContent = state.logoFehler
    ? state.logoFehler
    : (hat ? "Logo hinterlegt" : "Kein Logo");
  zustand.classList.toggle("ist-fehler", !!state.logoFehler);
  if (waehl) waehl.textContent = hat ? "Ersetzen" : "Waehlen";
  if (weg) weg.hidden = !hat;
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
  renderLogoLeiste();
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
  const feld = $("clubNewLogo");
  if (feld) feld.value = ""; // kein Rest aus einem frueheren Anlauf
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
  await applyClubLogo(state.list[i]);
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
    await applyClubLogo(activeClub());
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
  const club = { name, location: q("clubNewLocation"), website: q("clubNewWebsite"), logo: "" };
  const sicherung = { list: state.list.slice(), active: state.active };

  // Optionales Logo aus dem Anlegen-Formular: erst hochladen, dann den Club
  // speichern. Scheitert der Upload, entsteht gar kein halber Club.
  const feld = $("clubNewLogo");
  const datei = feld && feld.files && feld.files[0];
  if (datei) {
    const fehler = pruefeLogoDatei(datei);
    if (fehler) { zeigeFehler(fehler); return; }
    setzeLogoBeschaeftigt(true);
    try {
      club.logo = await postClubLogo(datei);
      // Wie beim Ersetzen: die Bytes liegen vor, also gleich puffern statt sie
      // gleich darauf wieder zu holen.
      state.logoBlob = datei;
      state.logoBlobName = club.logo;
    } catch (e) {
      zeigeFehler("Das Logo konnte nicht gespeichert werden: " + e.message);
      return;
    } finally {
      setzeLogoBeschaeftigt(false);
    }
  }

  state.list.push(club);
  state.active = state.list.length - 1;
  applyToForm(club);
  renderList();
  renderRow();
  zeigeFehler("");
  try {
    await writeStore();
    await applyClubLogo(club);
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
  on($("clubLogoPick"), "click", () => { const f = $("clubLogoFile"); if (f) { f.value = ""; f.click(); } });
  on($("clubLogoFile"), "change", (e) => {
    const d = e.target.files && e.target.files[0];
    if (d) logoHochladen(d);
  });
  on($("clubLogoDrop"), "click", logoEntfernen);
  on($("clubLogoInsert"), "click", clubLogoEinfuegen);
  // logo.js meldet jeden Wechsel des Buehnen-Logos; danach stimmt der Knopf.
  document.addEventListener("nk:logo", renderEinfuegenKnopf);
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
  renderEinfuegenKnopf();
  // Logo des aktiven Clubs nachladen. Bewusst NICHT abgewartet: ein langsamer
  // Abruf darf den App-Start nicht aufhalten, das Overlay zeigt den Stand.
  applyClubLogo(c);
}
