"use strict";

// Nutzungs-Zähler + editierbare Richtpreise, DAUERHAFT in R2 (analog zu den Overlays).
// Das Zählen ist NACHRANGIG und darf die Kernfunktionen NIE stören oder verzögern:
//   - count() ist ein reiner In-Memory-Schritt und WIRFT NIE.
//   - Die Persistenz nach R2 läuft gebündelt im HINTERGRUND (Debounce, max. 1 Schreiben
//     pro 15 s) plus einmal beim Herunterfahren — nie synchron im Anfragepfad.
//   - Ohne ADMIN_TOOLS=1 ist das Modul komplett inert (kein Zählen, kein R2).
//
//   templates/_admin_usage.json  -> { startedAt, updatedAt, counts: { key: n } }
//   templates/_admin_prices.json -> { key: richtpreis }
//
// Kostenschätzung = Anzahl Anbieter-Aufrufe × Richtpreis. NUR Schätzung, keine echte
// Abrechnung. Nutzt den geteilten S3-Client aus lib/r2.js.

const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { readS3Env, makeR2Client, fehlerText } = require("../r2");
const { OUTPAINT_PRICE_USD } = require("../fal"); // zentraler flux-2-pro-Outpaint-Preis

const USAGE_KEY = "templates/_admin_usage.json";
const PRICES_KEY = "templates/_admin_prices.json";
const P = "[USAGE]";
const log = (m) => { try { console.log(P + " " + m); } catch (_) {} };

// Feste Aktionsliste (Reihenfolge + Label + Anbieter) — die einzige Wahrheit fürs Dashboard.
const ACTIONS = [
  { key: "ideogram_edit",         label: "edit-Flow (Ideogram edit)",             provider: "Ideogram" },
  { key: "ideogram_editmasked",   label: "Text ausbessern (Ideogram editMasked)", provider: "Ideogram" },
  { key: "ideogram_generate",     label: "Studio-Generierung (Ideogram V3)",      provider: "Ideogram" },
  { key: "openai_gptimage",       label: "GPT Image (Auto-Flow 1/2/3, Studio)",   provider: "OpenAI" },
  { key: "openai_promptgen",      label: "Analyse-Prompt (Vision → Text)",       provider: "OpenAI" },
  { key: "openai_promptgen_gv",   label: "Genre/Vibe-Vorschlag (Vision → Text)", provider: "OpenAI" },
  { key: "openai_variants",       label: "Prompt-Varianten (Text → Text)",       provider: "OpenAI" },
  { key: "claude_analyze",        label: "Stil-/Zonen-Analyse (Claude)",          provider: "Anthropic" },
  { key: "claude_variantspecs",   label: "Varianten-Vorgaben (Claude)",           provider: "Anthropic" },
  { key: "claude_artworkspecs",   label: "Artwork-Regie (Claude)",                provider: "Anthropic" },
  { key: "claude_redesignspecs",  label: "Redesign-Regie (Claude)",               provider: "Anthropic" },
  { key: "claude_redesigngate",   label: "Redesign-Qualitäts-Gate (Claude)",      provider: "Anthropic" },
  { key: "claude_familyspecs",    label: "Redesign-Familie würfeln (Claude)",     provider: "Anthropic" },
  { key: "claude_variantprompts", label: "Varianten-Prompts (Claude)",            provider: "Anthropic" },
  { key: "claude_tag",            label: "Verschlagwortung (Claude/Haiku)",       provider: "Anthropic" },
  { key: "claude_caption",        label: "Instagram-Captions (Claude/Haiku)",     provider: "Anthropic" },
  { key: "fal_outpaint",          label: "9:16-Nachzug/Reframe (fal flux-2-pro)",  provider: "fal" },
  { key: "replicate_remove",      label: "Bereinigen (Replicate removeObject)",   provider: "Replicate" },
];
const KEYS = new Set(ACTIONS.map((a) => a.key));

// Grobe Standard-Richtpreise pro Aufruf (frei editierbar im Dashboard, in R2 gespeichert).
const DEFAULT_PRICES = {
  ideogram_edit: 0.08, ideogram_editmasked: 0.08, ideogram_generate: 0.08,
  openai_gptimage: 0.08, openai_promptgen: 0.10, openai_promptgen_gv: 0.005, openai_variants: 0.15,
  claude_analyze: 0.02, claude_variantspecs: 0.02, claude_artworkspecs: 0.02, claude_redesignspecs: 0.02, claude_variantprompts: 0.02,
  claude_redesigngate: 0.02, claude_familyspecs: 0.02,
  claude_tag: 0.003, claude_caption: 0.003,
  fal_outpaint: OUTPAINT_PRICE_USD, replicate_remove: 0.01,
};

let _counts = {};       // { key: n } — In-Memory, autoritativ
let _prices = null;     // { key: price } oder null (noch nicht geladen)
let _startedAt = null;  // ISO, wann Zählung begann / zuletzt zurückgesetzt
let _primed = false;    // erst nach prime() darf geflusht werden
let _dirty = false;
let _flushTimer = null;

function nowIso() { try { return new Date().toISOString(); } catch (_) { return ""; } }

let _c = null, _tried = false;
function r2() {
  if (_tried) return _c;
  _tried = true;
  try {
    const env = readS3Env();
    if (env.missing.length) { log("R2-Variablen fehlen: " + env.missing.join(", ")); _c = null; return null; }
    _c = { client: makeR2Client(env), bucket: env.BUCKET };
    return _c;
  } catch (e) { log("R2-Client nicht baubar: " + fehlerText(e)); _c = null; return null; }
}

async function fetchJson(key) {
  const c = r2();
  if (!c) return null;
  try {
    const res = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: key }));
    return JSON.parse(await res.Body.transformToString());
  } catch (e) {
    const code = e && e.$metadata ? e.$metadata.httpStatusCode : undefined;
    if ((e && (e.name === "NoSuchKey" || e.name === "NotFound")) || code === 404) return null;
    log("R2-Lesefehler " + key + ": " + fehlerText(e));
    return null;
  }
}

// Beim Start laden. MERGT geladene Werte mit evtl. schon gezählten (kleiner Boot-Race),
// damit vor prime() gezählte Aufrufe nicht verloren gehen. WIRFT NIE.
async function prime() {
  try {
    const u = await fetchJson(USAGE_KEY);
    if (u && typeof u === "object" && !Array.isArray(u)) {
      const loaded = (u.counts && typeof u.counts === "object") ? u.counts : {};
      for (const k of KEYS) _counts[k] = (loaded[k] || 0) + (_counts[k] || 0);
      _startedAt = typeof u.startedAt === "string" ? u.startedAt : (_startedAt || nowIso());
    } else {
      _startedAt = _startedAt || nowIso();
    }
    const pr = await fetchJson(PRICES_KEY);
    _prices = Object.assign({}, DEFAULT_PRICES, (pr && typeof pr === "object" && !Array.isArray(pr)) ? pr : {});
    _primed = true;
    log("geladen: " + total() + " Aufrufe, startedAt " + _startedAt);
    if (_dirty) scheduleFlush(); // vor prime gezählte Aufrufe persistieren
  } catch (e) {
    log("Laden fehlgeschlagen: " + fehlerText(e));
    if (!_prices) _prices = Object.assign({}, DEFAULT_PRICES);
    if (!_startedAt) _startedAt = nowIso();
    _primed = true;
  }
}

function total() { let t = 0; for (const k in _counts) t += _counts[k] || 0; return t; }

// DER Zähl-Aufruf. Reiner In-Memory-Schritt, WIRFT NIE, verzögert nichts. Ohne
// ADMIN_TOOLS=1 passiert gar nichts (wie heute).
function count(key, n) {
  try {
    if (process.env.ADMIN_TOOLS !== "1") return;
    if (!KEYS.has(key)) return;
    _counts[key] = (_counts[key] || 0) + (typeof n === "number" && n > 0 ? n : 1);
    _dirty = true;
    scheduleFlush();
  } catch (_) { /* Statistik ist nachrangig — Fehler still schlucken */ }
}

function scheduleFlush() {
  try {
    if (_flushTimer || !_primed) return; // höchstens 1 Flush pro Fenster; vor prime kein Flush
    _flushTimer = setTimeout(() => { _flushTimer = null; flush().catch(() => {}); }, 15000);
    if (_flushTimer.unref) _flushTimer.unref(); // hält den Prozess nicht am Leben
  } catch (_) {}
}

// Snapshot nach R2 schreiben (Hintergrund). WIRFT NIE nach außen.
async function flush() {
  try {
    if (!_primed || !_dirty) return;
    const c = r2();
    if (!c) return;
    const snap = { startedAt: _startedAt || nowIso(), updatedAt: nowIso(), counts: {} };
    for (const k of KEYS) snap.counts[k] = _counts[k] || 0;
    await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: USAGE_KEY, Body: JSON.stringify(snap), ContentType: "application/json" }));
    _dirty = false;
  } catch (e) { log("Flush fehlgeschlagen: " + fehlerText(e)); }
}

function prices() { return _prices || DEFAULT_PRICES; }

// Snapshot fürs Dashboard (Zeilen je Aktion + Summen).
function snapshot() {
  const pr = prices();
  const rows = ACTIONS.map((a) => {
    const cnt = _counts[a.key] || 0;
    const price = typeof pr[a.key] === "number" ? pr[a.key] : (DEFAULT_PRICES[a.key] || 0);
    return { key: a.key, label: a.label, provider: a.provider, count: cnt, price, cost: cnt * price };
  });
  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  return { rows, totalCount, totalCost, startedAt: _startedAt || null };
}

// Richtpreis setzen (Admin-Aktion, selten) → Preistabelle sofort nach R2.
async function setPrice(key, value) {
  if (!KEYS.has(key)) throw new Error("Unbekannte Aktion");
  const v = Number(value);
  if (!isFinite(v) || v < 0) throw new Error("Ungueltiger Preis");
  if (!_prices) _prices = Object.assign({}, DEFAULT_PRICES);
  _prices[key] = v;
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar");
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: PRICES_KEY, Body: JSON.stringify(_prices), ContentType: "application/json" }));
}

// Zähler zurücksetzen (Admin) → alle auf 0, neuer startedAt, sofort nach R2.
async function reset() {
  _counts = {};
  _startedAt = nowIso();
  _dirty = false;
  const c = r2();
  if (!c) throw new Error("R2 nicht verfuegbar");
  const snap = { startedAt: _startedAt, updatedAt: _startedAt, counts: {} };
  for (const k of KEYS) snap.counts[k] = 0;
  await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: USAGE_KEY, Body: JSON.stringify(snap), ContentType: "application/json" }));
}

module.exports = { ACTIONS, count, prime, flush, snapshot, prices, setPrice, reset };
